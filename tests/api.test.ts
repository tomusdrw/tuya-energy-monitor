import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { encrypt } from '../server/crypto.js';
import { ingestSnapshot } from '../server/energy.js';
import { configureEstimation } from '../server/estimation.js';
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
  statusPollSeconds: 60,
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

test('encoded API paths enforce authentication and origin checks on the matched route', async () => {
  const { db, app, login } = await setup();
  try {
    db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run('a', 'Account', 'unused');
    ingestSnapshot(
      db,
      'a',
      { homes: [{ id: 'h', name: 'Private home', devices: [] }] },
      Date.now(),
    );
    const home = (db.prepare('SELECT id FROM homes').get() as { id: string }).id;
    const payload = {
      dailyLimit: 123,
      anomalyEnabled: true,
      windowDays: 14,
      increasePercent: 50,
      increaseKwh: 3,
    };
    for (const prefix of ['/%61pi', '/a%70i', '/%61%70%69']) {
      const read = await app.inject(`${prefix}/overview`);
      assert.equal(read.statusCode, 401, `${prefix} must not expose readings anonymously`);
      assert.ok(!read.body.includes('Private home'));
      assert.equal(
        (
          await app.inject({
            method: 'PUT',
            url: `${prefix}/homes/${home}/rules`,
            headers: { origin: config.origin },
            payload,
          })
        ).statusCode,
        401,
      );
    }
    const response = await login();
    const cookie = String(response.headers['set-cookie']).split(';')[0];
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/%61pi/homes/${home}/rules`,
          headers: { cookie, origin: 'https://evil.example' },
          payload,
        })
      ).statusCode,
      403,
    );
    assert.equal((db.prepare('SELECT daily_limit FROM homes').get() as any).daily_limit, null);
    assert.equal(
      (await app.inject({ url: '/%61pi/overview', headers: { cookie } })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/%61pi/auth/login',
          headers: { origin: config.origin },
          payload: { password: config.password },
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
  }
});

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

test('estimation configuration is private, validates mappings and power, and never rewrites historical energy', async () => {
  const { db, app, login } = await setup();
  try {
    db.exec(
      "INSERT INTO accounts(id,label,secret) VALUES('a','A','unused'); INSERT INTO homes(id,account_id,remote_id,name) VALUES('h','a','h','H'); INSERT INTO devices(id,home_id,remote_id,name,category,included,online,energy_kind) VALUES('d','h','d','D','wk',1,1,'unsupported'); INSERT INTO intervals(device_id,start,end,kwh,source,on_ms,config_revision) VALUES('d',100,200,1,'estimated',100,0)",
    );
    const payload = {
      enabled: true,
      ratedPowerKw: 2,
      heatingCode: 'work_state',
      onValues: ['heat'],
      offValues: ['idle'],
    };
    const url = '/api/devices/d/estimation';
    assert.equal(
      (await app.inject({ method: 'PUT', url, headers: { origin: config.origin }, payload }))
        .statusCode,
      401,
    );
    const cookie = String((await login()).headers['set-cookie']).split(';')[0];
    const headers = { cookie, origin: config.origin };
    for (const change of [
      { ratedPowerKw: 0 },
      { ratedPowerKw: -1 },
      { ratedPowerKw: null },
      { onValues: [] },
      { offValues: ['heat'] },
      { ratedPowerKw: 1001 },
      { extra: true },
    ]) {
      assert.equal(
        (await app.inject({ method: 'PUT', url, headers, payload: { ...payload, ...change } }))
          .statusCode,
        400,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers: { cookie, origin: 'http://evil.example' },
          payload,
        })
      ).statusCode,
      403,
    );
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload })).statusCode, 200);
    const detail = (await app.inject({ url: '/api/devices/d', headers })).json();
    assert.equal(detail.estimation.ratedPowerKw, 2);
    assert.equal(detail.estimation.revision, 1, 'saving unchanged config keeps its baseline');
    assert.equal(detail.estimation.state, 'unknown');
    assert.equal((db.prepare('SELECT kwh FROM intervals').get() as any).kwh, 1);
    const temperaturePayload = {
      ...payload,
      heatingCode: null,
      onValues: [],
      offValues: [],
      temperature: {
        current: { code: 'temp_current', scale: 1, unit: 'C' },
        target: { code: 'set_temp', scale: 0, unit: 'C' },
        switchCode: 'switch',
      },
    };
    for (const change of [
      { current: { code: 'temp_current', scale: -1, unit: 'C' } },
      { current: { code: 'temp_current', scale: 1, unit: 'W' } },
      { target: temperaturePayload.temperature.current },
    ]) {
      assert.equal(
        (
          await app.inject({
            method: 'PUT',
            url,
            headers,
            payload: {
              ...temperaturePayload,
              temperature: { ...temperaturePayload.temperature, ...change },
            },
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (await app.inject({ method: 'PUT', url, headers, payload: temperaturePayload })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: 'PUT', url, headers, payload: temperaturePayload })).statusCode,
      200,
    );
    const temperatureDetail = (await app.inject({ url: '/api/devices/d', headers })).json();
    assert.deepEqual(temperatureDetail.estimation.temperature, temperaturePayload.temperature);
    assert.equal(temperatureDetail.estimation.revision, 2);
    assert.equal(temperatureDetail.energySource, 'estimated');
    assert.equal((db.prepare('SELECT kwh FROM intervals').get() as any).kwh, 1);
    assert.equal(
      (await app.inject({ method: 'PUT', url: '/api/devices/absent/estimation', headers, payload }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});

for (const outcome of ['success', 'failure', 'omitted', 'enabled-failure'] as const) {
  test(`field rediscovery awaits a fresh inventory and reports ${outcome} without changing configuration`, async () => {
    const db = openDatabase(':memory:');
    const session = {
      user_code: 'user',
      terminal_id: 'terminal',
      endpoint: 'https://apigw.tuyaeu.com',
      token_info: {
        t: 0,
        uid: 'uid',
        expire_time: 9999999999,
        access_token: 'old',
        refresh_token: 'refresh',
      },
    };
    db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
      'a',
      'A',
      encrypt(session, config.encryptionKey),
    );
    const device = {
      id: 'remote',
      name: 'Heater',
      category: 'wk',
      online: true,
      energyKind: 'unsupported',
      energyCode: null,
      counterKwh: null,
      temperature: null,
      powerW: null,
      statusFields: [{ code: 'work_state', value: 'heating', values: ['heating', 'idle'] }],
    };
    ingestSnapshot(
      db,
      'a',
      { homes: [{ id: 'h', name: 'H', devices: [device] }] },
      Date.now() - 60000,
    );
    const id = db.prepare('SELECT id FROM devices').get()!.id;
    if (outcome === 'enabled-failure')
      configureEstimation(
        db,
        String(id),
        {
          enabled: true,
          ratedPowerKw: 1.25,
          heatingCode: 'work_state',
          onValues: ['heating'],
          offValues: ['idle'],
        },
        Date.now() - 1000,
      );
    let calls = 0;
    const app = await createApp(config, {
      db,
      background: false,
      tuya: async (operation, payload) => {
        calls++;
        assert.equal(operation, 'read');
        assert.deepEqual(payload.session, session);
        return outcome.endsWith('failure')
          ? { ok: false }
          : {
              ok: true,
              snapshot: {
                homes: [
                  {
                    id: 'h',
                    name: 'H',
                    devices:
                      outcome === 'omitted'
                        ? []
                        : [
                            {
                              ...device,
                              statusFields: [
                                { code: 'relay_state', value: true, values: [true, false] },
                              ],
                            },
                          ],
                  },
                ],
              },
            };
      },
    });
    try {
      const url = `/api/devices/${id}/probe`;
      assert.equal(
        (await app.inject({ method: 'POST', url, headers: { origin: config.origin } })).statusCode,
        401,
      );
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: config.origin },
        payload: { password: config.password },
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const headers = { cookie, origin: config.origin };
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { cookie, origin: 'https://evil.example' },
          })
        ).statusCode,
        403,
      );
      assert.equal(calls, 0);
      const response = await app.inject({ method: 'POST', url, headers });
      assert.equal(response.statusCode, outcome === 'success' ? 200 : 503);
      assert.equal(calls, 1);
      if (outcome === 'success') {
        assert.deepEqual(response.json().statusFields, [
          { code: 'relay_state', value: true, values: [true, false] },
        ]);
        assert.equal(response.json().enabled, false);
        assert.equal(response.json().revision, 0);
        assert.ok(response.json().statusUpdatedAt >= Date.now() - 1000);
      }
      assert.equal(
        (await app.inject({ method: 'POST', url: '/api/devices/absent/probe', headers }))
          .statusCode,
        404,
      );
    } finally {
      await app.close();
    }
  });
}

test('rediscovery queues a fresh read if its account was already read by an in-flight inventory', async (t) => {
  let now = Date.parse('2026-10-19T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const db = openDatabase(':memory:');
  const snapshots = (uid: string) => ({
    homes: [
      {
        id: 'h',
        name: uid,
        devices: [
          {
            id: 'd',
            name: 'Heater',
            category: 'wk',
            online: true,
            energyKind: 'unsupported',
            energyCode: null,
            counterKwh: null,
            temperature: null,
            powerW: null,
            statusFields: [{ code: 'relay_state', value: true, values: [true, false] }],
          },
        ],
      },
    ],
  });
  for (const uid of ['a', 'b']) {
    db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
      uid,
      uid,
      encrypt(
        {
          user_code: uid,
          terminal_id: uid,
          endpoint: 'https://apigw.tuyaeu.com',
          token_info: {
            t: 0,
            uid,
            expire_time: 9999999999,
            access_token: 'old',
            refresh_token: 'refresh',
          },
        },
        config.encryptionKey,
      ),
    );
    ingestSnapshot(db, uid, snapshots(uid), now - 60000);
  }
  const id = db
    .prepare("SELECT d.id FROM devices d JOIN homes h ON h.id=d.home_id WHERE h.account_id='a'")
    .get()!.id;
  const blocked = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const app = await createApp(config, {
    db,
    background: false,
    tuya: async (operation, payload: any) => {
      assert.equal(operation, 'read');
      const uid = payload.session.token_info.uid;
      calls.push(uid);
      if (uid === 'b' && calls.length === 2) {
        blocked.resolve();
        await release.promise;
      }
      return { ok: true, snapshot: snapshots(uid) };
    },
  });
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin },
      payload: { password: config.password },
    });
    const headers = {
      origin: config.origin,
      cookie: String(login.headers['set-cookie']).split(';')[0],
    };
    await app.inject({ method: 'POST', url: '/api/sync', headers });
    await blocked.promise;
    now += 1000;
    const response = app.inject({ method: 'POST', url: `/api/devices/${id}/probe`, headers });
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    const result = await response;
    assert.equal(result.statusCode, 200);
    assert.ok(calls.filter((uid) => uid === 'a').length >= 2);
    assert.equal(result.json().statusUpdatedAt, now);
  } finally {
    release.resolve();
    await app.close();
  }
});

test('slow email delivery never stalls collection or starts concurrent outbox deliveries', async (t) => {
  const db = openDatabase(':memory:');
  const session = {
    user_code: 'test',
    terminal_id: 'test',
    endpoint: 'https://apigw.tuyaeu.com',
    token_info: {
      t: 0,
      uid: 'test',
      expire_time: 9999999999,
      access_token: 'fake',
      refresh_token: 'fake',
    },
  };
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
    'a',
    'A',
    encrypt(session, config.encryptionKey),
  );
  db.prepare(
    "INSERT INTO notifications(id,kind,title,body,created_at) VALUES('queued','threshold','Test','Test',?)",
  ).run(Date.now());
  let release: (r: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let deliveries = 0,
    reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    deliveries++;
    return deliveries === 1 ? pending : Response.json({ id: 'mail' });
  });
  const app = await createApp(
    { ...config, resendKey: 'fake', emailFrom: 'test@example.com', emailTo: 'test@example.com' },
    {
      db,
      background: false,
      tuya: async () => {
        reads++;
        return { ok: true, snapshot: { homes: [] } };
      },
    },
  );
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin },
      payload: { password: config.password },
    });
    const headers = {
      cookie: String(res.headers['set-cookie']).split(';')[0],
      origin: config.origin,
    };
    await app.inject({ method: 'POST', url: '/api/sync', headers, payload: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deliveries, 1);
    assert.equal(
      (await app.inject({ url: '/api/settings', headers })).json().syncing,
      false,
      'Collection must finish while Resend is still pending',
    );
    await app.inject({ method: 'POST', url: '/api/sync', headers, payload: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 2, 'The next cloud poll completes before the first email response');
    assert.equal(deliveries, 1, 'Only one delivery job may own the outbox at a time');
  } finally {
    release(Response.json({ id: 'mail' }));
    await app.close();
  }
});

test('API errors stay canonical English even with a Polish browser preference', async () => {
  const { app, login } = await setup();
  try {
    const unauthenticated = await app.inject({
      url: '/api/overview',
      headers: { 'accept-language': 'pl' },
    });
    assert.equal(unauthenticated.json().error, 'Sign in to continue.');
    const incorrect = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin },
      payload: { password: 'incorrect' },
    });
    assert.equal(incorrect.json().error, 'Incorrect password.');
    const cookie = String((await login()).headers['set-cookie']).split(';')[0];
    assert.equal(
      (await app.inject({ url: '/api/overview?days=invalid', headers: { cookie } })).json().error,
      'Check the form values.',
    );
    assert.equal(
      (await app.inject({ url: '/api/homes/missing', headers: { cookie } })).json().error,
      'Home not found.',
    );
  } finally {
    await app.close();
  }
});
