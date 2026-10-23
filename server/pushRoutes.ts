import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pushConfigured, type Config } from './config.js';
import { digest } from './crypto.js';
import { transaction } from './db.js';
import { setEmailEnabled } from './notificationEvents.js';
import { pushPayload } from './pushDelivery.js';
import {
  findReceiver,
  listReceivers,
  preferencesSchema,
  revokeReceiver,
  saveSubscription,
  subscriptionSchema,
  updateReceiver,
} from './pushSubscriptions.js';

const identitySchema = z.object({ receiverId: z.string().uuid().optional() });
const enrollSchema = identitySchema
  .extend({ subscription: subscriptionSchema, preferences: preferencesSchema.optional() })
  .strict();
const reconcileSchema = identitySchema
  .extend({ subscription: subscriptionSchema.nullable() })
  .strict();

export function registerPushRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  config: Config,
  wake: () => void,
): void {
  const session = (request: FastifyRequest) => digest(request.cookies.tem_session!);
  const current = (request: FastifyRequest) =>
    db.prepare('SELECT receiver_id FROM sessions WHERE hash=?').get(session(request))
      ?.receiver_id as string | null;
  const associate = (request: FastifyRequest, id: string | null) =>
    db.prepare('UPDATE sessions SET receiver_id=? WHERE hash=?').run(id, session(request));
  app.get('/api/push/config', async () => ({
    configured: pushConfigured(config),
    publicKey: pushConfigured(config) ? config.vapidPublicKey : null,
  }));
  app.get('/api/push/receivers', async (request) => ({
    receivers: listReceivers(db),
    currentReceiverId: current(request),
  }));
  app.post(
    '/api/push/subscribe',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!pushConfigured(config))
        return reply
          .code(503)
          .send({ error: 'Push notifications are not configured on the server.' });
      const body = enrollSchema.parse(request.body);
      const receiver = saveSubscription(db, config, { ...body, enable: true }, Date.now());
      associate(request, receiver.id);
      return { receiver };
    },
  );
  app.post('/api/push/reconcile', async (request) => {
    const body = reconcileSchema.parse(request.body);
    const remembered = body.receiverId ?? current(request);
    if (!body.subscription) {
      if (remembered) revokeReceiver(db, remembered);
      return {
        receiver: remembered ? (listReceivers(db).find((r) => r.id === remembered) ?? null) : null,
      };
    }
    const existing =
      findReceiver(db, body.subscription.endpoint) ??
      listReceivers(db).find((r) => r.id === remembered);
    if (!existing) return { receiver: null };
    // Invalid/changed VAPID identity requires the browser's explicit resubscribe flow.
    const storedKey = db
      .prepare('SELECT vapid_key FROM push_receivers WHERE id=?')
      .get(existing.id)?.vapid_key;
    if (
      storedKey !== digest(config.vapidPublicKey ?? '') ||
      (body.subscription.expirationTime != null && body.subscription.expirationTime <= Date.now())
    ) {
      revokeReceiver(db, existing.id);
      associate(request, existing.id);
      return { receiver: listReceivers(db).find((r) => r.id === existing.id)! };
    }
    const receiver = saveSubscription(
      db,
      config,
      { subscription: body.subscription, receiverId: existing.id, enable: false },
      Date.now(),
    );
    associate(request, receiver.id);
    return { receiver };
  });
  app.put<{ Params: { id: string } }>('/api/push/receivers/:id', async (request, reply) => {
    const receiver = updateReceiver(db, request.params.id, preferencesSchema.parse(request.body));
    return receiver
      ? { receiver }
      : reply.code(404).send({ error: 'Notification device not found.' });
  });
  app.delete<{ Params: { id: string } }>('/api/push/receivers/:id', async (request) => {
    transaction(db, () => revokeReceiver(db, request.params.id));
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>(
    '/api/push/receivers/:id/test',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!pushConfigured(config))
        return reply
          .code(503)
          .send({ error: 'Push notifications are not configured on the server.' });
      const receiver = listReceivers(db).find((r) => r.id === request.params.id && r.enabled);
      if (!receiver)
        return reply.code(409).send({ error: 'Enable notifications on this device first.' });
      const now = Date.now(),
        id = `test/${randomUUID()}`;
      const content =
        receiver.language === 'pl'
          ? {
              title: 'Powiadomienia działają',
              body: 'To jest powiadomienie testowe Tuya Energy Monitor.',
            }
          : {
              title: 'Notifications are working',
              body: 'This is a test notification from Tuya Energy Monitor.',
            };
      db.prepare(
        "INSERT INTO push_deliveries(event_id,receiver_id,kind,payload,created_at,deadline,next_attempt) VALUES(?,?,'test',?,?,?,?)",
      ).run(id, receiver.id, pushPayload(id, null, content), now, now + 300000, now);
      wake();
      return reply.code(202).send({ ok: true });
    },
  );
  app.put('/api/settings/email', async (request) => {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(request.body);
    setEmailEnabled(db, enabled);
    return { ok: true };
  });
}
