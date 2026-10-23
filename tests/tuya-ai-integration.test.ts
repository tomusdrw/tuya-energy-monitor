import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { TuyaAiIntegration } from '../server/tuya-ai-integration.js';
import { loadConfig } from '../server/config.js';
import { encrypt, decrypt, scopedId } from '../server/crypto.js';
import { ingestSnapshot, getDevice, accounts } from '../server/energy.js';
import type { AiClient } from '../server/tuya-ai.js';
const config = loadConfig({ ADMIN_PASSWORD: 'test-password', ENCRYPTION_KEY: 'ab'.repeat(32) });
const key = 'sk-EUtest-key';
const meter = { code: 'forward_energy_total', dpId: 101, scale: 3, unit: 'kwh' as const };
const id = scopedId('a', 'd');
function setup(file = ':memory:') {
  const db = openDatabase(file);
  let now = Date.parse('2026-10-23T10:00Z');
  const device = {
    id: 'd',
    name: 'Same name',
    category: 'qn',
    online: true,
    energyKind: 'unsupported',
    energyCode: null,
    counterKwh: null,
    temperature: null,
    powerW: null,
  };
  for (const account of ['a', 'b']) {
    db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
      account,
      account,
      encrypt({ qr: account }, config.encryptionKey),
    );
    ingestSnapshot(
      db,
      account,
      {
        homes: [
          { id: 'h', name: 'H', devices: [{ ...device, id: account === 'a' ? 'd' : 'other' }] },
        ],
      },
      now,
    );
  }
  let value = 370;
  let fail = false;
  let lists = ['d'];
  const counts = { model: 0, detail: 0 };
  const client: AiClient = {
    list: async () => {
      if (fail) throw new Error(key);
      return lists;
    },
    model: async () => {
      counts.model++;
      if (fail) throw new Error(key);
      return [meter];
    },
    detail: async (_key, deviceId) => {
      counts.detail++;
      if (fail) throw new Error(key);
      return { device_id: deviceId, online: true, properties: { forward_energy_total: value } };
    },
  };
  const service = new TuyaAiIntegration(db, config, client, () => now);
  return {
    db,
    client,
    service,
    counts,
    advance: (ms = 300000) => (now += ms),
    now: () => now,
    value: (v: number) => (value = v),
    fail: (v: boolean) => (fail = v),
    list: (v: string[]) => (lists = v),
  };
}

test('validated account key is encrypted, never returned, independent of QR refresh, failed replacement preserves configuration', async () => {
  const f = setup();
  try {
    await f.service.save('a', key);
    const saved = f.db.prepare("SELECT * FROM accounts WHERE id='a'").get() as any;
    assert.notEqual(saved.ai_secret, key);
    assert.equal(decrypt(saved.ai_secret, config.encryptionKey), key);
    assert.ok(!JSON.stringify(accounts(f.db)).includes(key));
    await f.service.sync();
    f.db
      .prepare("UPDATE accounts SET secret=? WHERE id='a'")
      .run(encrypt({ qr: 'rotated' }, config.encryptionKey));
    f.fail(true);
    await assert.rejects(f.service.save('a', 'sk-EUreplacement'));
    assert.equal(
      (f.db.prepare("SELECT ai_secret FROM accounts WHERE id='a'").get() as any).ai_secret,
      saved.ai_secret,
    );
    assert.equal(
      (f.db.prepare("SELECT ai_revision FROM accounts WHERE id='a'").get() as any).ai_revision,
      saved.ai_revision,
    );
  } finally {
    await f.service.stop();
    f.db.close();
  }
});

test('exact known device IDs establish access, never equal names or another account inventory', async () => {
  const f = setup();
  try {
    await assert.rejects(f.service.save('b', key), /devices/);
    f.list(['foreign']);
    await assert.rejects(f.service.save('a', key), /devices/);
    assert.equal(
      accounts(f.db).every((a) => !a.tuyaAi.configured),
      true,
    );
  } finally {
    await f.service.stop();
    f.db.close();
  }
});

