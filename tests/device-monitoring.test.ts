import { removePushSchema } from './helpers/schema.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { getHome, ingestSnapshot } from '../server/energy.js';
import { evaluateNotifications } from '../server/notifications.js';
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

const snapshot = {
  homes: [
    {
      id: 'home',
      name: 'Milicka',
      devices: [
        {
          id: 'meter',
          name: 'Meter',
          category: 'tdq',
          online: true,
          energyKind: 'incremental',
          energyCode: 'add_ele',
          counterKwh: null,
          temperature: null,
          powerW: null,
        },
        {
          id: 'sensor',
          name: 'Sensor',
          category: 'jqbj',
          online: true,
          energyKind: 'unsupported',
          energyCode: null,
          counterKwh: null,
          temperature: 21,
          powerW: null,
        },
      ],
    },
  ],
};

function seed(db: ReturnType<typeof openDatabase>) {
  const now = Date.now();
  db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
  ingestSnapshot(db, 'a', snapshot, now);
  const meter = db.prepare("SELECT id,home_id FROM devices WHERE remote_id='meter'").get() as {
    id: string;
    home_id: string;
  };
  db.prepare(
    'INSERT INTO energy_reports(device_id,code,report_id,at,kwh,received_at) VALUES(?,?,?,?,?,?)',
  ).run(meter.id, 'add_ele', 'report', now - 1, 1.25, now);
  return { now, id: meter.id, homeId: meter.home_id };
}

async function setup() {
  const db = openDatabase(':memory:');
  const fixture = seed(db);
  const app = await createApp(config, { db, background: false });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: config.origin },
    payload: { password: config.password },
  });
  const headers = {
    cookie: String(login.headers['set-cookie']).split(';')[0],
    origin: config.origin,
  };
  const update = (payload: unknown, id = fixture.id) =>
    app.inject({
      method: 'PUT',
      url: `/api/devices/${id}`,
      headers,
      payload,
    });
  const device = async () =>
    (await app.inject({ url: `/api/devices/${fixture.id}`, headers })).json();
  const overview = async () => (await app.inject({ url: '/api/overview', headers })).json();
  return { db, app, headers, update, device, overview, ...fixture };
}

const estimation = {
  enabled: true,
  ratedPowerKw: 1.25,
  heatingCode: 'work_state',
  onValues: ['heating'],
  offValues: ['idle'],
  temperature: null,
};

test('device configuration saves participation and estimation together and returns the saved state', async () => {
  const f = await setup();
  try {
    await f.update({ ignored: true });
    const response = await f.update({ included: true, estimation });
    assert.equal(response.statusCode, 200);
    const saved = response.json().device;
    assert.equal(saved.included, true);
    assert.equal(saved.ignored, false);
    assert.equal(saved.estimation.ratedPowerKw, 1.25);
    assert.equal(saved.estimation.enabled, true);
    const revision = saved.estimation.revision;
    assert.equal((await f.update({ included: false, estimation })).statusCode, 200);
    assert.equal((await f.device()).estimation.revision, revision);
    assert.equal((await f.device()).included, false);
  } finally {
    await f.app.close();
  }
});

test('invalid estimation and storage failures leave the entire device configuration unchanged', async () => {
  const f = await setup();
  try {
    const before = await f.device();
    const invalid = await f.update({
      included: false,
      estimation: { ...estimation, ratedPowerKw: -1 },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal((await f.device()).included, before.included);
    assert.equal((await f.device()).estimation.revision, before.estimation.revision);
    f.db.exec(`CREATE TRIGGER reject_configuration BEFORE INSERT ON heating_observations
      BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END`);
    assert.equal((await f.update({ included: false, estimation })).statusCode, 500);
    const after = await f.device();
    assert.equal(after.included, before.included);
    assert.equal(after.estimation.enabled, before.estimation.enabled);
    assert.equal(after.estimation.revision, before.estimation.revision);
  } finally {
    await f.app.close();
  }
});

test('ignoring removes a device from totals while preserving its history and survives synchronization', async () => {
  const f = await setup();
  try {
    assert.equal((await f.overview()).stats.kwh, 1.25);
    assert.equal((await f.update({ ignored: true })).statusCode, 200);
    const ignored = await f.device();
    assert.equal(ignored.ignored, true);
    assert.equal(ignored.included, false);
    assert.equal(ignored.stats.kwh, 1.25);
    assert.equal(ignored.history.at(-1).kwh, 1.25);
    assert.equal((await f.overview()).stats.kwh, null);
    assert.equal((await f.overview()).stats.monitored, 0);
    f.db.prepare('UPDATE homes SET daily_limit=1,anomaly_enabled=0 WHERE id=?').run(f.homeId);
    evaluateNotifications(f.db, Date.now());
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE kind='threshold'").get()
        ?.count,
      0,
    );

    ingestSnapshot(f.db, 'a', snapshot, f.now + 1000);
    const home = getHome(f.db, f.homeId, f.now + 1001)!;
    assert.equal(home.devices.find((d) => d.id === f.id)?.ignored, true);
    assert.equal(home.devices.find((d) => d.name === 'Sensor')?.ignored, false);
    assert.equal(home.stats.monitored, 0);

    assert.equal((await f.update({ ignored: false })).statusCode, 200);
    assert.equal((await f.device()).ignored, false);
    assert.equal((await f.device()).included, false);
    assert.equal((await f.overview()).stats.kwh, null);
    assert.equal((await f.update({ included: true })).statusCode, 200);
    assert.equal((await f.overview()).stats.kwh, 1.25);
    evaluateNotifications(f.db, Date.now());
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE kind='threshold'").get()
        ?.count,
      1,
    );
  } finally {
    await f.app.close();
  }
});

