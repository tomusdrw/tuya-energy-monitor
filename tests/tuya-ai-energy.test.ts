import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.js';
import {
  ingestSnapshot,
  ingestAiReading,
  failAiReading,
  getDevice,
  getOverview,
  dayBounds,
} from '../server/energy.js';
import {
  configureEstimation,
  recordHeatingState,
  ingestHeatingSnapshot,
} from '../server/estimation.js';
import { ingestEnergyReport } from '../server/incremental.js';
import { scopedId } from '../server/crypto.js';
const minute = 60000;
const start = Date.parse('2026-10-22T10:00Z');
const id = scopedId('a', 'heater');
const device = {
  id: 'heater',
  name: 'Heater',
  category: 'qn',
  online: true,
  energyKind: 'unsupported',
  energyCode: null,
  counterKwh: null,
  temperature: null,
  powerW: null,
  statusFields: [{ code: 'work_state', value: 'heating' }],
};
function inventory(db: any, now: number, changes = {}) {
  ingestSnapshot(
    db,
    'a',
    { homes: [{ id: 'h', name: 'H', devices: [{ ...device, ...changes }] }] },
    now,
  );
}
function fixture(file = ':memory:') {
  const db = openDatabase(file);
  db.exec(
    "INSERT INTO accounts(id,label,secret,ai_secret,ai_revision) VALUES('a','A','qr','encrypted-ai',1)",
  );
  inventory(db, start);
  return db;
}
function sample(
  db: any,
  at: number,
  value: number,
  online = true,
  revision = 1,
  series = 'DP101-scale3-kwh',
) {
  ingestAiReading(
    db,
    'a',
    'heater',
    { code: 'forward_energy_total', counterKwh: value, online, series },
    revision,
    at,
  );
}

test('first 0.370 is baseline; next 0.420 after five minutes adds exactly 0.050 through existing views', () => {
  const db = fixture();
  try {
    sample(db, start, 0.37);
    assert.equal(getDevice(db, id, start)!.stats.kwh, null);
    inventory(db, start + 5 * minute); // QR must not erase the AI baseline.
    sample(db, start + 5 * minute, 0.42);
    const view = getDevice(db, id, start + 5 * minute)!;
    assert.equal(view.stats.kwh, 0.05);
    assert.equal(view.stats.measuredKwh, 0.05);
    assert.equal(view.measurementProvider, 'tuya_ai');
    assert.equal(view.measurementAt, start + 5 * minute);
    assert.equal(getOverview(db, start + 5 * minute).stats.kwh, 0.05);
    assert.equal(getOverview(db, start + 5 * minute).history.at(-1)!.kwh, 0.05);
  } finally {
    db.close();
  }
});

test('estimation and QR cannot double count AI, and source changes require a fresh baseline', () => {
  const db = fixture();
  try {
    configureEstimation(
      db,
      id,
      {
        enabled: true,
        ratedPowerKw: 2,
        heatingCode: 'work_state',
        onValues: ['heating'],
        offValues: ['idle'],
      },
      start,
    );
    sample(db, start + minute, 0.37);
    for (let i = 2; i <= 6; i++)
      recordHeatingState(db, id, device.statusFields, true, start + i * minute);
    sample(db, start + 6 * minute, 0.42);
    ingestEnergyReport(
      db,
      'a',
      { deviceId: 'heater', code: 'add_ele', at: start + 5 * minute, kwh: 9 },
      start + 6 * minute,
    );
    assert.equal(getDevice(db, id, start + 6 * minute)!.stats.kwh, 0.05);
    inventory(db, start + 7 * minute, {
      energyKind: 'cumulative',
      energyCode: 'forward_energy_total',
      counterKwh: 90,
    });
    sample(db, start + 8 * minute, 1);
    assert.equal(getDevice(db, id, start + 8 * minute)!.stats.kwh, 0.05);
    inventory(db, start + 12 * minute, {
      energyKind: 'cumulative',
      energyCode: 'forward_energy_total',
      counterKwh: 90.1,
    });
    assert.equal(getDevice(db, id, start + 12 * minute)!.stats.kwh, 0.15);
  } finally {
    db.close();
  }
});

