import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { ingestSnapshot, getOverview, dayBounds } from '../server/energy.js';
import { encrypt, decrypt } from '../server/crypto.js';

function fixture() {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
    'a',
    'Account',
    'encrypted',
  );
  const start = Date.parse('2026-10-16T10:00:00Z');
  const sample = (at: number, value: number | null, online = true) =>
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          {
            id: 'h',
            name: 'Apartment',
            devices: [
              {
                id: 'd',
                name: 'Heater',
                category: 'wk',
                online,
                energyCode: value === null ? null : 'total_forward_energy',
                counterKwh: value,
                energyKind: value === null ? 'unsupported' : 'cumulative',
                temperature: null,
                powerW: null,
              },
            ],
          },
        ],
      },
      at,
    );
  return { db, start, sample, today: (at: number) => getOverview(db, at, 7).homes[0] };
}

test('first cumulative sample is a baseline, not consumption; next delta is observed usage', () => {
  const f = fixture();
  f.sample(f.start, 168.52);
  assert.equal(f.today(f.start).stats.kwh, null);
  f.sample(f.start + 300000, 169.02);
  assert.equal(f.today(f.start + 300000).stats.kwh, 0.5);
  assert.equal(f.today(f.start + 300000).stats.metered, 1);
  assert.ok(f.today(f.start + 300000).stats.coverage < 0.01);
  f.db.close();
});

test('duplicates, resets, offline values and long gaps cannot manufacture consumption', () => {
  const f = fixture();
  f.sample(f.start, 100);
  f.sample(f.start, 500);
  f.sample(f.start + 300000, 101);
  assert.equal(f.today(f.start + 300000).stats.kwh, 1);
  f.sample(f.start + 600000, 0.1);
  f.sample(f.start + 900000, 5, false);
  f.sample(f.start + 1200000, 8);
  f.sample(f.start + 2400000, 20);
  assert.equal(f.today(f.start + 2400000).stats.kwh, 1);
  f.sample(f.start + 2700000, 20.25);
  assert.equal(f.today(f.start + 2700000).stats.kwh, 1.25);
  f.db.close();
});

test('unsupported thermostats stay missing, and zero requires two valid readings', () => {
  const f = fixture();
  f.sample(f.start, null);
  assert.equal(f.today(f.start).stats.kwh, null);
  assert.equal(f.today(f.start).stats.monitored, 1);
  assert.equal(f.today(f.start).stats.metered, 0);
  f.sample(f.start + 300000, 10);
  f.sample(f.start + 600000, 10);
  assert.equal(f.today(f.start + 600000).stats.kwh, 0);
  f.db.close();
});

test('interval straddling Warsaw midnight is proportionally attributed to each date', () => {
  const f = fixture();
  const t = Date.parse('2026-10-15T21:55:00Z');
  f.sample(t, 10);
  f.sample(t + 600000, 12);
  const overview = getOverview(f.db, t + 600000, 7);
  assert.equal(overview.homes[0].stats.kwh, 1);
  assert.equal(overview.history.at(-2)?.kwh, 1);
  assert.equal(overview.history.at(-1)?.kwh, 1);
  f.db.close();
});

test('Warsaw calendar respects 23 and 25 hour DST days', () => {
  const spring = dayBounds('2026-03-29');
  const autumn = dayBounds('2026-10-25');
  assert.equal(spring.end - spring.start, 23 * 3600000);
  assert.equal(autumn.end - autumn.start, 25 * 3600000);
});

test('failed/missing snapshot devices retain an explicit gap, including previous metadata', () => {
  const f = fixture();
  f.sample(f.start, 10);
  f.sample(f.start + 300000, 11);
  ingestSnapshot(
    f.db,
    'a',
    { homes: [{ id: 'h', name: 'Apartment', devices: [] }] },
    f.start + 600000,
  );
  const overview = getOverview(f.db, f.start + 600000, 7);
  assert.equal(overview.homes[0].stats.monitored, 1);
  assert.equal(overview.homes[0].stats.fresh, 0);
  f.db.close();
});

test('encrypted account credentials are authenticated and unusable with another key', () => {
  const key = Buffer.alloc(32, 7);
  const secret = encrypt({ access_token: 'private-value' }, key);
  assert.ok(!secret.includes('private-value'));
  assert.deepEqual(decrypt(secret, key), { access_token: 'private-value' });
  assert.throws(() => decrypt(secret, Buffer.alloc(32, 8)));
});
