import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { devicesFor, getDevice, ingestSnapshot, usage, dayBounds } from '../server/energy.js';
import * as incremental from '../server/incremental.js';
import { configureEstimation } from '../server/estimation.js';

const start = Date.parse('2026-10-16T10:00Z');
function fixture(path = ':memory:') {
  const db = openDatabase(path);
  db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','A','unused')");
  const snapshot = (at: number, kind = 'incremental') =>
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
                id: 'd',
                name: 'D',
                category: 'cz',
                online: true,
                energyKind: kind,
                energyCode: 'add_ele',
                counterKwh: null,
                temperature: null,
                powerW: null,
                statusFields: [{ code: 'work_state', value: 'heat' }],
              },
            ],
          },
        ],
      },
      at,
    );
  snapshot(start);
  const id = devicesFor(db)[0].id;
  const report = (at: number, kwh = 0.12, account = 'a') =>
    incremental.ingestEnergyReport(
      db,
      account,
      { deviceId: 'd', code: 'add_ele', at, kwh },
      Math.max(at, start + 60000),
    );
  const stats = () => usage(db, devicesFor(db), start, start + 3600000, start + 3600000);
  return { db, id, snapshot, report, stats };
}

test('incremental polls never add consumption; distinct equal reports count and replays do not', () => {
  const f = fixture();
  try {
    f.snapshot(start + 300000);
    assert.equal(f.stats().kwh, null);
    f.report(start + 1000);
    f.report(start + 2000);
    f.report(start + 1000);
    f.report(start + 1000, 99); // Conflicting replay must not rewrite history.
    assert.equal(f.stats().measuredKwh, 0.24);
    assert.equal(f.stats().estimatedKwh, null);
    assert.equal(f.stats().metered, 1);
    assert.equal(f.stats().coverage, 0, 'Point reports cannot establish time coverage');
    assert.equal(f.stats().complete, false);
    assert.equal(getDevice(f.db, f.id, start + 60000)?.counterKwh, null);
  } finally {
    f.db.close();
  }
});

test('late reports use device time, including midnight, and zero needs an actual report', () => {
  const f = fixture();
  try {
    f.report(start + 1000, 0);
    assert.equal(f.stats().kwh, 0);
    const midnight = dayBounds('2026-10-17').start;
    for (const at of [midnight + 1000, midnight - 1000])
      incremental.ingestEnergyReport(
        f.db,
        'a',
        { deviceId: 'd', code: 'add_ele', at, kwh: 1 },
        midnight + 10000,
      );
    assert.equal(usage(f.db, devicesFor(f.db), start, midnight, midnight + 10000).kwh, 1);
    assert.equal(
      usage(f.db, devicesFor(f.db), midnight, midnight + 10000, midnight + 10000).kwh,
      1,
    );
  } finally {
    f.db.close();
  }
});

test('Tuya report IDs distinguish distinct reports with the same timestamp and deduplicate replays', () => {
  const f = fixture();
  try {
    for (const reportId of ['event-a', 'event-b', 'event-a'])
      incremental.ingestEnergyReport(
        f.db,
        'a',
        { deviceId: 'd', code: 'add_ele', at: start + 1000, kwh: 0.12, reportId },
        start + 60000,
      );
    assert.equal(f.stats().kwh, 0.24);
  } finally {
    f.db.close();
  }
});

test('invalid, foreign, wrong-field, pre-monitoring and future events cannot add consumption', () => {
  const f = fixture();
  try {
    const valid = { deviceId: 'd', code: 'add_ele', at: start + 1000, kwh: 1 };
    for (const change of [
      { deviceId: 'other' },
      { code: 'reverse_energy_total' },
      { at: start - 1 },
      { at: start + 120000 },
      { kwh: -1 },
      { kwh: Infinity },
      { at: 1.5 },
    ])
      incremental.ingestEnergyReport(f.db, 'a', { ...valid, ...change }, start + 60000);
    f.report(start + 1000, 1, 'other');
    assert.equal(f.stats().kwh, null);
  } finally {
    f.db.close();
  }
});

