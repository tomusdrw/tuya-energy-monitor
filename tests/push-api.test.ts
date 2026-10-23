import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { pushConfig, makeSubscription } from './helpers/push.js';
import { enqueueNotification } from '../server/notificationEvents.js';
import { createHmac } from 'node:crypto';

async function setup() {
  const db = openDatabase(':memory:');
  const app = await createApp(pushConfig, { db, background: false, pushSender: async () => {} });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: pushConfig.origin },
    payload: { password: pushConfig.password },
  });
  const headers = {
    cookie: String(login.headers['set-cookie']).split(';')[0],
    origin: pushConfig.origin,
  };
  const sub = makeSubscription();
  const subscribe = () =>
    app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers,
      payload: {
        subscription: sub,
        preferences: { name: 'Phone', language: 'pl', kinds: ['threshold'] },
      },
    });
  return { db, app, headers, sub, subscribe };
}

test('push APIs enforce authentication/origin and return receiver metadata without secrets', async () => {
  const f = await setup();
  try {
    assert.equal((await f.app.inject('/api/push/receivers')).statusCode, 401);
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/push/subscribe',
          headers: { ...f.headers, origin: 'https://evil.example' },
          payload: { subscription: f.sub },
        })
      ).statusCode,
      403,
    );
    const response = await f.subscribe();
    assert.equal(response.statusCode, 200, response.body);
    const receiver = response.json().receiver;
    const list = await f.app.inject({ url: '/api/push/receivers', headers: f.headers });
    assert.equal(list.json().currentReceiverId, receiver.id);
    assert.ok(!list.body.includes(f.sub.endpoint));
    assert.ok(!list.body.includes(f.sub.keys.auth));
    assert.equal(
      (
        await f.app.inject({
          method: 'PUT',
          url: `/api/push/receivers/${receiver.id}`,
          headers: f.headers,
          payload: { name: 'Phone', language: 'pl', kinds: ['bad'] },
        })
      ).statusCode,
      400,
    );
    const config = await f.app.inject({ url: '/api/push/config', headers: f.headers });
    assert.equal(config.json().publicKey, pushConfig.vapidPublicKey);
    assert.ok(!config.body.includes(pushConfig.vapidPrivateKey!));
  } finally {
    await f.app.close();
  }
});

test('logout revokes the session receiver even without a local ID and cancels pending pushes', async () => {
  const f = await setup();
  try {
    const response = await f.subscribe();
    assert.equal(response.statusCode, 200, response.body);
    enqueueNotification(f.db, {
      id: 'event',
      homeId: null,
      kind: 'threshold',
      now: Date.now(),
      content: () => ({ title: 'Energy', body: 'Body' }),
    });
    const logout = await f.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: f.headers,
      payload: {},
    });
    assert.equal(logout.statusCode, 200);
    assert.equal(f.db.prepare('SELECT state FROM push_receivers').get()?.state, 'disabled');
    assert.equal(f.db.prepare('SELECT status FROM push_deliveries').get()?.status, 'cancelled');
  } finally {
    await f.app.close();
  }
});

test('reconcile never enrolls or re-enables without consent; tests are rate limited; email is independent', async () => {
  const f = await setup();
  try {
    const body = { subscription: f.sub };
    const reconcile = () =>
      f.app.inject({
        method: 'POST',
        url: '/api/push/reconcile',
        headers: f.headers,
        payload: body,
      });
    assert.equal((await reconcile()).json().receiver, null);
    const r = (await f.subscribe()).json().receiver;
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: `/api/push/receivers/${r.id}/test`,
          headers: f.headers,
          payload: {},
        })
      ).statusCode,
      202,
    );
    for (let attempt = 2; attempt <= 4; attempt++)
      assert.equal(
        (
          await f.app.inject({
            method: 'POST',
            url: `/api/push/receivers/${r.id}/test`,
            headers: f.headers,
            payload: {},
          })
        ).statusCode,
        attempt <= 3 ? 202 : 429,
      );
    await f.app.inject({
      method: 'DELETE',
      url: `/api/push/receivers/${r.id}`,
      headers: f.headers,
    });
    assert.equal((await reconcile()).json().receiver.enabled, false);
    const off = await f.app.inject({
      method: 'PUT',
      url: '/api/settings/email',
      headers: f.headers,
      payload: { enabled: false },
    });
    assert.equal(off.statusCode, 200);
    assert.equal(
      (await f.app.inject({ url: '/api/settings', headers: f.headers })).json().emailEnabled,
      false,
    );
  } finally {
    await f.app.close();
  }
});

test('changing owner password revokes durable push opt-in', async () => {
  const db = openDatabase(':memory:');
  // Seed the old authorization revision; createApp must invalidate both credentials and receivers.
  const { saveSubscription } = await import('../server/pushSubscriptions.js');
  saveSubscription(db, pushConfig, { subscription: makeSubscription(), enable: true }, Date.now());
  db.prepare("INSERT INTO metadata(key,value) VALUES('auth_revision',?)").run(
    createHmac('sha256', pushConfig.encryptionKey).update('old-password').digest('hex'),
  );
  const app = await createApp(pushConfig, { db, background: false, pushSender: async () => {} });
  try {
    assert.equal(db.prepare('SELECT state FROM push_receivers').get()?.state, 'disabled');
  } finally {
    await app.close();
  }
});

test('an expired retired endpoint cannot disable its active replacement on stale reconciliation', async () => {
  const f = await setup();
  try {
    const r = (await f.subscribe()).json().receiver;
    const current = makeSubscription('rotated');
    const reconcile = (subscription: unknown, receiverId?: string) =>
      f.app.inject({
        method: 'POST',
        url: '/api/push/reconcile',
        headers: f.headers,
        payload: { subscription, receiverId },
      });
    assert.equal((await reconcile(current, r.id)).json().receiver.id, r.id);
    const stale = await reconcile({ ...f.sub, expirationTime: 1 });
    assert.equal(stale.statusCode, 200, stale.body);
    assert.equal(stale.json().receiver.id, r.id);
    assert.equal(stale.json().receiver.enabled, true);
    assert.equal(f.db.prepare('SELECT generation FROM push_receivers').get()?.generation, 2);
  } finally {
    await f.app.close();
  }
});

test('expired sessions retain opt-in, and reauthentication can finish explicit logout by endpoint', async () => {
  const f = await setup();
  try {
    await f.subscribe();
    f.db.exec('UPDATE sessions SET expires=0');
    const logout = (headers: typeof f.headers) =>
      f.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers,
        payload: { endpoint: f.sub.endpoint },
      });
    assert.equal((await logout(f.headers)).statusCode, 401);
    assert.equal(f.db.prepare('SELECT state FROM push_receivers').get()?.state, 'active');
    const login = await f.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: pushConfig.origin },
      payload: { password: pushConfig.password },
    });
    const headers = { ...f.headers, cookie: String(login.headers['set-cookie']).split(';')[0] };
    assert.equal((await logout(headers)).statusCode, 200);
    assert.equal(f.db.prepare('SELECT state FROM push_receivers').get()?.state, 'disabled');
    assert.equal((await f.app.inject({ url: '/api/push/receivers', headers })).statusCode, 401);
  } finally {
    await f.app.close();
  }
});
