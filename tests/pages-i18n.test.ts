import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n.js';
import { AccountsPage, NotificationsPage } from '../src/pages.js';
import { EstimationForm } from '../src/EstimationForm.js';
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
          children: createElement(EstimationForm, { device, onSaved: () => {} }),
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
      assert.ok(!html.includes('checked=""'));
    }
  } finally {
    db.close();
  }
});