test('incremental measurement supersedes estimation and never overlaps its historical intervals', () => {
  const f = fixture();
  try {
    f.snapshot(start + 1000, 'unsupported');
    configureEstimation(
      f.db,
      f.id,
      {
        enabled: true,
        ratedPowerKw: 2,
        heatingCode: 'work_state',
        onValues: ['heat'],
        offValues: ['idle'],
      },
      start + 2000,
    );
    f.snapshot(start + 3000, 'unsupported');
    f.snapshot(start + 63000, 'unsupported');
    f.snapshot(start + 65000);
    f.report(start + 64000, 10); // Before switching sources.
    f.report(start + 66000, 0.1);
    f.snapshot(start + 125000);
    assert.equal(f.stats().measuredKwh, 0.1);
    assert.equal(f.stats().estimatedKwh, 0.033333);
    assert.equal(getDevice(f.db, f.id, start + 125000)?.energySource, 'measured');
  } finally {
    f.db.close();
  }
});

test('stream freshness is separate from cloud polling and report freshness', () => {
  const f = fixture();
  try {
    incremental.setEnergyStreamState(f.db, 'a', true, start);
    assert.equal(getDevice(f.db, f.id, start + 1000)?.reportingConnected, true);
    assert.equal(getDevice(f.db, f.id, start + 120000)?.reportingConnected, false);
    incremental.setEnergyStreamState(f.db, 'a', false, start + 1000);
    assert.equal(getDevice(f.db, f.id, start + 1000)?.reportingConnected, false);
  } finally {
    f.db.close();
  }
});

test('v2 migration preserves data and report deduplication survives database reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tuya-reports-'));
  const path = join(dir, 'data.sqlite');
  let db: ReturnType<typeof openDatabase> | undefined;
  try {
    const f = fixture(path);
    // Reconstruct v2, including removal of the later optional Tuya.ai migration.
    f.db.exec('DROP TABLE ai_models');
    for (const column of [
      'ai_secret',
      'ai_revision',
      'ai_region',
      'ai_last_success',
      'ai_last_attempt',
      'ai_error',
    ])
      f.db.exec(`ALTER TABLE accounts DROP COLUMN ${column}`);
    for (const column of [
      'qr_energy_kind',
      'qr_energy_code',
      'measurement_provider',
      'measurement_at',
      'measurement_online',
      'measurement_error',
      'ai_attempt_at',
    ])
      f.db.exec(`ALTER TABLE devices DROP COLUMN ${column}`);
    for (const column of ['provider', 'series'])
      f.db.exec(`ALTER TABLE readings DROP COLUMN ${column}`);
    f.db.exec(`DROP TABLE power_observations;
      ALTER TABLE devices DROP COLUMN power_field;
      ALTER TABLE devices DROP COLUMN power_updated_at;
      DROP TABLE energy_reports;
      ALTER TABLE devices DROP COLUMN incremental_since;
      ALTER TABLE devices DROP COLUMN energy_stream_at;
      PRAGMA user_version=2`);
    f.db.close();
    db = openDatabase(path);
    assert.equal((db.prepare('SELECT secret FROM accounts').get() as any).secret, 'unused');
    // Existing incremental devices start at their first inventory after upgrading.
    const d = devicesFor(db)[0];
    assert.equal(d.incremental_since, null);
    db.prepare('UPDATE devices SET incremental_since=?').run(start);
    const report = { deviceId: 'd', code: 'add_ele', at: start + 1000, kwh: 0.12, reportId: 'one' };
    incremental.ingestEnergyReport(db, 'a', report, start + 2000);
    db.close();
    db = openDatabase(path);
    incremental.ingestEnergyReport(db, 'a', report, start + 3000);
    assert.equal(usage(db, devicesFor(db), start, start + 3000, start + 3000).kwh, 0.12);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
