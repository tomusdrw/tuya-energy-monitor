import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n.js';
import { HomeCard } from '../src/components.js';
import { DeviceList } from '../src/DeviceList.js';
import { openDatabase } from '../server/db.js';
import { getHome, ingestSnapshot } from '../server/energy.js';
import { scopedId } from '../server/crypto.js';

const at = Date.parse('2026-10-23T10:00:00Z');
function fixture() {
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
            name: 'My Home',
            devices: [
              {
                id: 'd',
                name: 'Sensor',
                category: 'wsdcg',
                online: true,
                energyCode: null,
                counterKwh: null,
                energyKind: 'unsupported',
                powerW: null,
                temperature: 21.5,
                humidity: 0,
              },
            ],
          },
        ],
      },
      at,
    );
    return {
      filled: getHome(db, scopedId('a', 'h'), at, 7)!,
      empty: getHome(db, scopedId('a', 'h'), at + 86400000, 7)!,
    };
  } finally {
    db.close();
  }
}

test('home and device cards show localized climate readings including zero humidity independently of energy', () => {
  const { filled } = fixture();
  for (const language of ['en', 'pl'] as const) {
    const render = (children: ReturnType<typeof createElement>) =>
      renderToStaticMarkup(
        createElement(LanguageProvider, { initialLanguage: language, children }),
      );
    const card = render(createElement(HomeCard, { home: filled }));
    assert.ok(card.includes(language === 'en' ? '21.5' : '21,5'));
    assert.ok(card.includes('°C'));
    assert.ok(card.includes(language === 'en' ? 'Humidity' : 'Wilgotność'));
    assert.ok(card.includes(language === 'en' ? '0.0' : '0,0'));
    const devices = render(
      createElement(DeviceList, { devices: filled.devices, onSaved: () => {} }),
    );
    assert.ok(devices.includes(language === 'en' ? '21.5' : '21,5'));
    assert.ok(devices.includes(language === 'en' ? 'Climate read' : 'Odczyt warunków'));
  }
});

test('excluded temperatures stay visible with a localized participation label', () => {
  const { filled } = fixture();
  for (const language of ['en', 'pl'] as const) {
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(DeviceList, {
          devices: filled.devices.map((d) => ({ ...d, temperatureIncluded: false })),
          onSaved: () => {},
        }),
      }),
    );
    assert.ok(html.includes(language === 'en' ? 'Excluded from average' : 'Poza średnią'));
    assert.ok(html.includes(language === 'en' ? '21.5' : '21,5'));
  }
});

test('climate summaries and history expose ranges, contributing counts, gaps and localized daily readings', async () => {
  const { ClimateSummaryCards, ClimateHistory } = await import('../src/Climate.js');
  const { filled, empty } = fixture();
  for (const language of ['en', 'pl'] as const) {
    const render = (children: ReturnType<typeof createElement>) =>
      renderToStaticMarkup(
        createElement(LanguageProvider, { initialLanguage: language, children }),
      );
    const summary = render(createElement(ClimateSummaryCards, { climate: filled.climate }));
    assert.ok(summary.includes(language === 'en' ? 'Average temperature' : 'Średnia temperatura'));
    assert.ok(summary.includes(language === 'en' ? 'Sensors: 1' : 'Czujniki: 1'));
    const noData = render(createElement(ClimateSummaryCards, { climate: empty.climate }));
    assert.ok(
      noData.includes(language === 'en' ? 'No current readings' : 'Brak aktualnych odczytów'),
    );
    assert.ok(!noData.includes('21.5') && !noData.includes('21,5'));
    const history = render(createElement(ClimateHistory, { points: filled.climateHistory }));
    assert.equal((history.match(/<svg[^>]*role="group"/g) ?? []).length, 2);
    assert.ok(history.includes('<details'));
    assert.ok(
      history.includes(
        language === 'en' ? 'View daily climate readings' : 'Zobacz dzienne odczyty warunków',
      ),
    );
    assert.ok(history.includes(language === 'en' ? 'Samples: 1' : 'Pomiary: 1'));
    assert.ok(history.includes(language === 'en' ? 'No readings' : 'Brak odczytów'));
  }
});
