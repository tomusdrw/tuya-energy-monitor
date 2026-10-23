import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnergyChart } from '../src/components.js';
import { LanguageProvider } from '../src/i18n.js';
import type { HistoryPoint } from '../shared/types.js';

test('daily readings are available without hover and distinguish zero from missing data in both languages', () => {
  const base: HistoryPoint = {
    day: '2026-10-22',
    kwh: 0,
    measuredKwh: 0,
    powerKwh: null,
    estimatedKwh: null,
    heatingHours: null,
    coverage: 1,
  };
  for (const language of ['en', 'pl'] as const) {
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(EnergyChart, {
          points: [
            base,
            {
              ...base,
              day: '2026-10-23',
              kwh: null,
              measuredKwh: null,
              coverage: 0,
            },
          ],
        }),
      }),
    );
    const disclosure = html.match(/<details[\s\S]*?<\/details>/)?.[0];
    assert.ok(disclosure, 'Touch and keyboard users need readings outside SVG hover titles');
    assert.match(disclosure, /<summary>/);
    assert.ok(disclosure.includes(language === 'pl' ? '0,00 kWh' : '0.00 kWh'));
    assert.ok(disclosure.includes(language === 'pl' ? 'Brak danych' : 'No data'));
    assert.ok(disclosure.includes('2026-10-22'));
    assert.ok(disclosure.includes('2026-10-23'));
  }
});