test('collection is five-minute paced, caches metadata across service restart, and isolates API failure from QR', async () => {
  const f = setup();
  let second: TuyaAiIntegration | undefined;
  try {
    await f.service.save('a', key);
    await f.service.sync();
    f.value(420);
    f.advance(60000);
    await f.service.sync();
    assert.equal(f.counts.detail, 1);
    f.advance(240000);
    await f.service.sync();
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.05);
    assert.equal(f.counts.model, 1);
    await f.service.stop();
    second = new TuyaAiIntegration(f.db, config, f.client, f.now);
    f.advance();
    f.value(470);
    await second.sync();
    assert.equal(f.counts.model, 1);
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.1);
    f.fail(true);
    f.advance();
    await second.sync();
    const a = accounts(f.db, f.now()).find((a) => a.id === 'a')!;
    assert.equal(a.error, null);
    assert.ok(a.tuyaAi.error);
    assert.ok(!a.tuyaAi.error.includes(key));
    assert.equal(a.tuyaAi.lastSuccess, f.now() - 300000);
    assert.equal(getDevice(f.db, id, f.now())!.fresh, false);
    f.fail(false);
    f.advance();
    f.value(600);
    await second.sync();
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.1);
  } finally {
    await second?.stop();
    await f.service.stop();
    f.db.close();
  }
});

test('deleting a key keeps history and invalidates in-flight reads; replacement uses a new baseline', async () => {
  const f = setup();
  try {
    await f.service.save('a', key);
    await f.service.sync();
    f.advance();
    f.value(420);
    await f.service.sync();
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (entered = resolve));
    const original = f.client.detail;
    f.client.detail = async () => {
      entered();
      return new Promise((resolve) => (release = resolve));
    };
    f.advance();
    const running = f.service.sync();
    await pending;
    f.service.remove('a');
    release({ device_id: 'd', online: true, properties: { forward_energy_total: 900 } });
    await running;
    assert.equal(accounts(f.db).find((a) => a.id === 'a')!.tuyaAi.configured, false);
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.05);
    assert.equal(getDevice(f.db, id, f.now())!.energySource, 'missing');
    f.client.detail = original;
    await f.service.save('a', 'sk-EUreplacement');
    f.advance();
    f.value(1000);
    await f.service.sync();
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.05);
    f.advance();
    f.value(1050);
    await f.service.sync();
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.1);
  } finally {
    await f.service.stop();
    f.db.close();
  }
});

test('deleting during validation wins and a late save cannot restore credentials', async () => {
  const f = setup();
  try {
    await f.service.save('a', key);
    let release!: (value: string[]) => void;
    f.client.list = async () => new Promise((resolve) => (release = resolve));
    const saving = f.service.save('a', 'sk-EUreplacement');
    f.service.remove('a');
    release(['d']);
    await assert.rejects(saving, /changed/);
    assert.equal(accounts(f.db).find((a) => a.id === 'a')!.tuyaAi.configured, false);
  } finally {
    await f.service.stop();
    f.db.close();
  }
});

