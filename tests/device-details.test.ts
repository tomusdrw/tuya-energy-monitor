import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeviceDetails } from '../src/DevicePage.js';
import { LanguageProvider } from '../src/i18n.js';
import { deviceFixture } from './helpers/devices.js';
import type { DeviceDetail } from '../shared/types.js';

function render(device: DeviceDetail, language: 'en' | 'pl') {
  return renderToStaticMarkup(
    createElement(LanguageProvider, {
      initialLanguage: language,
      children: createElement(DeviceDetails, {
        device,
        days: 14,
        setDays: () => {},
        onSaved: () => {},
        onRefresh: () => {},
      }),
    }),
  );
}

test('device details open as a localized read-only overview with diagnostics collapsed', () => {
  for (const language of ['en', 'pl'] as const) {
    const html = render(deviceFixture(), language);
    assert.doesNotMatch(html, /<(input|select|form)\b/);
    assert.match(html, new RegExp(`>${language === 'en' ? 'Edit' : 'Edytuj'}<`));
    assert.ok(html.includes(language === 'en' ? '21.5' : '21,5'));
    assert.ok(html.includes(language === 'en' ? '0.0' : '0,0'));
    assert.ok(html.includes(language === 'en' ? 'No energy data' : 'Brak energii'));
    const diagnostics = html.match(/<details class="device-diagnostics"[\s\S]*?<\/details>/)?.[0];
    assert.ok(diagnostics);
    assert.doesNotMatch(diagnostics.split('>')[0], /\bopen\b/);
    assert.ok(diagnostics.includes('work_state'));
  }
});

test('overview shows source-specific readings, unknown states and monitoring participation', () => {
  const base = deviceFixture();
  for (const language of ['en', 'pl'] as const) {
    const estimated = render(
      {
        ...base,
        energySource: 'estimated',
        heatingState: 'on',
        estimation: { ...base.estimation, enabled: true, state: 'on', ratedPowerKw: 1.25 },
      },
      language,
    );
    assert.ok(estimated.includes(language === 'en' ? 'Heating active' : 'Grzanie aktywne'));
    assert.ok(
      estimated.includes(language === 'en' ? 'Heating time today' : 'Czas grzania dzisiaj'),
    );
    const unknown = render(
      { ...base, energySource: 'estimated', heatingState: 'unknown', fresh: false },
      language,
    );
    assert.ok(
      unknown.includes(language === 'en' ? 'Heating state unknown' : 'Stan grzania nieznany'),
    );
    assert.ok(
      unknown.includes(
        language === 'en' ? 'Offline or stale readings' : 'Offline lub nieaktualne odczyty',
      ),
    );
    const power = render({ ...base, energySource: 'power', powerW: 0 }, language);
    assert.ok(power.includes(language === 'en' ? 'Current power' : 'Bieżąca moc'));
    const meter = render(
      {
        ...base,
        energySource: 'measured',
        energyKind: 'cumulative',
        counterKwh: 12.5,
        measurementProvider: 'tuya_ai',
      },
      language,
    );
    assert.ok(meter.includes('Tuya.ai'));
    assert.ok(meter.includes(language === 'en' ? '12.500' : '12,500'));
    const ignored = render({ ...base, ignored: true, included: false }, language);
    assert.ok(ignored.includes(language === 'en' ? 'Ignored' : 'Ignorowane'));
    const excluded = render({ ...base, included: false }, language);
    assert.ok(excluded.includes(language === 'en' ? 'Excluded' : 'Pomijane'));
  }
});
