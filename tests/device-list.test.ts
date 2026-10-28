import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeviceList } from '../src/DeviceList.js';
import { LanguageProvider } from '../src/i18n.js';
import { formatDate } from '../shared/i18n.js';
import { openDatabase } from '../server/db.js';
import { getHome, ingestSnapshot } from '../server/energy.js';

function devices() {
  const db = openDatabase(':memory:');
  try {
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          {
            id: 'h',
            name: 'Home',
            devices: ['Tracked heater', 'Pending meter', 'Ignored sensor'].map((name) => ({
              id: name,
              name,
              category: 'wk',
              online: true,
              energyKind: 'unsupported',
              energyCode: null,
              counterKwh: null,
              temperature: null,
              powerW: null,
            })),
          },
        ],
      },
      Date.now(),
    );
    db.exec(
      "UPDATE devices SET included=0 WHERE name='Pending meter'; UPDATE devices SET ignored=1,included=0 WHERE name='Ignored sensor'",
    );
    const home = db.prepare('SELECT id FROM homes').get() as { id: string };
    return getHome(db, home.id, Date.now())!.devices;
  } finally {
    db.close();
  }
}

test('ordinary excluded devices stay visible while ignored devices are grouped in a collapsed section', () => {
  for (const language of ['en', 'pl'] as const) {
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(DeviceList, { devices: devices(), onSaved: () => {} }),
      }),
    );
    const section = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
    assert.ok(section, 'Ignored devices must have their own disclosure');
    assert.doesNotMatch(section.split('>')[0], /\bopen\b/, 'Disclosure starts collapsed');
    assert.ok(section.includes('Ignored sensor'));
    assert.ok(!section.includes('Pending meter'));
    assert.ok(!section.includes('Tracked heater'));
    assert.ok(!section.includes('role="switch"'), 'Restore is separate from inclusion');
    assert.ok(section.includes(language === 'en' ? 'Restore' : 'Przywróć'));
    assert.match(
      section,
      language === 'en' ? /Ignored devices \(1\)/ : /Ignorowane urządzenia \(1\)/,
    );
    const main = html.replace(section, '');
    assert.ok(main.includes('Pending meter'), 'Excluded is distinct from ignored');
    assert.ok(main.includes('Tracked heater'));
    assert.ok(!main.includes('Ignored sensor'));
    assert.doesNotMatch(main, /role="switch"/);
    assert.doesNotMatch(main, /class="monitoring-heading"/);
    assert.ok(
      main.includes(language === 'en' ? 'Included in heating total' : 'Wliczane do ogrzewania'),
    );
  }
});

test('ignored-only and empty homes offer distinct states without losing access to ignored devices', () => {
  const ignoredOnly = renderToStaticMarkup(
    createElement(DeviceList, {
      devices: devices().filter((d) => d.ignored),
      onSaved: () => {},
    }),
  );
  assert.ok(ignoredOnly.includes('All devices are ignored'));
  assert.ok(ignoredOnly.includes('Ignored sensor'));
  assert.ok(ignoredOnly.includes('Restore'));
  const empty = renderToStaticMarkup(createElement(DeviceList, { devices: [], onSaved: () => {} }));
  assert.ok(empty.includes('No devices'));
  assert.ok(!empty.includes('<details'));
});

test('device groups retain inactive styling, fresh-first ordering and native power labels', () => {
  const fixture = devices();
  const inactive = { ...fixture.find((d) => d.name === 'Tracked heater')!, fresh: false };
  const power = {
    ...fixture.find((d) => d.name === 'Pending meter')!,
    energySource: 'power' as const,
    fresh: true,
  };
  const ignored = fixture.find((d) => d.ignored)!;
  const ignoredInactive = {
    ...ignored,
    id: 'ignored-inactive',
    name: 'Ignored inactive',
    fresh: false,
  };
  const ignoredActive = { ...ignored, id: 'ignored-active', name: 'Ignored active', fresh: true };
  for (const language of ['en', 'pl'] as const) {
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(DeviceList, {
          devices: [inactive, power, ignoredInactive, ignoredActive],
          onSaved: () => {},
        }),
      }),
    );
    assert.ok(html.indexOf('Pending meter') < html.indexOf('Tracked heater'));
    assert.ok(html.indexOf('Ignored active') < html.indexOf('Ignored inactive'));
    assert.equal((html.match(/class="device-row inactive"/g) ?? []).length, 2);
    assert.ok(html.includes(language === 'en' ? 'From measured power' : 'Z pomiaru mocy'));
    assert.ok(
      html.includes(
        language === 'en'
          ? 'Inactive · offline or stale readings'
          : 'Nieaktywne · offline lub nieaktualne odczyty',
      ),
    );
  }
});

test('device lists keep meter source labels and use the corresponding reading timestamp', () => {
  const base = devices().find((d) => !d.ignored)!;
  const lastSeen = Date.parse('2026-10-23T11:55:00Z');
  const measurementAt = Date.parse('2026-10-23T10:05:00Z');
  for (const language of ['en', 'pl'] as const) {
    for (const measurementProvider of ['qr', 'tuya_ai'] as const) {
      for (const ignored of [false, true]) {
        const html = renderToStaticMarkup(
          createElement(LanguageProvider, {
            initialLanguage: language,
            children: createElement(DeviceList, {
              devices: [
                {
                  ...base,
                  ignored,
                  included: !ignored,
                  energyKind: 'cumulative',
                  energySource: 'measured',
                  measurementProvider,
                  measurementAt,
                  lastSeen,
                },
              ],
              onSaved: () => {},
            }),
          }),
        );
        const ai = measurementProvider === 'tuya_ai';
        const label = ai
          ? language === 'en'
            ? 'Tuya.ai meter'
            : 'Licznik Tuya.ai'
          : language === 'en'
            ? 'kWh meter · QR'
            : 'Licznik kWh · QR';
        assert.ok(html.includes(label));
        assert.ok(html.includes(formatDate(language, ai ? measurementAt : lastSeen)));
        assert.ok(!html.includes(formatDate(language, ai ? lastSeen : measurementAt)));
      }
    }
  }
});
