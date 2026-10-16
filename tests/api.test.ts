import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { encrypt } from '../server/crypto.js';
import { ingestSnapshot } from '../server/energy.js';
import type { Config } from '../server/config.js';

const config: Config = {
  origin: 'http://localhost:3000',
  password: 'test-password-1234',
  encryptionKey: Buffer.alloc(32, 4),
  dataDir: '/tmp',
  python: 'python3',
  port: 3000,
  host: '127.0.0.1',
  pollSeconds: 300,
  resendKey: '',
  emailFrom: '',
  emailTo: '',
};

async function setup() {
  const db = openDatabase(':memory:');
  const app = await createApp(config, { db, background: false });
  const login = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin },
      payload: { password: config.password },
    });
  return { db, app, login };
}

test('private readings require authentication; correct password sets secure session semantics', async () => {
  const { app, login } = await setup();
  assert.equal((await app.inject('/api/overview')).statusCode, 401);
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: config.origin },
    payload: { password: 'incorrect' },
  });
  assert.equal(wrong.statusCode, 401);
  const res = await login();
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['set-cookie']), /HttpOnly/);
  assert.match(String(res.headers['set-cookie']), /SameSite=Strict/i);
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  const data = await app.inject({ url: '/api/overview', headers: { cookie } });
  assert.equal(data.statusCode, 200);
  assert.equal(data.json().stats.kwh, null);
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/sync',
    headers: { cookie, origin: 'https://evil.example' },
    payload: {},
  });
  assert.equal(forbidden.statusCode, 403);
  await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie, origin: config.origin },
    payload: {},
  });
  assert.equal((await app.inject({ url: '/api/accounts', headers: { cookie } })).statusCode, 401);
  await app.close();
});

test('API excludes secrets and rejects invalid thresholds without changing saved rules', async () => {
  const { db, app, login } = await setup();
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
    'a',
    'Primary',
    encrypt({ access_token: 'do-not-expose' }, config.encryptionKey),
  );
  ingestSnapshot(db, 'a', { homes: [{ id: 'h', name: 'Home', devices: [] }] }, Date.now());
  const response = await login();
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  const overview = await app.inject({ url: '/api/overview', headers: { cookie } });
  assert.ok(!overview.body.includes('do-not-expose'));
  assert.ok(!overview.body.includes('secret'));
  const homeId = overview.json().homes[0].id;
  const bad = await app.inject({
    method: 'PUT',
    url: `/api/homes/${homeId}/rules`,
    headers: { cookie, origin: config.origin },
    payload: {
      dailyLimit: -5,
      anomalyEnabled: true,
      windowDays: 0,
      increasePercent: 50,
      increaseKwh: 3,
    },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(
    (db.prepare('SELECT daily_limit FROM homes WHERE id=?').get(homeId) as any).daily_limit,
    null,
  );
  const good = await app.inject({
    method: 'PUT',
    url: `/api/homes/${homeId}/rules`,
    headers: { cookie, origin: config.origin },
    payload: {
      dailyLimit: 13,
      anomalyEnabled: true,
      windowDays: 14,
      increasePercent: 60,
      increaseKwh: 2,
    },
  });
  assert.equal(good.statusCode, 200);
  const detail = await app.inject({ url: `/api/homes/${homeId}`, headers: { cookie } });
  assert.equal(detail.json().rules.dailyLimit, 13);
  assert.equal(
    (await app.inject({ url: '/api/overview?days=999999', headers: { cookie } })).statusCode,
    400,
  );
  await app.close();
});

test('a failed cloud connection never replaces stored account credentials', async () => {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
    'existing',
    'Primary',
    'keep',
  );
  const app = await createApp(config, {
    db,
    background: false,
    tuya: async () => {
      throw new Error('private-token-error');
    },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: config.origin },
    payload: { password: config.password },
  });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts/connect',
    headers: { cookie, origin: config.origin },
    payload: { label: 'Primary', userCode: 'code123' },
  });
  assert.equal(res.statusCode, 502);
  assert.ok(!res.body.includes('private-token-error'));
  assert.equal(
    (db.prepare('SELECT secret FROM accounts WHERE id=?').get('existing') as any).secret,
    'keep',
  );
  await app.close();
});