test('AI starts independently of an unfinished QR inventory', async () => {
  const { Collector } = await import('../server/collector.js');
  const f = setup();
  let finish!: (value: any) => void;
  let aiFinished!: () => void;
  const complete = new Promise<void>((resolve) => (aiFinished = resolve));
  f.service.afterSync = async () => {
    aiFinished();
  };
  const session = {
    user_code: 'user',
    terminal_id: 'terminal',
    endpoint: 'https://apigw.tuyaeu.com',
    token_info: {
      t: 0,
      uid: 'uid',
      expire_time: 9999999999,
      access_token: 'test',
      refresh_token: 'test',
    },
  };
  f.db.prepare('UPDATE accounts SET secret=?').run(encrypt(session, config.encryptionKey));
  let blocked = true;
  const collector = new Collector(
    f.db,
    config,
    async () =>
      blocked
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ok: false },
    f.now,
    undefined,
    f.service,
  );
  try {
    // Only a is needed; b has homes so leave it but make its adapter return immediately.
    await f.service.save('a', key);
    const qr = collector.sync();
    let ran = false;
    await Promise.race([
      complete.then(() => (ran = true)),
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
    assert.equal(ran, true, 'A deferred QR request must not gate AI reads');
    assert.equal(getDevice(f.db, id, f.now())!.counterKwh, 0.37);
    blocked = false;
    finish({ ok: false });
    await qr;
  } finally {
    finish?.({ ok: false });
    await collector.stop();
    f.db.close();
  }
});

test('partial device authorization is honored and one device failure does not suppress permitted siblings', async () => {
  const { TuyaAiError } = await import('../server/tuya-ai.js');
  const f = setup();
  try {
    const home = (f.db.prepare("SELECT id FROM homes WHERE account_id='a'").get() as any).id;
    f.db
      .prepare(
        `INSERT INTO devices(id,home_id,remote_id,name,category,included,online,energy_kind)
      VALUES('000-first',?,'denied','Same name','wk',1,1,'unsupported')`,
      )
      .run(home);
    const original = f.client.model;
    const requested: string[] = [];
    f.client.model = async (key, deviceId) => {
      requested.push(deviceId);
      if (deviceId === 'denied') throw new TuyaAiError('access');
      return original(key, deviceId);
    };
    await f.service.save('a', key);
    await f.service.sync();
    assert.deepEqual(requested, ['d'], 'Never probe devices outside current key authorization');
    assert.equal(getDevice(f.db, id, f.now())!.counterKwh, 0.37);
    // Now both are listed, but one has a broken detail/model permission.
    f.list(['denied', 'd']);
    f.advance();
    f.value(420);
    await f.service.sync();
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.05);
    assert.ok(accounts(f.db, f.now()).find((a) => a.id === 'a')!.tuyaAi.error);
  } finally {
    await f.service.stop();
    f.db.close();
  }
});

test('bounded collection rotates actual attempts so slow devices do not permanently starve the tail', async () => {
  const f = setup();
  try {
    const home = (f.db.prepare("SELECT id FROM homes WHERE account_id='a'").get() as any).id;
    const ids = ['d', ...Array.from({ length: 11 }, (_, i) => `extra-${i}`)];
    for (const remote of ids.slice(1))
      f.db
        .prepare(
          `INSERT INTO devices(id,home_id,remote_id,name,category,included,online,energy_kind)
      VALUES(?,?,?,'Heater','wk',1,1,'unsupported')`,
        )
        .run(scopedId('a', remote), home, remote);
    f.list(ids);
    const counts = new Map<string, number>();
    const detail = f.client.detail;
    f.client.detail = async (key, remote) => {
      f.advance(9900);
      counts.set(remote, (counts.get(remote) ?? 0) + 1);
      return detail(key, remote);
    };
    await f.service.save('a', key);
    for (let i = 0; i < 3; i++) {
      await f.service.sync();
      f.advance();
    }
    assert.equal(counts.size, 12, 'All authorized meters must eventually be read');
    assert.ok([...counts.values()].every((count) => count >= 2));
  } finally {
    await f.service.stop();
    f.db.close();
  }
});

test('metadata expires after 24 hours and a changed model scale starts a new series', async () => {
  const f = setup();
  try {
    await f.service.save('a', key);
    await f.service.sync();
    f.advance();
    f.value(420);
    await f.service.sync();
    f.advance(24 * 3600000);
    f.client.model = async () => {
      f.counts.model++;
      return [{ ...meter, scale: 0 }];
    };
    await f.service.sync();
    assert.equal(f.counts.model, 2);
    assert.equal(getDevice(f.db, id, f.now())!.counterKwh, 420);
    assert.equal(
      (f.db.prepare('SELECT SUM(kwh) AS total FROM intervals').get() as any).total,
      0.05,
    );
  } finally {
    await f.service.stop();
    f.db.close();
  }
});

