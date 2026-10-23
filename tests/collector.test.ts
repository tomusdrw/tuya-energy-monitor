import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { Collector } from '../server/collector.js';
import { loadConfig } from '../server/config.js';
import { encrypt, decrypt } from '../server/crypto.js';
import { devicesFor, getDevice, usage } from '../server/energy.js';
import { configureEstimation } from '../server/estimation.js';
import type { TuyaCall } from '../server/tuya.js';
import type { StreamFactory } from '../server/stream.js';
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
function fixture(tuya: TuyaCall, streamFactory?: StreamFactory) {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
    'a',
    'A',
    encrypt(session, config.encryptionKey),
  );
  let now = Date.parse('2026-10-16T10:00Z');
  const collector = new Collector(db, config, tuya, () => now, streamFactory);
  const advance = (ms = minute) => (now += ms);
  return { db, collector, advance, now: () => now };
}

test('collector polls native power without estimation and breaks continuity on failed inventory or status reads', async () => {
  let fail = false;
  const powered = {
    ...device,
    energyKind: 'power',
    powerField: { code: 'cur_power', scale: 1, unit: 'W' },
    powerW: 1200,
    statusFields: [{ code: 'cur_power', value: 12000 }],
  };
  const f = fixture(async (operation, payload) => {
    if (fail) return { ok: false };
    if (operation === 'states') {
      assert.deepEqual(payload.deviceIds, ['d']);
      return { ok: true, states: [powered] };
    }
    return { ok: true, snapshot: { homes: [{ id: 'h', name: 'H', devices: [powered] }] } };
  });
  try {
    await f.collector.sync(false);
    const id = devicesFor(f.db)[0].id;
    f.advance();
    await f.collector.sync(false);
    assert.equal(getDevice(f.db, id, f.now())!.stats.powerKwh, 0.02);
    for (const forceFull of [false, true]) {
      fail = true;
      f.advance();
      await f.collector.sync(forceFull);
      assert.equal(getDevice(f.db, id, f.now())!.fresh, false);
      fail = false;
      f.advance();
      await f.collector.sync(false);
      assert.equal(getDevice(f.db, id, f.now())!.stats.powerKwh, 0.02);
    }
  } finally {
    await f.collector.stop();
    f.db.close();
  }
});

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

test('live account worker ingests reports, persists token rotations and ignores superseded workers', async () => {
  const workers: { emit: (message: any) => void; stopped: boolean; calls: string[] }[] = [];
  const liveDevice = { ...device, energyKind: 'incremental', energyCode: 'add_ele' };
  const f = fixture(
    async () => {
      throw new Error('Live accounts must use a single token owner');
    },
    (_session, emit) => {
      const record = { emit, stopped: false, calls: [] as string[] };
      workers.push(record);
      return {
        alive: true,
        call: async (operation) => {
          record.calls.push(operation);
          if (operation === 'read')
            return {
              ok: true,
              snapshot: { homes: [{ id: 'h', name: 'H', devices: [liveDevice] }] },
            };
          return { ok: true };
        },
        stop: async () => {
          record.stopped = true;
        },
      };
    },
  );
  try {
    await f.collector.sync();
    assert.deepEqual(workers[0].calls, ['read', 'subscribe']);
    f.advance();
    workers[0].emit({
      type: 'session',
      session: { ...session, token_info: { ...session.token_info, access_token: 'rotated' } },
    });
    const saved = decrypt(
      (f.db.prepare('SELECT secret FROM accounts').get() as any).secret,
      config.encryptionKey,
    ) as any;
    assert.equal(saved.token_info.access_token, 'rotated');
    workers[0].emit({ type: 'stream', connected: true, deviceIds: ['d'] });
    const report = { deviceId: 'd', code: 'add_ele', at: f.now(), kwh: 0.12 };
    workers[0].emit({ type: 'energy', report });
    workers[0].emit({ type: 'energy', report });
    f.advance(1);
    const d = devicesFor(f.db)[0];
    assert.equal(getDevice(f.db, d.id, f.now())?.stats.kwh, 0.12);
    assert.equal(getDevice(f.db, d.id, f.now())?.reportingConnected, true);
    await f.collector.sync();
    assert.equal(workers.length, 1, 'Own token refresh must not restart MQTT');
    f.db
      .prepare('UPDATE accounts SET secret=?')
      .run(encrypt({ ...session, user_code: 'reconnected' }, config.encryptionKey));
    workers[0].emit({ type: 'energy', report: { ...report, at: f.now(), kwh: 99 } });
    workers[0].emit({ type: 'session', session });
    await f.collector.sync();
    assert.equal(workers.length, 2);
    assert.equal(workers[0].stopped, true);
    assert.equal(getDevice(f.db, d.id, f.now())?.stats.kwh, 0.12);
  } finally {
    await f.collector.stop();
    assert.ok(workers.every((worker) => worker.stopped));
    f.db.close();
  }
});

