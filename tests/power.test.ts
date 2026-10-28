import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { devicesFor, getDevice, getOverview, ingestSnapshot, usage } from '../server/energy.js';
import { configureEstimation, ingestHeatingSnapshot } from '../server/estimation.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dashboard } from '../src/App.js';
import { DeviceDetails } from '../src/DevicePage.js';
import { LanguageProvider } from '../src/i18n.js';
import { evaluateNotifications } from '../server/notifications.js';

const minute = 60000;
const start = Date.parse('2026-10-23T10:00:00Z');
const powerField = { code: 'cur_power', scale: 1, unit: 'W' };
function fixture(path = ':memory:') {
  const db = openDatabase(path);
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run('a', 'A', 'unused');
  const full = (at: number, watts: number | null, extra = {}) =>
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          {
            id: 'h',
            name: '26/1',
            devices: [
              {
                id: 'd',
                name: 'F1',
                category: 'cz',
                online: true,
                energyKind: 'power',
                energyCode: null,
                counterKwh: null,
                temperature: null,
                powerW: watts,
                powerField,
                statusFields: watts === null ? [] : [{ code: 'cur_power', value: watts * 10 }],
                ...extra,
              },
            ],
          },
        ],
      },
      at,
    );
  const fast = (at: number, value: unknown, online = true) =>
    ingestHeatingSnapshot(
      db,
      'a',
      [
        {
          id: 'd',
          online,
          statusFields: value === null ? [] : [{ code: 'cur_power', value }],
        },
      ],
      ['d'],
      at,
    );
  const stats = (at: number, from = start) => usage(db, devicesFor(db), from, at, at);
  return { db, full, fast, stats, id: () => devicesFor(db)[0].id };
}

test('native power integrates varying measured watts automatically and separately from estimates', () => {
  const f = fixture();
  try {
    f.full(start, 1000);
    assert.equal(f.stats(start).kwh, null);
    assert.equal(getDevice(f.db, f.id(), start)?.energySource, 'power');
    f.fast(start + minute, 20000);
    // Mean 1.5 kW for one minute = 0.025 kWh.
    const stats = f.stats(start + minute);
    assert.equal(stats.kwh, 0.025);
    assert.equal(stats.powerKwh, 0.025);
    assert.equal(stats.measuredKwh, null);
    assert.equal(stats.estimatedKwh, null);
    assert.equal(stats.heatingHours, null);
    assert.equal(stats.coverage, 1);
    assert.equal(stats.complete, true);
    assert.equal(getDevice(f.db, f.id(), start + minute)?.powerW, 2000);
    f.fast(start + 2 * minute, 0);
    f.fast(start + 3 * minute, 0);
    assert.equal(f.stats(start + 3 * minute).kwh, 0.041667);
    assert.equal(f.stats(start + 3 * minute, start + 2 * minute).kwh, 0);
  } finally {
    f.db.close();
  }
});

test('missing, invalid, offline and omitted readings break power continuity immediately', () => {
  for (const bad of [null, -1, true, '10000', 'offline', 'omitted']) {
    const f = fixture();
    try {
      f.full(start, 1000);
      if (bad === 'omitted') ingestHeatingSnapshot(f.db, 'a', [], ['d'], start + minute);
      else f.fast(start + minute, bad === 'offline' ? 10000 : bad, bad !== 'offline');
      assert.equal(f.stats(start + minute).fresh, 0);
      assert.equal(getDevice(f.db, f.id(), start + minute)?.powerW, null);
      f.fast(start + 2 * minute, 10000);
      assert.equal(f.stats(start + 2 * minute).kwh, null, String(bad));
      f.fast(start + 3 * minute, 10000);
      assert.equal(f.stats(start + 3 * minute).kwh, 0.016667);
    } finally {
      f.db.close();
    }
  }
});

test('duplicates, reordered observations and long gaps do not invent energy or refresh stale power', () => {
  const f = fixture();
  try {
    f.full(start, 1000);
    f.fast(start + minute, 10000);
    f.fast(start + minute, 50000);
    f.full(start + minute, 5000);
    assert.equal(getDevice(f.db, f.id(), start + minute)?.powerW, 1000);
    f.full(start, 5000);
    f.fast(start + 4 * minute + 1, 10000);
    assert.equal(f.stats(start + 4 * minute + 1).kwh, 0.016667);
    assert.equal(f.stats(start + 8 * minute).fresh, 0);
    assert.equal(getDevice(f.db, f.id(), start + 8 * minute)?.fresh, false);
    assert.equal(getDevice(f.db, f.id(), start + 8 * minute)?.powerW, null);
  } finally {
    f.db.close();
  }
});

test('power comparison history ignores unrelated runtime configuration changes and preserves exclusions', () => {
  const f = fixture();
  try {
    f.full(start, 1000);
    f.fast(start + minute, 10000);
    f.db.prepare('UPDATE devices SET estimate_revision=20,included=0').run();
    f.full(start + 2 * minute, 1000);
    assert.equal(f.stats(start + 2 * minute).kwh, null);
    assert.equal(getDevice(f.db, f.id(), start + 2 * minute)?.stats.powerKwh, 0.033333);
    const stats = usage(
      f.db,
      devicesFor(f.db).map((d) => ({ ...d, included: 1 })),
      start,
      start + 2 * minute,
      start + 2 * minute,
      { comparable: true },
    );
    assert.equal(stats.powerKwh, 0.033333);
    assert.equal(stats.coverage, 1);
  } finally {
    f.db.close();
  }
});