test('successful replacement invalidates an outstanding model response and starts a new baseline', async () => {
  const f = setup();
  try {
    await f.service.save('a', key);
    await f.service.sync();
    f.advance();
    f.value(420);
    await f.service.sync();
    f.db.exec('DELETE FROM ai_models');
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (entered = resolve));
    let release!: (value: any) => void;
    const model = f.client.model;
    f.client.model = async () => {
      entered();
      return new Promise((resolve) => (release = resolve));
    };
    f.advance();
    const running = f.service.sync();
    await pending;
    await f.service.save('a', 'sk-EUreplacement');
    release([{ ...meter, scale: 0 }]);
    await running;
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_models').get() as any).n, 0);
    f.client.model = model;
    f.value(900);
    f.advance();
    await f.service.sync();
    assert.equal(getDevice(f.db, id, f.now())!.counterKwh, 0.9);
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.05);
    f.value(950);
    f.advance();
    await f.service.sync();
    assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.1);
  } finally {
    await f.service.stop();
    f.db.close();
  }
});

test('encrypted key, metadata and baseline survive a full database and service restart', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'tem-ai-restart-'));
  const file = join(dir, 'state.sqlite');
  const f = setup(file);
  let reopened: ReturnType<typeof openDatabase> | undefined;
  let service: TuyaAiIntegration | undefined;
  try {
    await f.service.save('a', key);
    await f.service.sync();
    await f.service.stop();
    f.db.close();
    reopened = openDatabase(file);
    service = new TuyaAiIntegration(reopened, config, f.client, f.now);
    f.advance();
    f.value(420);
    await service.sync();
    assert.equal(f.counts.model, 1);
    assert.equal(getDevice(reopened, id, f.now())!.stats.kwh, 0.05);
    assert.equal(
      decrypt(
        (reopened.prepare("SELECT ai_secret FROM accounts WHERE id='a'").get() as any).ai_secret,
        config.encryptionKey,
      ),
      key,
    );
  } finally {
    await service?.stop();
    await f.service.stop();
    if (f.db.isOpen) f.db.close();
    reopened?.close();
    rmSync(dir, { recursive: true });
  }
});

test(
  'background AI timer continues while QR is still awaiting its first response',
  { timeout: 2000 },
  async (t) => {
    const { Collector } = await import('../server/collector.js');
    const f = setup();
    let release!: (value: any) => void;
    let blocked = true;
    const session = {
      user_code: 'user',
      terminal_id: 'terminal',
      endpoint: 'https://apigw.tuyaeu.com',
      token_info: {
        t: 0,
        uid: 'uid',
        expire_time: 9999999999,
        access_token: 'test',
        refresh_token: 'test',
      },
    };
    f.db.prepare('UPDATE accounts SET secret=?').run(encrypt(session, config.encryptionKey));
    const collector = new Collector(
      f.db,
      config,
      async () => (blocked ? new Promise((resolve) => (release = resolve)) : { ok: false }),
      f.now,
      undefined,
      f.service,
    );
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let done!: () => void;
    let finished = new Promise<void>((resolve) => (done = resolve));
    f.service.afterSync = async () => {
      done();
    };
    try {
      await f.service.save('a', key);
      collector.start();
      await finished;
      // Let the async tick install its next timer.
      await new Promise<void>((resolve) => setImmediate(resolve));
      finished = new Promise<void>((resolve) => (done = resolve));
      f.advance();
      f.value(420);
      t.mock.timers.tick(300000);
      await finished;
      assert.equal(getDevice(f.db, id, f.now())!.stats.kwh, 0.05);
    } finally {
      blocked = false;
      release?.({ ok: false });
      await collector.stop();
      f.db.close();
    }
  },
);