test('errors, offline states, reset, changed metadata and long gaps cannot manufacture consumption or freshness', () => {
  const db = fixture();
  try {
    sample(db, start, 0.37);
    sample(db, start + 5 * minute, 0.42);
    failAiReading(db, id, 'safe failure', start + 6 * minute);
    inventory(db, start + 7 * minute);
    assert.equal(getDevice(db, id, start + 7 * minute)!.fresh, false);
    assert.equal(getDevice(db, id, start + 7 * minute)!.measurementAt, start + 5 * minute);
    sample(db, start + 10 * minute, 1);
    sample(db, start + 15 * minute, 0.1); // reset
    sample(db, start + 20 * minute, 2, false);
    sample(db, start + 25 * minute, 3);
    sample(db, start + 45 * minute, 4); // gap
    sample(db, start + 50 * minute, 400, true, 1, 'scale0');
    assert.equal(getDevice(db, id, start + 50 * minute)!.stats.kwh, 0.05);
    sample(db, start + 55 * minute, 400.05, true, 1, 'scale0');
    assert.equal(getDevice(db, id, start + 55 * minute)!.stats.kwh, 0.1);
  } finally {
    db.close();
  }
});

test('credential revision and account ID reject stale or foreign readings', () => {
  const db = fixture();
  try {
    sample(db, start, 0.37);
    sample(db, start + 5 * minute, 2, true, 0);
    ingestAiReading(
      db,
      'b',
      'heater',
      { code: 'forward_energy_total', counterKwh: 9, online: true, series: 'DP101-scale3-kwh' },
      1,
      start + 5 * minute,
    );
    assert.equal(getDevice(db, id, start + 5 * minute)!.counterKwh, 0.37);
    db.exec('UPDATE accounts SET ai_secret=NULL,ai_revision=2');
    sample(db, start + 10 * minute, 9);
    assert.equal(getDevice(db, id, start + 10 * minute)!.stats.kwh, null);
  } finally {
    db.close();
  }
});

