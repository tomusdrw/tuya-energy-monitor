import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { getHome, getOverview, ingestSnapshot } from '../server/energy.js';
import { ingestHeatingSnapshot } from '../server/estimation.js';
import { scopedId } from '../server/crypto.js';

const at = Date.parse('2026-10-23T10:00:00Z');
const sensor = (
  id: string,
  temperature: number | null,
  humidity: number | null,
  online = true,
) => ({
  id,
  name: id,
  category: 'wsdcg',
  online,
  temperature,
  humidity,
  powerW: null,
  counterKwh: null,
  energyCode: null,
  energyKind: 'unsupported',
});
const snapshot = (devices: ReturnType<typeof sensor>[], id = 'h') => ({
  homes: [{ id, name: id, devices }],
});
function setup() {
  const db = openDatabase(':memory:');
  db.exec(
    "INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused'),('b','Other','unused')",
  );
  return db;
}
const home = (db: ReturnType<typeof setup>, now = at, account = 'a') =>
  getHome(db, scopedId(account, 'h'), now, 7)!;

test('home climate weights every available sensor equally, separately per metric and account', () => {
  const db = setup();
  try {
    ingestSnapshot(
      db,
      'a',
      snapshot([sensor('one', 20, 40), sensor('two', 24, null), sensor('three', null, 60)]),
      at,
    );
    db.exec('UPDATE devices SET included=0,ignored=1');
    ingestSnapshot(db, 'b', snapshot([sensor('one', 99, 99)]), at);
    const detail = home(db);
    assert.equal(detail.climate?.temperature.average, 22);
    assert.equal(detail.climate.temperature.minimum, 20);
    assert.equal(detail.climate.temperature.maximum, 24);
    assert.equal(detail.climate.temperature.count, 2);
    assert.equal(detail.climate.humidity.average, 50);
    assert.equal(detail.climate.humidity.count, 2);
    assert.deepEqual(
      getOverview(db, at).homes.find((h) => h.accountId === 'a')?.climate,
      detail.climate,
    );
    assert.equal(detail.devices[0].humidity, 40);
    assert.equal(detail.devices[0].climateObservedAt, at);
  } finally {
    db.close();
  }
});

test('offline, absent, future and stale readings are missing; zero and negative Celsius remain real', () => {
  const db = setup();
  try {
    ingestSnapshot(
      db,
      'a',
      snapshot([
        sensor('zero', 0, 0),
        sensor('negative', -10, null),
        sensor('offline', 90, 90, false),
      ]),
      at,
    );
    assert.equal(home(db).climate?.temperature.average, -5);
    assert.equal(home(db).climate.humidity.average, 0);
    assert.equal(home(db, at + 15 * 60000).climate.temperature.count, 2);
    assert.equal(home(db, at + 15 * 60000 + 1).climate.temperature.average, null);
    assert.equal(home(db, at - 1).climate.humidity.average, null);
    ingestSnapshot(db, 'a', snapshot([sensor('zero', null, null)]), at + 300000);
    assert.equal(home(db, at + 300000).climate.temperature.count, 0);
    assert.ok(
      home(db, at + 300000).devices.every((d) => d.temperature === null && d.humidity === null),
    );
  } finally {
    db.close();
  }
});

test('fast energy status cannot freshen climate and repeated full snapshots cannot replace observations', () => {
  const db = setup();
  try {
    ingestSnapshot(db, 'a', snapshot([sensor('one', 20, 40)]), at);
    ingestSnapshot(db, 'a', snapshot([sensor('one', 99, 99)]), at);
    ingestHeatingSnapshot(
      db,
      'a',
      [{ id: 'one', online: true, statusFields: [] }],
      ['one'],
      at + 16 * 60000,
    );
    assert.equal(home(db, at + 16 * 60000).climate?.temperature.average, null);
    const daily = home(db, at + 16 * 60000).climateHistory.at(-1)!;
    assert.equal(daily.temperature.average, 20);
    assert.equal(daily.temperature.samples, 1);
  } finally {
    db.close();
  }
});

