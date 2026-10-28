import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n.js';
import { AccountsPage, NotificationsPage } from '../src/pages.js';
import { DeviceConfiguration } from '../src/DeviceConfiguration.js';
import { openDatabase } from '../server/db.js';
import { getDevice, ingestSnapshot } from '../server/energy.js';

test('account and notification pages render in the selected interface language', () => {
  for (const language of ['en', 'pl'] as const) {
    const account = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(AccountsPage),
      }),
    );
    const notifications = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(NotificationsPage),
      }),
    );
    assert.ok(account.includes(language === 'en' ? 'Connected accounts' : 'Połączone konta'));
    assert.ok(account.includes(language === 'en' ? 'Add account' : 'Dodaj konto'));
    assert.ok(notifications.includes(language === 'en' ? 'Notifications' : 'Powiadomienia'));
  }
});

test('estimation uses the selected language and number format while preserving raw Tuya values', () => {
  const db = openDatabase(':memory:');
  try {
    const now = Date.parse('2026-10-16T10:00:00Z');
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Łódź','unused')");
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          {
            id: 'h',
            name: 'Dom',
            devices: [
              {
                id: 'd',
                name: 'Grzejnik',
                category: 'wk',
                online: true,
                energyKind: 'unsupported',
                energyCode: null,
                counterKwh: null,
                temperature: null,
                powerW: null,
                statusFields: [
                  { code: 'work_state', value: 'heating', values: ['heating', 'idle'] },
                ],
              },
            ],
          },
        ],
      },
      now,
    );
    const { id } = db.prepare('SELECT id FROM devices').get() as { id: string };
    const device = getDevice(db, id, now)!;
    device.estimation.totalHeatingHours = 1.25;
    for (const language of ['en', 'pl'] as const) {
      const html = renderToStaticMarkup(
        createElement(LanguageProvider, {
          initialLanguage: language,
          children: createElement(DeviceConfiguration, {
            device,
            days: 14,
            onSaved: () => {},
            onCancel: () => {},
            onRefresh: () => {},
          }),
        }),
      );
      assert.ok(
        html.includes(
          language === 'en' ? 'Heating runtime estimation' : 'Estymacja z czasu grzania',
        ),
      );
      assert.ok(html.includes(language === 'en' ? 'Heating power (kW)' : 'Moc ogrzewania (kW)'));
      assert.ok(html.includes(language === 'en' ? '1.25' : '1,25'));
      assert.ok(html.includes('work_state'));
      assert.ok(html.includes('&quot;heating&quot;'));
      assert.doesNotMatch(
        html.match(/<input(?=[^>]*name="estimationEnabled")[^>]*>/)![0],
        /checked/,
      );
      assert.match(html, /<select[^>]*name="heatingCode"/);
      assert.match(html, /<select[^>]*name="state-0"/);
      assert.match(html, /<select[^>]*name="state-1"/);
      assert.ok(html.includes(language === 'en' ? 'Detect again' : 'Wykryj ponownie'));
    }
    device.estimation.heatingCode = 'custom_relay';
    device.estimation.onValues = [1];
    device.estimation.offValues = ['1', false];
    const saved = renderToStaticMarkup(
      createElement(DeviceConfiguration, {
        device,
        days: 14,
        onSaved: () => {},
        onCancel: () => {},
        onRefresh: () => {},
      }),
    );
    assert.match(saved, /<option value="custom_relay" selected=""/);
    assert.ok(saved.includes('The selected field is absent from the latest reading.'));
    assert.match(saved, /<select[^>]*name="state-2"/);
    device.estimation.heatingCode = null;
    device.estimation.onValues = [];
    device.estimation.offValues = [];
    device.estimation.suggestion = null;
    device.estimation.statusFields = [
      { code: 'temp_current', value: 210, temperature: { scale: 1, unit: 'C' } },
      { code: 'set_temp', value: 22, temperature: { scale: 0, unit: 'C' } },
      { code: 'switch', value: true },
    ];
    device.estimation.temperatureSuggestion = {
      current: { code: 'temp_current', scale: 1, unit: 'C' },
      target: { code: 'set_temp', scale: 0, unit: 'C' },
      switchCode: 'switch',
    };
    for (const language of ['en', 'pl'] as const) {
      const temperatureHtml = renderToStaticMarkup(
        createElement(LanguageProvider, {
          initialLanguage: language,
          children: createElement(DeviceConfiguration, {
            device,
            days: 14,
            onSaved: () => {},
            onCancel: () => {},
            onRefresh: () => {},
          }),
        }),
      );
      assert.match(temperatureHtml, /<option value="temperature" selected=""/);
      assert.match(temperatureHtml, /type="checkbox"(?! disabled)/);
      assert.doesNotMatch(temperatureHtml, /name="state-0"/);
      assert.ok(
        temperatureHtml.includes(
          language === 'en' ? 'Temperature comparison' : 'Porównanie temperatur',
        ),
      );
      assert.ok(temperatureHtml.includes('21'));
      assert.ok(temperatureHtml.includes('22'));
      assert.doesNotMatch(
        temperatureHtml.match(/<input(?=[^>]*name="estimationEnabled")[^>]*>/)![0],
        /checked/,
      );
    }
  } finally {
    db.close();
  }
});

test('estimation explains measured precedence for cumulative and incremental devices in both languages', () => {
  const db = openDatabase(':memory:');
  try {
    const now = Date.parse('2026-10-16T10:00:00Z');
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','A','unused')");
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          {
            id: 'h',
            name: 'H',
            devices: ['cumulative', 'incremental'].map((energyKind) => ({
              id: energyKind,
              name: energyKind,
              category: 'cz',
              online: true,
              energyKind,
              energyCode: energyKind === 'cumulative' ? 'total_forward_energy' : 'add_ele',
              counterKwh: energyKind === 'cumulative' ? 5 : null,
              temperature: null,
              powerW: null,
            })),
          },
        ],
      },
      now,
    );
    for (const { id } of db.prepare('SELECT id FROM devices').all() as { id: string }[]) {
      const device = getDevice(db, id, now)!;
      assert.equal(device.energySource, 'measured');
      for (const language of ['en', 'pl'] as const) {
        const html = renderToStaticMarkup(
          createElement(LanguageProvider, {
            initialLanguage: language,
            children: createElement(DeviceConfiguration, {
              device,
              days: 14,
              onSaved: () => {},
              onCancel: () => {},
              onRefresh: () => {},
            }),
          }),
        );
        assert.ok(
          html.includes(
            language === 'en'
              ? 'The device provides energy readings. Measurements take precedence; estimation does not add usage for the same device.'
              : 'Urządzenie udostępnia pomiar energii. Pomiar ma pierwszeństwo; estymacja nie dodaje zużycia dla tego samego urządzenia.',
          ),
        );
      }
    }
  } finally {
    db.close();
  }
});
