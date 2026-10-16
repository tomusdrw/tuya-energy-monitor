import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/db.js';
import { ingestSnapshot, getDevice, devicesFor, usage, dayBounds } from '../server/energy.js';
import {
  configureEstimation,
  recordHeatingState,
  ingestHeatingSnapshot,
} from '../server/estimation.js';

const minute = 60000;
const settings = {
  enabled: true,
  ratedPowerKw: 2,
  heatingCode: 'work_state',
  onValues: ['heating'],
  offValues: ['idle', 'standby'],
};
export function estimationFixture(path = ':memory:', start = Date.parse('2026-10-16T10:00:00Z')) {
  const db = openDatabase(path);
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
    'a',
    'Account',
    'encrypted',
  );
  const snapshot = (at: number, counter: number | null = null, fields: any[] = []) =>
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          {
            id: 'h',
            name: 'Home',
            devices: [
              {
                id: 'd',
                name: 'Thermostat',
                category: 'wk',
                online: true,
                energyKind: counter === null ? 'unsupported' : 'cumulative',
                energyCode: counter === null ? null : 'total_energy',
                counterKwh: counter,
                temperature: 21,
                powerW: null,
                statusFields: fields,
              },
            ],
          },
        ],
      },
      at,
    );
  snapshot(start);
  const id = devicesFor(db)[0].id;
  const sample = (at: number, value: any = 'heating', online = true) =>
    recordHeatingState(
      db,
      id,
      value === undefined ? [] : [{ code: 'work_state', value }],
      online,
      at,
    );
  const stats = (at: number, comparable = false) =>
    usage(db, devicesFor(db), start, at, at, { comparable });
  return { db, id, start, sample, stats, snapshot };
}

test('2 kW over 30 observed ON minutes gives 1 kWh, OFF time is observed zero, no tail is invented', () => {
  const f = estimationFixture();
  configureEstimation(f.db, f.id, settings, f.start);
  for (let i = 1; i <= 31; i++) f.sample(f.start + i * minute, i === 31 ? 'idle' : 'heating');
  assert.equal(f.stats(f.start + 31 * minute).kwh, 1);
  assert.equal(f.stats(f.start + 31 * minute).heatingHours, 0.5);
  assert.equal(f.stats(f.start + 31 * minute).estimatedKwh, 1);
  assert.equal(f.stats(f.start + 31 * minute).measuredKwh, null);
  f.sample(f.start + 32 * minute, 'standby');
  assert.equal(f.stats(f.start + 120 * minute).kwh, 1);
  assert.equal(f.stats(f.start + 120 * minute).fresh, 0);
  assert.equal(f.stats(f.start + 32 * minute).coverage, 31 / 32);
  assert.equal(getDevice(f.db, f.id, f.start + 32 * minute)?.estimation.totalHeatingHours, 0.5);
  f.db.close();
});

test('unknown, missing, offline, no power and long gaps are missing, never OFF', () => {
  const f = estimationFixture();
  f.sample(f.start + minute);
  f.sample(f.start + 2 * minute);
  assert.equal(f.stats(f.start + 2 * minute).kwh, null);
  assert.throws(() =>
    configureEstimation(f.db, f.id, { ...settings, ratedPowerKw: null }, f.start + 2 * minute),
  );
  configureEstimation(f.db, f.id, settings, f.start + 2 * minute);
  f.sample(f.start + 3 * minute);
  f.sample(f.start + 4 * minute, 'unrecognized');
  f.sample(f.start + 5 * minute);
  f.sample(f.start + 6 * minute, 'heating', false);
  f.sample(f.start + 7 * minute);
  recordHeatingState(f.db, f.id, [], true, f.start + 8 * minute);
  f.sample(f.start + 9 * minute);
  f.sample(f.start + 13 * minute);
  assert.equal(f.stats(f.start + 13 * minute).kwh, null);
  f.sample(f.start + 14 * minute, 'idle');
  f.sample(f.start + 15 * minute, 'heating');
  assert.equal(f.stats(f.start + 15 * minute).kwh, 0.033333);
  assert.equal(f.stats(f.start + 15 * minute).heatingHours, 0.016667);
  f.db.close();
});

