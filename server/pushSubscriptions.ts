import type { DatabaseSync } from 'node:sqlite';
import { ECDH, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { digest, encrypt, decrypt } from './crypto.js';
import { transaction } from './db.js';
import {
  defaultPushKinds,
  pushKinds,
  type PushPreferences,
  type PushReceiver,
} from '../shared/push.js';

export class PushInputError extends Error {
  statusCode = 400;
}
export function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PushInputError('Invalid push subscription.');
  }
  const host = url.hostname;
  const allowed =
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    /^([a-z0-9-]+\.)*push\.apple\.com$/.test(host) ||
    /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if (
    !allowed ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    value.length > 2048
  )
    throw new PushInputError('Unsupported push endpoint.');
  return url.href;
}
const keySchema = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine(
      (v) =>
        Buffer.from(v, 'base64url').length === bytes &&
        Buffer.from(v, 'base64url').toString('base64url') === v,
    );
export const subscriptionSchema = z
  .object({
    endpoint: z.string().max(2048).transform(validateEndpoint),
    expirationTime: z.number().nonnegative().nullable().optional(),
    keys: z
      .object({
        auth: keySchema(16),
        p256dh: keySchema(65).refine((v) => {
          try {
            ECDH.convertKey(Buffer.from(v, 'base64url'), 'prime256v1');
            return true;
          } catch {
            return false;
          }
        }),
      })
      .strict(),
  })
  .strict();
export const preferencesSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    language: z.enum(['en', 'pl']),
    kinds: z
      .array(z.enum(pushKinds))
      .max(pushKinds.length)
      .refine((kinds) => new Set(kinds).size === kinds.length),
  })
  .strict();
const inputSchema = z
  .object({
    subscription: subscriptionSchema,
    receiverId: z.string().uuid().optional(),
    enable: z.boolean(),
    preferences: preferencesSchema.optional(),
  })
  .strict();
export type Subscription = z.infer<typeof subscriptionSchema>;
type Row = Record<string, any>;
const view = (row: Row): PushReceiver => ({
  id: row.id,
  name: row.name,
  language: row.language,
  kinds: JSON.parse(row.kinds),
  enabled: row.state === 'active',
  state: row.state,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastSubmittedAt: row.last_submitted_at,
  error: row.error,
});
export function listReceivers(db: DatabaseSync): PushReceiver[] {
  return (db.prepare('SELECT * FROM push_receivers ORDER BY created_at,id').all() as Row[]).map(
    view,
  );
}
export function findReceiver(db: DatabaseSync, endpoint: string): PushReceiver | null {
  const hash = digest(validateEndpoint(endpoint));
  const row = db
    .prepare(
      `SELECT * FROM push_receivers WHERE endpoint_hash=? OR id=(
      SELECT receiver_id FROM push_retired_endpoints WHERE endpoint_hash=?)`,
    )
    .get(hash, hash) as Row | undefined;
  return row ? view(row) : null;
}
export function saveSubscription(
  db: DatabaseSync,
  config: Config,
  input: unknown,
  now: number,
): PushReceiver {
  const body = inputSchema.parse(input);
  return transaction(db, () => {
    const hash = digest(body.subscription.endpoint);
    const retired = db
      .prepare(
        `SELECT r.* FROM push_receivers r JOIN push_retired_endpoints e
      ON e.receiver_id=r.id WHERE e.endpoint_hash=?`,
      )
      .get(hash) as Row | undefined;
    // A delayed request from another tab must never roll endpoint rotation backwards.
    if (retired && !body.enable) return view(retired);
    if (body.subscription.expirationTime != null && body.subscription.expirationTime <= now)
      throw new PushInputError('The push subscription expired. Enable notifications again.');
    const existing = db.prepare('SELECT * FROM push_receivers WHERE endpoint_hash=?').get(hash) as
      Row | undefined;
    const prior =
      existing ??
      retired ??
      (body.receiverId
        ? (db.prepare('SELECT * FROM push_receivers WHERE id=?').get(body.receiverId) as
            Row | undefined)
        : undefined);
    if (!prior && !body.enable)
      throw new PushInputError('Enable notifications on this device first.');
    const id = prior?.id ?? randomUUID();
    const preferences =
      body.enable && body.preferences
        ? body.preferences
        : prior
          ? view(prior)
          : { name: 'This device', language: 'en', kinds: defaultPushKinds };
    // Passive reconciliation cannot reactivate a revoked receiver, even after endpoint rotation.
    const state = body.enable ? 'active' : prior!.state;
    const generation = prior
      ? prior.generation +
        Number(
          JSON.stringify(decrypt(prior.secret, config.encryptionKey)) !==
            JSON.stringify(body.subscription) ||
            prior.state !== state ||
            prior.vapid_key !== digest(config.vapidPublicKey ?? ''),
        )
      : 1;
    if (prior && prior.endpoint_hash !== hash)
      db.prepare(
        'INSERT OR REPLACE INTO push_retired_endpoints(endpoint_hash,receiver_id) VALUES(?,?)',
      ).run(prior.endpoint_hash, prior.id);
    // Explicit enrollment is allowed to use an endpoint again; passive reconciliation is not.
    db.prepare('DELETE FROM push_retired_endpoints WHERE endpoint_hash=?').run(hash);
    db.prepare(
      `INSERT INTO push_receivers(id,endpoint_hash,secret,vapid_key,name,language,kinds,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint_hash=excluded.endpoint_hash,
      secret=excluded.secret,vapid_key=excluded.vapid_key,name=excluded.name,language=excluded.language,
      kinds=excluded.kinds,state=excluded.state,updated_at=excluded.updated_at,generation=?,
      error=CASE WHEN ? THEN NULL ELSE push_receivers.error END`,
    ).run(
      id,
      hash,
      encrypt(body.subscription, config.encryptionKey),
      digest(config.vapidPublicKey ?? ''),
      preferences.name,
      preferences.language,
      JSON.stringify(preferences.kinds),
      state,
      now,
      now,
      generation,
      Number(body.enable),
    );
    cancelIneligible(db, id);
    return view(db.prepare('SELECT * FROM push_receivers WHERE id=?').get(id)!);
  });
}
export function cancelIneligible(db: DatabaseSync, id: string): void {
  db.prepare(
    `UPDATE push_deliveries SET status='cancelled',error=NULL WHERE receiver_id=? AND status IN ('pending','retry')
    AND (NOT EXISTS(SELECT 1 FROM push_receivers r WHERE r.id=receiver_id AND r.state='active')
      OR (kind!='test' AND kind NOT IN (SELECT value FROM json_each((SELECT kinds FROM push_receivers WHERE id=?)))))`,
  ).run(id, id);
}
export function updateReceiver(
  db: DatabaseSync,
  id: string,
  preferences: PushPreferences,
): PushReceiver | null {
  const parsed = preferencesSchema.parse(preferences);
  return transaction(db, () => {
    db.prepare('UPDATE push_receivers SET name=?,language=?,kinds=?,updated_at=? WHERE id=?').run(
      parsed.name,
      parsed.language,
      JSON.stringify(parsed.kinds),
      Date.now(),
      id,
    );
    cancelIneligible(db, id);
    const row = db.prepare('SELECT * FROM push_receivers WHERE id=?').get(id);
    return row ? view(row) : null;
  });
}
export function revokeReceiver(db: DatabaseSync, id: string): void {
  db.prepare(
    "UPDATE push_receivers SET state='disabled',updated_at=?,generation=generation+1,error=NULL WHERE id=?",
  ).run(Date.now(), id);
  cancelIneligible(db, id);
}
