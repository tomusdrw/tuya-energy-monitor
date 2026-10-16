import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { Collector } from '../server/collector.js';
import { loadConfig } from '../server/config.js';
import { encrypt, decrypt } from '../server/crypto.js';
import { devicesFor, getDevice, usage } from '../server/energy.js';
import { configureEstimation } from '../server/estimation.js';
import type { TuyaCall } from '../server/tuya.js';
const minute = 60000;
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
const config = loadConfig({ ADMIN_PASSWORD: 'test-password', ENCRYPTION_KEY: 'ab'.repeat(32) });
const device = {
  id: 'd',
  name: 'Thermostat',
  category: 'wk',
  online: true,
  energyKind: 'unsupported',
  energyCode: null,
  counterKwh: null,
  temperature: null,
  powerW: null,
  statusFields: [{ code: 'work_state', value: 'heating' }],
};
const snapshot = {
  homes: [{ id: 'h', name: 'Home', devices: [device, { ...device, id: 'other' }] }],
};
function fixture(tuya: TuyaCall) {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
    'a',
    'A',
    encrypt(session, config.encryptionKey),
  );
  let now = Date.parse('2026-10-16T10:00Z');
  const collector = new Collector(db, config, tuya, () => now);
  const advance = (ms = minute) => (now += ms);
  return { db, collector, advance, now: () => now };
}

test('collector reads full inventory every five minutes and only enabled thermostat states between, preserving refreshed credentials', async () => {
  const calls: { operation: string; payload: any }[] = [];
  const renewed = { ...session, token_info: { ...session.token_info, access_token: 'new' } };
  const f = fixture(async (operation, payload) => {
    calls.push({ operation, payload });
    return operation === 'read'
      ? { ok: true, snapshot, session: renewed }
      : { ok: true, states: [device], session: renewed };
  });
  try {
    assert.equal(config.statusPollSeconds, 60);
    await f.collector.sync(false);
    const d = devicesFor(f.db).find((d) => d.remote_id === 'd')!;
    configureEstimation(
      f.db,
      d.id,
      {
        enabled: true,
        ratedPowerKw: 2,
        heatingCode: 'work_state',
        onValues: ['heating'],
        offValues: ['idle'],
      },
      f.now(),
    );
    for (let i = 0; i < 5; i++) {
      f.advance();
      await f.collector.sync(false);
    }
    assert.deepEqual(
      calls.map((c) => c.operation),
      ['read', 'states', 'states', 'states', 'states', 'read'],
    );
    assert.deepEqual(calls[1].payload.deviceIds, ['d']);
    assert.equal(calls[1].payload.session.token_info.access_token, 'new');
    assert.equal(usage(f.db, [d], f.now() - 5 * minute, f.now(), f.now()).estimatedKwh, 0.133333);
    assert.equal(getDevice(f.db, d.id, f.now())?.estimation.state, 'on');
  } finally {
    await f.collector.stop();
    f.db.close();
  }
});

test('failed, omitted and offline responses break relay continuity and retain refresh tokens on failure', async () => {
  let response: any = { ok: true, snapshot, session };
  const f = fixture(async () => response);
  try {
    await f.collector.sync(false);
    const d = devicesFor(f.db).find((d) => d.remote_id === 'd')!;
    configureEstimation(
      f.db,
      d.id,
      {
        enabled: true,
        ratedPowerKw: 2,
        heatingCode: 'work_state',
        onValues: ['heating'],
        offValues: ['idle'],
      },
      f.now(),
    );
    for (const bad of [
      {
        ok: false,
        session: { ...session, token_info: { ...session.token_info, access_token: 'rotated' } },
      },
      { ok: true, states: [] },
      { ok: true, states: [{ ...device, online: false }] },
    ]) {
      response = { ok: true, states: [device] };
      f.advance(30000);
      await f.collector.sync(false);
      assert.equal(getDevice(f.db, d.id, f.now())?.estimation.state, 'on');
      response = bad;
      f.advance(30000);
      await f.collector.sync(false);
      assert.equal(getDevice(f.db, d.id, f.now())?.estimation.state, 'unknown');
    }
    assert.equal(usage(f.db, devicesFor(f.db), f.now() - 6 * minute, f.now(), f.now()).kwh, null);
    const saved = decrypt(
      (f.db.prepare('SELECT secret FROM accounts').get() as any).secret,
      config.encryptionKey,
    ) as typeof session;
    assert.equal(saved.token_info.access_token, 'rotated');
  } finally {
    await f.collector.stop();
    f.db.close();
  }
});

test('concurrent/manual synchronization is serialized and cannot overwrite a reconnected session', async () => {
  let finish: (value: any) => void = () => {};
  let count = 0;
  const f = fixture(async () => {
    count++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = f.collector.sync();
  const second = f.collector.sync();
  assert.equal(count, 1);
  f.db
    .prepare("UPDATE accounts SET secret=? WHERE id='a'")
    .run(encrypt({ ...session, user_code: 'reconnected' }, config.encryptionKey));
  finish({ ok: true, snapshot, session });
  await Promise.all([first, second]);
  assert.equal(devicesFor(f.db).length, 0);
  assert.equal(
    (
      decrypt(
        (f.db.prepare('SELECT secret FROM accounts').get() as any).secret,
        config.encryptionKey,
      ) as any
    ).user_code,
    'reconnected',
  );
  await f.collector.stop();
  f.db.close();
});

test('an error from an old request cannot mark a reconnected account as failing', async () => {
  let fail: (reason: Error) => void = () => {};
  const f = fixture(
    async () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const running = f.collector.sync();
  f.db
    .prepare("UPDATE accounts SET secret=? WHERE id='a'")
    .run(encrypt({ ...session, user_code: 'reconnected' }, config.encryptionKey));
  fail(new Error('old credentials'));
  await running;
  assert.equal((f.db.prepare('SELECT error FROM accounts').get() as any).error, null);
  await f.collector.stop();
  f.db.close();
});
