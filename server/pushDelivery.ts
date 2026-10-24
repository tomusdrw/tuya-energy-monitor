import type { DatabaseSync } from 'node:sqlite';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import https from 'node:https';
import webpush from 'web-push';
import { pushConfigured, type Config } from './config.js';
import { decrypt, digest } from './crypto.js';
import { cancelIneligible, validateEndpoint, type Subscription } from './pushSubscriptions.js';
import type { PushKind, PushPayload } from '../shared/push.js';
import type { NotificationContent } from '../shared/types.js';
import type { Language } from '../shared/i18n.js';

type Row = Record<string, any>;
export interface PushOptions {
  TTL: number;
  topic: string;
  config: Config;
}
export type PushSender = (
  subscription: Subscription,
  payload: string,
  options: PushOptions,
) => Promise<void>;

const privateV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  privateV4.addSubnet(network, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const reservedV6 = new BlockList();
for (const [network, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const)
  reservedV6.addSubnet(network, prefix, 'ipv6');
export function isPublicAddress(address: string): boolean {
  return isIP(address) === 4
    ? !privateV4.check(address)
    : isIP(address) === 6 && globalV6.check(address, 'ipv6') && !reservedV6.check(address, 'ipv6');
}

// Validate at the actual socket lookup, rather than checking DNS and resolving again.
const publicLookup: typeof lookup = ((hostname: string, options: any, callback: any) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
      return callback(new Error('Unsafe push destination.'));
    const matching = options?.family
      ? addresses.filter((a) => a.family === options.family)
      : addresses;
    if (!matching.length) return callback(new Error('No push destination.'));
    if (options?.all) callback(null, matching);
    else callback(null, matching[0].address, matching[0].family);
  });
}) as typeof lookup;

export const sendPush: PushSender = async (subscription, payload, { TTL, topic, config }) => {
  validateEndpoint(subscription.endpoint);
  const request = webpush.generateRequestDetails(subscription, payload, {
    TTL,
    topic,
    urgency: 'normal',
    contentEncoding: 'aes128gcm',
    vapidDetails: {
      publicKey: config.vapidPublicKey!,
      privateKey: config.vapidPrivateKey!,
      subject: config.vapidSubject!,
    },
  });
  await new Promise<void>((resolve, reject) => {
    const outgoing = https.request(
      request.endpoint,
      {
        method: request.method,
        headers: request.headers,
        lookup: publicLookup,
        agent: false,
        signal: AbortSignal.timeout(15000),
      },
      (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300)
          resolve();
        else
          reject({
            statusCode: response.statusCode,
            headers: { 'retry-after': response.headers['retry-after'] },
          });
      },
    );
    outgoing.on('error', reject);
    outgoing.end(request.body);
  });
};

function truncate(value: string, bytes: number): string {
  let result = '';
  for (const char of value) {
    if (Buffer.byteLength(result + char, 'utf8') > bytes) return result + '…';
    result += char;
  }
  return result;
}
export function pushPayload(
  id: string,
  homeId: string | null,
  content: NotificationContent,
): string {
  const value: PushPayload = {
    title: truncate(content.title, 180),
    body: truncate(content.body, 1600),
    tag: `tem-${digest(id).slice(0, 32)}`,
    url: homeId ? `/#home/${encodeURIComponent(homeId)}` : '/#alerts',
    icon: '/icons/icon-192.png',
  };
  // JSON escaping can increase the byte count for control characters.
  while (Buffer.byteLength(JSON.stringify(value)) > 3000)
    value.body = value.body.slice(0, Math.floor(value.body.length * 0.8));
  return JSON.stringify(value);
}
export function enqueuePush(
  db: DatabaseSync,
  event: {
    id: string;
    homeId: string | null;
    kind: PushKind;
    now: number;
    content: (language: Language) => NotificationContent;
  },
): void {
  const receivers = db
    .prepare("SELECT id,language,kinds FROM push_receivers WHERE state='active'")
    .all() as Row[];
  const deadline =
    event.now + (['threshold', 'anomaly', 'weekly'].includes(event.kind) ? 86400000 : 3600000);
  for (const receiver of receivers) {
    if (!(JSON.parse(receiver.kinds) as string[]).includes(event.kind)) continue;
    db.prepare(
      'INSERT OR IGNORE INTO push_deliveries(event_id,receiver_id,kind,payload,created_at,deadline,next_attempt) VALUES(?,?,?,?,?,?,?)',
    ).run(
      event.id,
      receiver.id,
      event.kind,
      pushPayload(event.id, event.homeId, event.content(receiver.language)),
      event.now,
      deadline,
      event.now,
    );
  }
}