test('typed mappings are exact, disjoint; duplicate/out-of-order observations cannot add usage', () => {
  const f = estimationFixture();
  assert.throws(() =>
    configureEstimation(f.db, f.id, { ...settings, offValues: ['heating'] }, f.start),
  );
  assert.throws(() => configureEstimation(f.db, f.id, { ...settings, onValues: [] }, f.start));
  configureEstimation(f.db, f.id, { ...settings, onValues: [true], offValues: [false] }, f.start);
  f.sample(f.start + minute, 'true');
  f.sample(f.start + 2 * minute, true);
  f.sample(f.start + 3 * minute, false);
  f.sample(f.start + 3 * minute, true);
  f.sample(f.start + 2 * minute, true);
  f.sample(f.start + 4 * minute, false);
  assert.equal(f.stats(f.start + 4 * minute).kwh, 0.033333);
  assert.equal(getDevice(f.db, f.id, f.start + 4 * minute)?.estimation.state, 'off');
  f.db.close();
});

test('changing power preserves old kWh, breaks continuity and comparable history; meters take precedence', () => {
  const f = estimationFixture();
  configureEstimation(f.db, f.id, settings, f.start);
  f.sample(f.start + minute);
  f.sample(f.start + 2 * minute);
  configureEstimation(f.db, f.id, { ...settings, ratedPowerKw: 4 }, f.start + 2.5 * minute);
  f.sample(f.start + 3 * minute);
  f.sample(f.start + 4 * minute);
  assert.equal(f.stats(f.start + 4 * minute).kwh, 0.1);
  assert.equal(f.stats(f.start + 4 * minute, true).kwh, 0.066667);
  f.snapshot(f.start + 5 * minute, 100, [{ code: 'work_state', value: 'heating' }]);
  f.snapshot(f.start + 6 * minute, 101, [{ code: 'work_state', value: 'heating' }]);
  assert.equal(f.stats(f.start + 6 * minute).kwh, 1.1);
  assert.equal(f.stats(f.start + 6 * minute).measuredKwh, 1);
  assert.equal(f.stats(f.start + 6 * minute, true).kwh, 1);
  f.snapshot(f.start + 7 * minute, null, [{ code: 'work_state', value: 'heating' }]);
  f.sample(f.start + 8 * minute);
  assert.equal(f.stats(f.start + 8 * minute).kwh, 1.166667);
  f.db.close();
});

test('missing batched devices break continuity without changing their names or including unrelated accounts', () => {
  const f = estimationFixture();
  configureEstimation(f.db, f.id, settings, f.start);
  f.sample(f.start + minute);
  ingestHeatingSnapshot(f.db, 'a', [], ['d'], f.start + 2 * minute);
  ingestHeatingSnapshot(
    f.db,
    'a',
    [{ id: 'd', online: true, statusFields: [{ code: 'work_state', value: 'heating' }] }],
    ['d'],
    f.start + 3 * minute,
  );
  assert.equal(f.stats(f.start + 3 * minute).kwh, null);
  assert.equal(getDevice(f.db, f.id, f.start + 3 * minute)?.name, 'Thermostat');
  f.db.close();
});