test('metadata changes and disappearance establish fresh power baselines', () => {
  const f = fixture();
  try {
    f.full(start, 1000);
    f.full(start + minute, 2000, {
      powerField: { ...powerField, scale: 0 },
      statusFields: [{ code: 'cur_power', value: 2000 }],
    });
    assert.equal(f.stats(start + minute).kwh, null);
    f.fast(start + 2 * minute, 2000);
    assert.equal(f.stats(start + 2 * minute).kwh, 0.033333);
    ingestSnapshot(f.db, 'a', { homes: [] }, start + 3 * minute);
    f.full(start + 4 * minute, 1000);
    assert.equal(f.stats(start + 4 * minute).kwh, 0.033333);
  } finally {
    f.db.close();
  }
});

test('power takes precedence over configured runtime; meters take precedence over power without double counting', () => {
  const f = fixture();
  try {
    f.full(start, 1000);
    configureEstimation(
      f.db,
      f.id(),
      {
        enabled: true,
        ratedPowerKw: 10,
        heatingCode: 'cur_power',
        onValues: [10000],
        offValues: [0],
      },
      start,
    );
    f.fast(start + minute, 10000);
    assert.equal(f.stats(start + minute).estimatedKwh, null);
    f.full(start + 2 * minute, 1000, {
      energyKind: 'cumulative',
      energyCode: 'total_energy',
      counterKwh: 10,
    });
    f.full(start + 3 * minute, 1000, {
      energyKind: 'cumulative',
      energyCode: 'total_energy',
      counterKwh: 10.1,
    });
    assert.equal(f.stats(start + 3 * minute).powerKwh, 0.016667);
    assert.equal(f.stats(start + 3 * minute).measuredKwh, 0.1);
    assert.equal(f.stats(start + 3 * minute).kwh, 0.116667);
    f.full(start + 4 * minute, 1000);
    assert.equal(f.stats(start + 4 * minute).powerKwh, 0.016667);
    f.fast(start + 5 * minute, 10000);
    assert.equal(f.stats(start + 5 * minute).powerKwh, 0.033333);
  } finally {
    f.db.close();
  }
});

test('power history splits across Warsaw midnight and survives a short restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'power-test-'));
  const path = join(dir, 'energy.db');
  const f = fixture(path);
  const midnight = Date.parse('2026-10-23T22:00:00Z');
  f.full(midnight - minute, 1000);
  f.db.close();
  const db = openDatabase(path);
  try {
    ingestHeatingSnapshot(
      db,
      'a',
      [{ id: 'd', online: true, statusFields: [{ code: 'cur_power', value: 10000 }] }],
      ['d'],
      midnight + minute,
    );
    const overview = getOverview(db, midnight + minute, 2);
    assert.equal(overview.history[0].powerKwh, 0.016667);
    assert.equal(overview.history[1].powerKwh, 0.016667);
    assert.equal(overview.stats.heatingHours, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('power totals, chart and automatic monitoring panel identify the source in both languages', () => {
  const f = fixture();
  try {
    f.full(start, 1200);
    f.fast(start + minute, 12000);
    for (const language of ['en', 'pl'] as const) {
      const dashboard = renderToStaticMarkup(
        createElement(LanguageProvider, {
          initialLanguage: language,
          children: createElement(Dashboard, {
            data: getOverview(f.db, start + minute, 1),
            days: 7,
            setDays: () => {},
          }),
        }),
      );
      assert.ok(dashboard.includes(language === 'en' ? '≈ 0.02' : '≈ 0,02'));
      assert.ok(dashboard.includes(language === 'en' ? 'From power:' : 'Z pomiaru mocy:'));
      assert.ok(dashboard.includes('bar-power'), 'Power consumption is visible on the chart');
      // Interactive hover content is covered in chart-hover.test.ts; the disclosure
      // must also expose this real, power-derived reading without interaction.
      const readings = dashboard.match(/<details[\s\S]*?<\/details>/)?.[0];
      assert.ok(
        readings?.includes(language === 'en' ? 'From power: 0.02 kWh' : 'Z pomiaru mocy: 0,02 kWh'),
        'Daily chart readings expose the power-derived portion',
      );
      const panel = renderToStaticMarkup(
        createElement(LanguageProvider, {
          initialLanguage: language,
          children: createElement(DeviceDetails, {
            device: getDevice(f.db, f.id(), start + minute)!,
            onSaved: () => {},
            days: 14,
            setDays: () => {},
            onRefresh: () => {},
          }),
        }),
      );
      assert.ok(panel.includes(language === 'en' ? 'From measured power' : 'Z pomiaru mocy'));
      assert.ok(
        !panel.includes('<input'),
        'No rated power or heating signal configuration is required',
      );
      assert.ok(panel.includes('cur_power'), 'Raw measurements remain available for diagnosis');
    }
  } finally {
    f.db.close();
  }
});

test('threshold notifications include power-derived consumption and distinguish it from runtime estimates', () => {
  const f = fixture();
  try {
    f.full(start, 1200);
    f.fast(start + minute, 12000);
    f.db.exec('UPDATE homes SET daily_limit=0.01,anomaly_enabled=0');
    evaluateNotifications(f.db, start + minute);
    const alert = f.db
      .prepare("SELECT body FROM notifications WHERE kind='threshold'")
      .get() as any;
    assert.match(alert.body, /≈ 0\.02 kWh/);
    assert.match(alert.body, /from power: 0\.02 kWh/i);
    assert.match(alert.body, /estimated: no data/i);
  } finally {
    f.db.close();
  }
});
