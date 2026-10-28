import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeviceSelection, DeviceSelectionList } from '../src/DeviceSelection.js';
import { LanguageProvider } from '../src/i18n.js';
import { openDatabase } from '../server/db.js';
import { getHome, ingestSnapshot } from '../server/energy.js';
import { scopedId } from '../server/crypto.js';

function fixture() {
  const db = openDatabase(':memory:');
  try {
    const now = Date.now();
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','A','unused')");
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          {
            id: 'h',
            name: 'Home',
            devices: [
              { id: 'heater', name: 'Heater', category: 'wk', temperature: 0 },
              { id: 'outside', name: 'Outside', category: 'wsdcg', temperature: -5 },
              { id: 'meter', name: 'Meter only', category: 'cz', temperature: null },
            ].map((d) => ({
              ...d,
              online: true,
              energyKind: 'unsupported',
              energyCode: null,
              counterKwh: null,
              powerW: null,
            })),
          },
        ],
      },
      now,
    );
    const devices = getHome(db, scopedId('a', 'h'), now)!.devices;
    return devices.map((d) =>
      d.name === 'Outside'
        ? {
            ...d,
            temperatureIncluded: false,
            temperature: null,
            present: false,
            online: false,
            ignored: true,
          }
        : d,
    );
  } finally {
    db.close();
  }
}

test('temperature picker keeps known unavailable sensors, excludes meter-only devices and localizes selections', () => {
  for (const language of ['en', 'pl'] as const) {
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(DeviceSelectionList, {
          devices: fixture(),
          mode: 'temperature',
          onSaved: () => {},
        }),
      }),
    );
    assert.ok(html.includes('Heater'));
    assert.ok(html.includes('Outside'));
    assert.ok(!html.includes('Meter only'));
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
    assert.equal((html.match(/checked=""/g) ?? []).length, 1);
    assert.ok(html.includes(language === 'en' ? '0.0' : '0,0'));
    assert.ok(html.includes(language === 'en' ? 'No current reading' : 'Brak aktualnego odczytu'));
    assert.ok(html.includes(language === 'en' ? 'Excluded from average' : 'Poza średnią'));
    assert.match(html, /aria-label="[^"]*Outside/);
  }
});

test('heating picker retains all devices, missing energy and independent participation', () => {
  const html = renderToStaticMarkup(
    createElement(DeviceSelectionList, {
      devices: fixture(),
      mode: 'energy',
      onSaved: () => {},
    }),
  );
  assert.ok(html.includes('Meter only'));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 3);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
  assert.ok(html.includes('No energy data'));
  assert.ok(html.includes('Selecting this device also restores it to the device list.'));
});

test('summary controls share an accessible dialog entry point and empty picker states', () => {
  for (const mode of ['energy', 'temperature'] as const) {
    const html = renderToStaticMarkup(
      createElement(DeviceSelection, { homeId: 'h', mode, onSaved: () => {} }),
    );
    assert.match(html, /aria-haspopup="dialog"/);
    assert.ok(html.includes(mode === 'energy' ? 'Choose devices' : 'Choose sensors'));
    const empty = renderToStaticMarkup(
      createElement(DeviceSelectionList, { devices: [], mode, onSaved: () => {} }),
    );
    assert.ok(empty.includes(mode === 'energy' ? 'No devices' : 'No temperature sensors'));
  }
});