test('history averages each sensor first, retains min/max and has real gaps and sample counts', () => {
  const db = setup();
  try {
    ingestSnapshot(db, 'a', snapshot([sensor('one', 10, null), sensor('two', 30, 0)]), at);
    ingestSnapshot(
      db,
      'a',
      snapshot([sensor('one', 20, null), sensor('two', null, null)]),
      at + 300000,
    );
    const points = home(db, at + 300000).climateHistory;
    assert.equal(points?.length, 7);
    assert.equal(points[0].temperature.average, null);
    assert.equal(points[0].temperature.samples, 0);
    const last = points.at(-1)!;
    assert.equal(last.temperature.average, 22.5); // mean(mean(10,20), mean(30))
    assert.equal(last.temperature.minimum, 10);
    assert.equal(last.temperature.maximum, 30);
    assert.equal(last.temperature.count, 2);
    assert.equal(last.temperature.samples, 3);
    assert.equal(last.humidity.average, 0);
    assert.equal(last.humidity.count, 1);
    ingestSnapshot(db, 'a', snapshot([]), at + 600000);
    assert.equal(home(db, at + 600000).climateHistory.at(-1)!.temperature.average, 22.5);
  } finally {
    db.close();
  }
});

test('history uses Warsaw days across DST and retains the home where samples were observed', () => {
  const db = setup();
  try {
    const times = [
      '2026-10-24T21:59:00Z',
      '2026-10-24T22:00:00Z',
      '2026-10-25T00:30:00Z',
      '2026-10-25T01:30:00Z',
      '2026-10-25T23:00:00Z',
    ].map(Date.parse);
    times.forEach((time, i) =>
      ingestSnapshot(db, 'a', snapshot([sensor('one', i * 10, null)]), time),
    );
    const points = home(db, times.at(-1)!).climateHistory;
    assert.equal(points?.find((p) => p.day === '2026-10-24')?.temperature.average, 0);
    assert.equal(points.find((p) => p.day === '2026-10-25')?.temperature.average, 20);
    assert.equal(points.find((p) => p.day === '2026-10-25')?.temperature.samples, 3);
    assert.equal(points.find((p) => p.day === '2026-10-26')?.temperature.average, 40);
    ingestSnapshot(db, 'a', snapshot([sensor('one', 90, null)], 'new'), times.at(-1)! + 300000);
    assert.equal(home(db, times.at(-1)! + 300000).climateHistory.at(-1)?.temperature.average, 40);
    assert.equal(
      getHome(db, scopedId('a', 'new'), times.at(-1)! + 300000, 7)?.climateHistory.at(-1)
        ?.temperature.average,
      90,
    );
  } finally {
    db.close();
  }
});

test('v7 migration keeps energy data without inventing climate timestamps; observations survive restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'climate-'));
  const path = join(dir, 'db.sqlite');
  let db = openDatabase(path);
  try {
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
    ingestSnapshot(db, 'a', snapshot([sensor('one', 20, 40)]), at);
    db.exec('DROP TABLE IF EXISTS climate_observations');
    const columns = db
      .prepare('PRAGMA table_info(devices)')
      .all()
      .map((c) => c.name);
    for (const column of ['humidity', 'climate_at'])
      if (columns.includes(column)) db.exec(`ALTER TABLE devices DROP COLUMN ${column}`);
    db.exec('PRAGMA user_version=7');
    db.close();
    db = openDatabase(path);
    assert.equal(home(db).climate?.temperature.average, null);
    assert.equal((db.prepare('SELECT temperature FROM devices').get() as any).temperature, 20);
    ingestSnapshot(db, 'a', snapshot([sensor('one', 22, 44)]), at + 300000);
    db.close();
    db = openDatabase(path);
    assert.equal(home(db, at + 300000).climateHistory.at(-1)?.humidity.average, 44);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