export async function deliverPushPending(
  db: DatabaseSync,
  config: Config,
  now: number,
  sender: PushSender = sendPush,
): Promise<void> {
  db.prepare(
    "UPDATE push_deliveries SET status='expired',error=NULL WHERE status IN ('pending','retry') AND deadline<=?",
  ).run(now);
  if (!pushConfigured(config)) return;
  // Fair by receiver first, chronological within each receiver, even with a backlog.
  const pending = db
    .prepare(
      `SELECT * FROM (SELECT *,row_number() OVER(PARTITION BY receiver_id ORDER BY created_at,event_id) AS ordinal
    FROM push_deliveries WHERE status IN ('pending','retry') AND next_attempt<=?) ORDER BY ordinal,created_at,receiver_id LIMIT 20`,
    )
    .all(now) as Row[];
  const started = Date.now();
  for (const candidate of pending) {
    const at = now + Math.max(0, Date.now() - started);
    cancelIneligible(db, candidate.receiver_id);
    const event = db
      .prepare(
        "SELECT * FROM push_deliveries WHERE event_id=? AND receiver_id=? AND status IN ('pending','retry')",
      )
      .get(candidate.event_id, candidate.receiver_id) as Row | undefined;
    if (!event) continue;
    if (event.deadline <= at) {
      db.prepare(
        "UPDATE push_deliveries SET status='expired' WHERE event_id=? AND receiver_id=?",
      ).run(event.event_id, event.receiver_id);
      continue;
    }
    const receiver = db
      .prepare('SELECT * FROM push_receivers WHERE id=?')
      .get(event.receiver_id) as Row;
    if (receiver.vapid_key !== digest(config.vapidPublicKey!)) {
      db.prepare("UPDATE push_receivers SET state='expired',error=? WHERE id=?").run(
        'The push subscription expired. Enable notifications again.',
        receiver.id,
      );
      cancelIneligible(db, receiver.id);
      continue;
    }
    db.prepare(
      'UPDATE push_deliveries SET attempts=attempts+1,next_attempt=? WHERE event_id=? AND receiver_id=?',
    ).run(at + 60000, event.event_id, receiver.id);
    try {
      const subscription = decrypt<Subscription>(receiver.secret, config.encryptionKey);
      validateEndpoint(subscription.endpoint);
      await sender(subscription, event.payload, {
        config,
        TTL: Math.max(1, Math.floor((event.deadline - at) / 1000)),
        topic: digest(event.event_id).slice(0, 32),
      });
      db.prepare(
        "UPDATE push_deliveries SET status='submitted',submitted_at=?,error=NULL WHERE event_id=? AND receiver_id=? AND status IN ('pending','retry')",
      ).run(at, event.event_id, receiver.id);
      db.prepare(
        'UPDATE push_receivers SET last_submitted_at=?,error=NULL WHERE id=? AND generation=?',
      ).run(at, receiver.id, receiver.generation);
    } catch (failure) {
      const error = failure as { statusCode?: number; headers?: Record<string, string> };
      if ([404, 410].includes(error.statusCode ?? 0)) {
        db.prepare(
          "UPDATE push_receivers SET state='expired',error=? WHERE id=? AND generation=?",
        ).run(
          'The push subscription expired. Enable notifications again.',
          receiver.id,
          receiver.generation,
        );
        cancelIneligible(db, receiver.id);
      } else {
        const retry =
          !error.statusCode || error.statusCode >= 500 || [408, 429].includes(error.statusCode);
        const message = retry
          ? 'Push delivery was not confirmed. We will retry.'
          : 'The push service rejected this notification.';
        const header = error.headers?.['retry-after'];
        const retryAfter = header
          ? /^\d+$/.test(header)
            ? Number(header) * 1000
            : Date.parse(header) - at
          : 0;
        const delay = Math.max(
          60000 * 2 ** Math.min(event.attempts, 6),
          Number.isFinite(retryAfter) ? retryAfter : 0,
        );
        db.prepare(
          "UPDATE push_deliveries SET status=?,error=?,next_attempt=? WHERE event_id=? AND receiver_id=? AND status IN ('pending','retry')",
        ).run(
          retry ? 'retry' : 'failed',
          message,
          Math.min(event.deadline, at + delay),
          event.event_id,
          receiver.id,
        );
        db.prepare('UPDATE push_receivers SET error=? WHERE id=? AND generation=?').run(
          message,
          receiver.id,
          receiver.generation,
        );
      }
    }
  }
}