test('persisted baseline bridges a short restart only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tem-estimate-'));
  try {
    const path = join(dir, 'db.sqlite');
    const f = estimationFixture(path);
    configureEstimation(f.db, f.id, settings, f.start);
    f.sample(f.start + minute);
    f.db.close();
    const db = openDatabase(path);
    recordHeatingState(
      db,
      f.id,
      [{ code: 'work_state', value: 'heating' }],
      true,
      f.start + 3 * minute,
    );
    recordHeatingState(
      db,
      f.id,
      [{ code: 'work_state', value: 'heating' }],
      true,
      f.start + 7 * minute,
    );
    assert.equal(
      usage(db, devicesFor(db), f.start, f.start + 7 * minute, f.start + 7 * minute).kwh,
      0.066667,
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('estimated ON time splits at Warsaw midnight and integrates real elapsed time on DST days', () => {
  for (const day of ['2026-03-29', '2026-10-25']) {
    const { start, end } = dayBounds(day);
    const f = estimationFixture(':memory:', start - minute * 2);
    configureEstimation(f.db, f.id, settings, start - minute * 2);
    for (let at = start - minute; at <= end + minute; at += minute) f.sample(at);
    const today = usage(f.db, devicesFor(f.db), start, end, end);
    assert.equal(today.kwh, (2 * (end - start)) / 3600000);
    assert.equal(today.heatingHours, (end - start) / 3600000);
    assert.equal(usage(f.db, devicesFor(f.db), start - minute, start, start).kwh, 0.033333);
    f.db.close();
  }
});

test('v1 database migrates additively, preserves credentials/readings/intervals and reopens safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tem-migration-'));
  try {
    const path = join(dir, 'db.sqlite');
    const sql = readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8');
    const old = new DatabaseSync(path);
    old.exec(sql);
    old.exec(
      "INSERT INTO accounts(id,label,secret) VALUES('a','A','encrypted'); INSERT INTO homes(id,account_id,remote_id,name) VALUES('h','a','h','H'); INSERT INTO devices(id,home_id,remote_id,name,category,included,online,energy_kind) VALUES('d','h','d','D','wk',1,1,'cumulative'); INSERT INTO intervals VALUES('d',100,200,3);",
    );
    old.close();
    for (let i = 0; i < 2; i++) {
      const db = openDatabase(path);
      assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, 3);
      assert.equal((db.prepare('SELECT secret FROM accounts').get() as any).secret, 'encrypted');
      const interval = db.prepare('SELECT * FROM intervals').get() as any;
      assert.equal(interval.source, 'measured');
      assert.equal(interval.kwh, 3);
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('apartment totals sum each device once and preserve both source components', () => {
  const f = estimationFixture();
  configureEstimation(f.db, f.id, settings, f.start);
  f.sample(f.start + minute);
  f.sample(f.start + 2 * minute);
  f.db.exec(
    "INSERT INTO devices(id,home_id,remote_id,name,category,included,online,energy_kind) SELECT 'meter',home_id,'meter','Meter','wk',1,1,'cumulative' FROM devices LIMIT 1",
  );
  f.db
    .prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)')
    .run('meter', f.start + minute, f.start + 2 * minute, 3);
  const stats = f.stats(f.start + 2 * minute);
  assert.equal(stats.kwh, 3.033333);
  assert.equal(stats.measuredKwh, 3);
  assert.equal(stats.estimatedKwh, 0.033333);
  assert.equal(stats.metered, 1);
  assert.equal(stats.estimated, 1);
  f.db.close();
});

test('fast states retain known enum choices but never retain a missing relay value', () => {
  const f = estimationFixture();
  configureEstimation(f.db, f.id, settings, f.start);
  recordHeatingState(
    f.db,
    f.id,
    [{ code: 'work_state', value: 'heating', values: ['heating', 'standby'] }],
    true,
    f.start + minute,
  );
  f.sample(f.start + 2 * minute);
  assert.deepEqual(getDevice(f.db, f.id, f.start + 2 * minute)?.estimation.statusFields[0].values, [
    'heating',
    'standby',
  ]);
  recordHeatingState(f.db, f.id, [{ code: 'switch', value: true }], true, f.start + 3 * minute);
  const detail = getDevice(f.db, f.id, f.start + 3 * minute)!;
  assert.equal(detail.estimation.state, 'unknown');
  assert.equal(detail.estimation.suggestion, null);
  assert.deepEqual(
    detail.estimation.statusFields.map((field) => field.code),
    ['switch'],
  );
  f.db.close();
});