test('explicit inclusion restores an ignored device and invalid updates cannot change its status', async () => {
  const f = await setup();
  try {
    assert.equal((await f.update({ ignored: true })).statusCode, 200);
    for (const payload of [
      {},
      { ignored: 'yes' },
      { included: null },
      { ignored: true, included: true },
      { ignored: false, extra: 1 },
    ]) {
      assert.equal((await f.update(payload)).statusCode, 400);
      assert.equal((await f.device()).ignored, true);
      assert.equal((await f.device()).included, false);
    }
    assert.equal((await f.update({ included: false })).statusCode, 200);
    assert.equal((await f.device()).ignored, true);
    assert.equal((await f.update({ included: true })).statusCode, 200);
    assert.equal((await f.device()).ignored, false);
    assert.equal((await f.device()).included, true);
    assert.equal((await f.update({ ignored: true }, 'missing')).statusCode, 404);
    assert.equal(
      (
        await f.app.inject({
          method: 'PUT',
          url: `/api/devices/${f.id}`,
          headers: { origin: config.origin },
          payload: { ignored: true },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'PUT',
          url: `/api/devices/${f.id}`,
          headers: { ...f.headers, origin: 'https://other.example' },
          payload: { ignored: true },
        })
      ).statusCode,
      403,
    );
    assert.equal((await f.device()).included, true);
  } finally {
    await f.app.close();
  }
});

test('v5 migration preserves selections, energy and Tuya.ai configuration and persists ignored status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tem-ignored-'));
  try {
    const path = join(dir, 'monitor.sqlite');
    const prior = openDatabase(path);
    const f = seed(prior);
    prior
      .prepare(
        'INSERT INTO power_observations(device_id,at,power_w,field,source) VALUES(?,?,?,?,?)',
      )
      .run(f.id, f.now - 2000, 400, 'cur_power', 'poll');
    prior.exec("UPDATE accounts SET ai_secret='encrypted-test-key',ai_revision=2,ai_region='EU'");
    prior.prepare('INSERT INTO ai_models VALUES(?,?,?,?)').run(f.id, 2, f.now, '[]');
    // Recreate the previous version without the new column, with populated data.
    if (
      prior
        .prepare('PRAGMA table_info(devices)')
        .all()
        .some((c) => c.name === 'ignored')
    )
      prior.exec('ALTER TABLE devices DROP COLUMN ignored');
    prior.exec('ALTER TABLE devices DROP COLUMN temperature_config');
    prior.exec('ALTER TABLE devices DROP COLUMN temperature_metadata');
    prior.exec('DROP TABLE climate_observations');
    prior.exec('ALTER TABLE devices DROP COLUMN humidity');
    prior.exec('ALTER TABLE devices DROP COLUMN climate_at');
    removePushSchema(prior);
    prior.exec('PRAGMA user_version=5');
    prior.close();

    const migrated = openDatabase(path);
    try {
      assert.equal(migrated.prepare('PRAGMA user_version').get()?.user_version, 9);
      const home = getHome(migrated, f.homeId, f.now + 1)!;
      assert.equal(home.devices.find((d) => d.id === f.id)?.included, true);
      assert.equal(home.devices.find((d) => d.name === 'Sensor')?.included, false);
      assert.ok(home.devices.every((d) => d.ignored === false));
      assert.equal(home.stats.kwh, 1.25);
      assert.equal(migrated.prepare('SELECT power_w FROM power_observations').get()?.power_w, 400);
      migrated.prepare('UPDATE devices SET ignored=1,included=0 WHERE id=?').run(f.id);
    } finally {
      migrated.close();
    }
    const reopened = openDatabase(path);
    try {
      const home = getHome(reopened, f.homeId, f.now + 1)!;
      assert.equal(home.devices.find((d) => d.id === f.id)?.ignored, true);
      assert.equal(home.stats.kwh, null);
      assert.equal(reopened.prepare('SELECT kwh FROM energy_reports').get()?.kwh, 1.25);
      assert.equal(
        reopened.prepare('SELECT ai_secret FROM accounts').get()?.ai_secret,
        'encrypted-test-key',
      );
      assert.equal(reopened.prepare('SELECT revision FROM ai_models').get()?.revision, 2);
      assert.equal(
        reopened.prepare('SELECT measurement_at FROM devices WHERE id=?').get(f.id)?.measurement_at,
        f.now,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