test('baseline survives database reopen; midnight and DST use existing Warsaw attribution', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tem-ai-'));
  const file = path.join(dir, 'db.sqlite');
  let db = fixture(file);
  try {
    const midnight = dayBounds('2026-10-25').start;
    sample(db, midnight - 5 * minute, 0.37);
    db.close();
    db = openDatabase(file);
    sample(db, midnight + 5 * minute, 0.42);
    const overview = getOverview(db, midnight + 5 * minute);
    assert.equal(overview.history.at(-2)!.kwh, 0.025);
    assert.equal(overview.history.at(-1)!.kwh, 0.025);
    assert.equal(overview.stats.complete, false);
    assert.equal(dayBounds('2026-10-25').end - midnight, 25 * 3600000);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

test('Tuya.ai measured usage reaches threshold alerts and weekly health reports stale AI despite fresh QR', async () => {
  const { evaluateNotifications } = await import('../server/notifications.js');
  const db = fixture();
  try {
    sample(db, start, 0.37);
    sample(db, start + 5 * minute, 0.42);
    db.exec('UPDATE homes SET daily_limit=0.04');
    failAiReading(
      db,
      id,
      'Could not read Tuya.ai. The next scheduled reading will retry.',
      start + 6 * minute,
    );
    inventory(db, start + 7 * minute);
    db.exec(
      "UPDATE accounts SET ai_error='Could not read Tuya.ai. The next scheduled reading will retry.'",
    );
    evaluateNotifications(db, start + 7 * minute);
    const threshold = db
      .prepare("SELECT body FROM notifications WHERE kind='threshold'")
      .get() as any;
    assert.match(threshold.body, /Measured: 0.05 kWh/);
    assert.match(threshold.body, /Partial total/);
    const weekly = db.prepare("SELECT body FROM notifications WHERE kind='weekly'").get() as any;
    assert.match(weekly.body, /Offline or stale: 1 \(Heater\)/);
    assert.match(weekly.body, /Tuya.ai: Could not read Tuya.ai/);
  } finally {
    db.close();
  }
});

test('real v3 schema upgrades without losing QR baselines, configuration or historical consumption', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tem-v3-'));
  const file = path.join(dir, 'db.sqlite');
  let db = new DatabaseSync(file);
  try {
    db.exec(readFileSync(new URL('./fixtures/schema-v3.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','A','encrypted-qr')");
    db.prepare("INSERT INTO homes(id,account_id,remote_id,name) VALUES(?,'a','h','H')").run(
      scopedId('a', 'h'),
    );
    db.prepare(
      `INSERT INTO devices(id,home_id,remote_id,name,category,included,online,energy_kind,energy_code,counter_kwh,last_seen)
      VALUES(?,?,'heater','Heater','qn',1,1,'cumulative','forward_energy_total',0.37,?)`,
    ).run(id, scopedId('a', 'h'), start);
    db.prepare(
      "INSERT INTO readings(device_id,at,counter_kwh,code,online) VALUES(?,?,0.37,'forward_energy_total',1)",
    ).run(id, start);
    db.prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,0.02)').run(
      id,
      start - 5 * minute,
      start,
    );
    db.close();
    db = openDatabase(file);
    assert.equal((db.prepare('SELECT secret FROM accounts').get() as any).secret, 'encrypted-qr');
    assert.equal((db.prepare('SELECT ai_secret FROM accounts').get() as any).ai_secret, null);
    inventory(db, start + 5 * minute, {
      energyKind: 'cumulative',
      energyCode: 'forward_energy_total',
      counterKwh: 0.42,
    });
    assert.equal(getDevice(db, id, start + 5 * minute)!.stats.kwh, 0.07);
    assert.equal(getDevice(db, id, start + 5 * minute)!.measurementProvider, 'qr');
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

test('native QR power retains precedence and transitions to and from Tuya.ai never overlap usage', () => {
  const db = fixture();
  const power = {
    energyKind: 'power',
    powerField: { code: 'cur_power', scale: 1, unit: 'W' },
    powerW: 1000,
    statusFields: [{ code: 'cur_power', value: 10000 }],
  };
  const fast = (at: number) =>
    ingestHeatingSnapshot(
      db,
      'a',
      [{ id: 'heater', online: true, statusFields: power.statusFields }],
      ['heater'],
      at,
    );
  try {
    inventory(db, start + minute, power);
    fast(start + 2 * minute);
    sample(db, start + 3 * minute, 0.37);
    assert.equal(getDevice(db, id, start + 3 * minute)!.energySource, 'power');
    assert.equal(getDevice(db, id, start + 3 * minute)!.counterKwh, null);

    inventory(db, start + 4 * minute);
    sample(db, start + 4 * minute, 0.37);
    fast(start + 5 * minute); // A delayed QR state must not resume power integration.
    sample(db, start + 9 * minute, 0.42);
    assert.equal(getDevice(db, id, start + 9 * minute)!.stats.measuredKwh, 0.05);

    inventory(db, start + 10 * minute, power);
    assert.equal(getDevice(db, id, start + 10 * minute)!.stats.powerKwh, 0.016667);
    sample(db, start + 11 * minute, 0.47);
    fast(start + 11 * minute);
    const view = getDevice(db, id, start + 11 * minute)!;
    assert.equal(view.energySource, 'power');
    assert.equal(view.stats.powerKwh, 0.033333);
    assert.equal(view.stats.measuredKwh, 0.05);
    assert.equal(view.stats.kwh, 0.083333);
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM intervals a JOIN intervals b
      ON a.device_id=b.device_id AND a.end<b.end AND a.start<b.end AND b.start<a.end`,
        )
        .get()!.n,
      0,
    );
  } finally {
    db.close();
  }
});

test('released native-power v4 database upgrades preserving power baselines and history', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tem-v4-'));
  const file = path.join(dir, 'db.sqlite');
  let db = new DatabaseSync(file);
  const field = JSON.stringify({ code: 'cur_power', scale: 1, unit: 'W' });
  try {
    db.exec(readFileSync(new URL('./fixtures/schema-v4.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','A','encrypted-qr')");
    db.prepare("INSERT INTO homes(id,account_id,remote_id,name) VALUES(?,'a','h','H')").run(
      scopedId('a', 'h'),
    );
    db.prepare(
      `INSERT INTO devices(id,home_id,remote_id,name,category,included,online,energy_kind,
      power_w,power_field,power_updated_at,last_seen,status_updated_at)
      VALUES(?,?,'heater','Heater','qn',1,1,'power',1000,?,?,?,?)`,
    ).run(id, scopedId('a', 'h'), field, start, start, start);
    db.prepare(
      "INSERT INTO power_observations(device_id,at,power_w,field,source) VALUES(?,?,1000,?,'power')",
    ).run(id, start, field);
    db.prepare(
      "INSERT INTO intervals(device_id,start,end,kwh,source) VALUES(?,?,?,0.02,'power')",
    ).run(id, start - minute, start);
    db.close();
    db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 9);
    assert.equal(db.prepare('SELECT secret FROM accounts').get()!.secret, 'encrypted-qr');
    assert.equal(db.prepare('SELECT ai_secret FROM accounts').get()!.ai_secret, null);
    assert.equal(db.prepare('SELECT qr_energy_kind FROM devices').get()!.qr_energy_kind, 'power');
    ingestHeatingSnapshot(
      db,
      'a',
      [{ id: 'heater', online: true, statusFields: [{ code: 'cur_power', value: 10000 }] }],
      ['heater'],
      start + minute,
    );
    assert.equal(getDevice(db, id, start + minute)!.stats.powerKwh, 0.036667);
    assert.equal(getDevice(db, id, start + minute)!.stats.measuredKwh, null);
    db.close();
    db = openDatabase(file);
    assert.equal(getDevice(db, id, start + minute)!.stats.powerKwh, 0.036667);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
