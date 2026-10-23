import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { loadConfig } from '../server/config.js';
import { ingestSnapshot } from '../server/energy.js';
import { decrypt } from '../server/crypto.js';
import { TuyaAiClient } from '../server/tuya-ai.js';
const config = loadConfig({
  ADMIN_PASSWORD: 'test-password-123',
  ENCRYPTION_KEY: 'ab'.repeat(32),
  DATA_DIR: '/tmp',
});

test('authenticated account API validates, encrypts and removes keys without ever returning credentials', async () => {
  const db = openDatabase(':memory:');
  db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','A','qr-session')");
  ingestSnapshot(
    db,
    'a',
    {
      homes: [
        {
          id: 'h',
          name: 'H',
          devices: [
            {
              id: 'known',
              name: 'D',
              category: 'wk',
              online: true,
              energyKind: 'cumulative',
              energyCode: 'total_energy',
              counterKwh: 1,
              temperature: null,
              powerW: null,
            },
          ],
        },
      ],
    },
    Date.now(),
  );
  let rejected = false;
  const ai = new TuyaAiClient({
    sleep: async () => {},
    fetch: async () =>
      new Response(
        JSON.stringify(
          rejected
            ? { success: false, code: 1010, msg: 'sk-EUsecret-test-value' }
            : { success: true, result: { devices: [{ device_id: 'known' }] } },
        ),
      ),
  });
  const app = await createApp(config, { db, background: false, tuyaAi: ai });
  const url = '/api/accounts/a/tuya-ai';
  const key = 'sk-EUsecret-test-value';
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin },
      payload: { password: config.password },
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const headers = { origin: config.origin, cookie };
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers: { origin: config.origin },
          payload: { key },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers: { cookie, origin: 'https://foreign.test' },
          payload: { key },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers,
          payload: { key, endpoint: 'https://foreign.test' },
        })
      ).statusCode,
      400,
    );
    const saved = await app.inject({ method: 'PUT', url, headers, payload: { key } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.ok(!saved.body.includes(key));
    assert.equal(
      decrypt(
        (db.prepare('SELECT ai_secret FROM accounts').get() as any).ai_secret,
        config.encryptionKey,
      ),
      key,
    );
    const publicView = await app.inject({ url: '/api/accounts', headers });
    assert.equal(publicView.json()[0].tuyaAi.configured, true);
    assert.equal(publicView.json()[0].tuyaAi.region, 'EU');
    assert.ok(!publicView.body.includes('secret-test'));
    const overview = await app.inject({ url: '/api/overview', headers });
    assert.ok(!overview.body.includes('secret-test'));
    rejected = true;
    const bad = await app.inject({ method: 'PUT', url, headers, payload: { key: 'sk-EUnew-key' } });
    assert.equal(bad.statusCode, 502);
    assert.ok(!bad.body.includes(key));
    assert.equal(
      decrypt(
        (db.prepare('SELECT ai_secret FROM accounts').get() as any).ai_secret,
        config.encryptionKey,
      ),
      key,
    );
    const removed = await app.inject({ method: 'DELETE', url, headers });
    assert.equal(removed.statusCode, 200);
    assert.equal((db.prepare('SELECT ai_secret FROM accounts').get() as any).ai_secret, null);
    assert.equal((db.prepare('SELECT secret FROM accounts').get() as any).secret, 'qr-session');
    assert.equal(
      (await app.inject({ method: 'DELETE', url: '/api/accounts/unknown/tuya-ai', headers }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