test('shutdown while retiring a reconnected worker cannot create a replacement after stop', async () => {
  let release!: () => void;
  let stopping!: () => void;
  const enteredStop = new Promise<void>((resolve) => {
    stopping = resolve;
  });
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  let created = 0;
  const f = fixture(
    async () => ({ ok: false }),
    () => {
      created++;
      return {
        alive: true,
        call: async () => ({ ok: true, snapshot }),
        stop: async () => {
          stopping();
          await stopped;
        },
      };
    },
  );
  try {
    await f.collector.sync();
    f.db
      .prepare('UPDATE accounts SET secret=?')
      .run(encrypt({ ...session, user_code: 'new' }, config.encryptionKey));
    const collecting = f.collector.sync();
    await enteredStop;
    const shutdown = f.collector.stop();
    release();
    await Promise.all([collecting, shutdown]);
    assert.equal(created, 1);
  } finally {
    release();
    await f.collector.stop();
    f.db.close();
  }
});

test('another account rotating tokens during collection retains its live worker and latest credentials', async () => {
  const listeners: ((message: any) => void)[] = [];
  let rotate = false;
  const f = fixture(
    async () => ({ ok: false }),
    (_session, emit) => {
      const index = listeners.push(emit) - 1;
      return {
        alive: true,
        call: async (operation) => {
          if (index === 0 && operation === 'read' && rotate) {
            listeners[1]({
              type: 'session',
              session: {
                ...session,
                token_info: { ...session.token_info, access_token: 'fresh-b' },
              },
            });
            rotate = false;
          }
          return { ok: true, snapshot };
        },
        stop: async () => {},
      };
    },
  );
  try {
    f.db
      .prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)')
      .run('b', 'B', encrypt(session, config.encryptionKey));
    await f.collector.sync();
    assert.equal(listeners.length, 2);
    rotate = true;
    f.advance();
    await f.collector.sync();
    assert.equal(listeners.length, 2);
    const saved = decrypt(
      (f.db.prepare("SELECT secret FROM accounts WHERE id='b'").get() as any).secret,
      config.encryptionKey,
    ) as any;
    assert.equal(saved.token_info.access_token, 'fresh-b');
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

test('a failed inventory refresh preserves minute relay polling and retries inventory on its own cadence', async () => {
  const calls: string[] = [];
  let firstInventory = true;
  const f = fixture(async (operation) => {
    calls.push(operation);
    if (operation === 'states') return { ok: true, states: [device] };
    if (firstInventory) {
      firstInventory = false;
      return { ok: true, snapshot };
    }
    return { ok: false }; // An unrelated device's specification endpoint is broken.
  });
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
    for (let i = 0; i < 5; i++) {
      f.advance();
      await f.collector.sync(false);
    }
    assert.equal(getDevice(f.db, d.id, f.now())?.estimation.state, 'unknown');
    f.advance();
    await f.collector.sync(false);
    assert.equal(calls.at(-1), 'states', 'Failure must not starve the independent relay endpoint');
    assert.equal(getDevice(f.db, d.id, f.now())?.estimation.state, 'on');
    for (let i = 0; i < 4; i++) {
      f.advance();
      await f.collector.sync(false);
    }
    assert.deepEqual(calls, [
      'read',
      'states',
      'states',
      'states',
      'states',
      'read',
      'states',
      'states',
      'states',
      'states',
      'read',
    ]);
    const stats = usage(f.db, devicesFor(f.db), f.now() - 10 * minute, f.now(), f.now());
    assert.equal(stats.estimatedKwh, 0.2, 'Only the six minutes bounded by healthy readings count');
    assert.ok(
      (f.db.prepare('SELECT error FROM accounts').get() as any).error,
      'Inventory failure remains visible',
    );
  } finally {
    await f.collector.stop();
    f.db.close();
  }
});

test('collector failures store a safe English account error', async () => {
  const f = fixture(async () => {
    throw new Error('secret upstream failure');
  });
  try {
    await f.collector.sync();
    assert.equal(
      (f.db.prepare('SELECT error FROM accounts').get() as any).error,
      'Could not read the account. Sync again; if the problem persists, reconnect the account.',
    );
  } finally {
    await f.collector.stop();
    f.db.close();
  }
});
