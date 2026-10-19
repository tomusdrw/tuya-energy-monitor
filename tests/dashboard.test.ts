import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dashboard } from '../src/App.js';
import { AlertList } from '../src/components.js';
import { LanguageProvider } from '../src/i18n.js';
import { openDatabase } from '../server/db.js';
import { getOverview } from '../server/energy.js';

test('dashboard exposes account failures even when no devices have been discovered for that account', () => {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO accounts(id,label,secret,error) VALUES(?,?,?,?)').run(
    'uncollected',
    'Drugie konto',
    'unused',
    'Sesja Tuya wygasła',
  );
  const html = renderToStaticMarkup(
    createElement(Dashboard, {
      data: getOverview(db, Date.now()),
      days: 14,
      setDays: () => {},
    }),
  );
  assert.ok(
    html.includes('Sesja Tuya wygasła'),
    'Owner must see the account error on the overview',
  );
  assert.ok(html.includes('Drugie konto'), 'Owner must know which account needs attention');
  assert.ok(html.includes('Energy usage'), 'The dashboard defaults to English');
  assert.ok(html.includes('Check connection'));
  assert.ok(html.includes('href="#accounts"'));
  db.prepare('UPDATE accounts SET error = ?').run('Account not found.');
  const polishHtml = renderToStaticMarkup(
    createElement(LanguageProvider, {
      initialLanguage: 'pl',
      children: createElement(Dashboard, {
        data: getOverview(db, Date.now()),
        days: 14,
        setDays: () => {},
      }),
    }),
  );
  assert.ok(polishHtml.includes('Nie znaleziono konta.'));
  assert.ok(polishHtml.includes('Konto Drugie konto wymaga uwagi.'));
  db.close();
});

test('notification details use the selected language without changing original content', () => {
  const notification = {
    id: 'n',
    homeId: 'h',
    kind: 'threshold',
    title: 'Daily limit exceeded: Mieszkanie A',
    body: 'Observed energy: 12.50 kWh.',
    translations: {
      pl: {
        title: 'Przekroczony próg dzienny: Mieszkanie A',
        body: 'Zaobserwowana energia: 12,50 kWh.',
      },
    },
    createdAt: Date.parse('2026-10-16T10:00Z'),
    status: 'retry',
    sentAt: null,
    error: 'Delivery was not confirmed. We will retry with the same identifier.',
  };
  const english = renderToStaticMarkup(createElement(AlertList, { items: [notification] }));
  assert.ok(english.includes('Daily limit exceeded: Mieszkanie A'));
  assert.ok(english.includes('Observed energy: 12.50 kWh.'));
  assert.ok(english.includes('Retrying'));
  assert.ok(english.includes('Notification details'));
  const polish = renderToStaticMarkup(
    createElement(LanguageProvider, {
      initialLanguage: 'pl',
      children: createElement(AlertList, { items: [notification] }),
    }),
  );
  assert.ok(polish.includes('Przekroczony próg dzienny: Mieszkanie A'));
  assert.ok(polish.includes('Zaobserwowana energia: 12,50 kWh.'));
  assert.ok(polish.includes('Ponowna próba'));
  assert.ok(polish.includes('Szczegóły powiadomienia'));
  assert.ok(polish.includes('Nie potwierdzono wysyłki.'));
  assert.equal(notification.body, 'Observed energy: 12.50 kWh.');
});

test('mixed totals identify estimates in dashboard, cards, chart and source breakdown', async () => {
  const { ingestSnapshot } = await import('../server/energy.js');
  const db = openDatabase(':memory:');
  const now = Date.parse('2026-10-16T10:00Z');
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
            {
              id: 'd',
              name: 'Thermostat',
              category: 'wk',
              online: true,
              energyKind: 'unsupported',
              energyCode: null,
              counterKwh: null,
              temperature: null,
              powerW: null,
            },
          ],
        },
      ],
    },
    now,
  );
  const d = (db.prepare('SELECT id FROM devices').get() as any).id;
  db.prepare(
    "INSERT INTO intervals(device_id,start,end,kwh,source,on_ms) VALUES(?,?,?,?,'estimated',?)",
  ).run(d, now - 60000, now, 1, 60000);
  const html = renderToStaticMarkup(
    createElement(Dashboard, { data: getOverview(db, now), days: 14, setDays: () => {} }),
  );
  assert.ok(html.includes('≈ 1.00'), 'English totals use English decimal formatting');
  assert.ok(html.includes('Estimated:'), 'Owner can separate estimated and measured totals');
  assert.ok(html.includes('Heating time × power'), 'Chart explains its estimated series');
  assert.ok(html.includes('aria-label="Daily energy usage in kilowatt-hours"'));
  const polishHtml = renderToStaticMarkup(
    createElement(LanguageProvider, {
      initialLanguage: 'pl',
      children: createElement(Dashboard, {
        data: getOverview(db, now),
        days: 14,
        setDays: () => {},
      }),
    }),
  );
  assert.ok(polishHtml.includes('Zużycie energii'));
  assert.ok(polishHtml.includes('≈ 1,00'), 'Polish totals use Polish decimal formatting');
  assert.ok(polishHtml.includes('Estymacja:'));
  assert.ok(polishHtml.includes('Czas grzania × moc'));
  assert.ok(polishHtml.includes('aria-label="Dzienne zużycie energii w kilowatogodzinach"'));
  assert.ok(polishHtml.includes('<h3>Home</h3>'), 'The selected language preserves home names');
  db.close();
});

test('incremental reports render as measured energy without claiming time coverage in either language', async () => {
  const { ingestSnapshot } = await import('../server/energy.js');
  const { ingestEnergyReport } = await import('../server/incremental.js');
  const db = openDatabase(':memory:');
  const start = Date.parse('2026-10-16T10:00Z');
  try {
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
              {
                id: 'd',
                name: 'Incremental meter',
                category: 'cz',
                online: true,
                energyKind: 'incremental',
                energyCode: 'add_ele',
                counterKwh: null,
                temperature: null,
                powerW: null,
              },
            ],
          },
        ],
      },
      start,
    );
    const render = (language: 'en' | 'pl') =>
      renderToStaticMarkup(
        createElement(LanguageProvider, {
          initialLanguage: language,
          children: createElement(Dashboard, {
            data: getOverview(db, start + 60000),
            days: 14,
            setDays: () => {},
          }),
        }),
      );
    assert.ok(render('en').includes('after the first incremental report'));
    assert.ok(render('pl').includes('po pierwszym raporcie przyrostowym'));

    ingestEnergyReport(
      db,
      'a',
      {
        deviceId: 'd',
        code: 'add_ele',
        at: start + 1000,
        kwh: 0.12,
      },
      start + 60000,
    );
    const english = render('en');
    assert.ok(english.includes('0.12'));
    assert.ok(english.includes('1 measured · 0 estimated / 1 selected · 0% time coverage'));
    assert.ok(english.includes('Energy measurement'));
    assert.ok(
      !english.includes('≈'),
      'Actual incremental readings must not be marked as estimates',
    );
    assert.ok(
      !english.includes('after the first incremental report'),
      'One report starts the chart',
    );
    const polish = render('pl');
    assert.ok(polish.includes('0,12'));
    assert.ok(polish.includes('1 z pomiarem · 0 z estymacją / 1 wybranych · 0% pokrycia czasu'));
    assert.ok(polish.includes('Pomiar energii'));
  } finally {
    db.close();
  }
});

test('estimation form exposes unknown state and requires a real heating signal without enabling itself', async () => {
  const { EstimationForm } = await import('../src/EstimationForm.js');
  const { getDevice, ingestSnapshot } = await import('../server/energy.js');
  const db = openDatabase(':memory:');
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
            {
              id: 'd',
              name: 'Thermostat',
              category: 'wk',
              online: true,
              energyKind: 'unsupported',
              energyCode: null,
              counterKwh: null,
              temperature: null,
              powerW: null,
              statusFields: [{ code: 'switch', value: true }],
            },
          ],
        },
      ],
    },
    now,
  );
  const d = (db.prepare('SELECT id FROM devices').get() as any).id;
  const html = renderToStaticMarkup(
    createElement(EstimationForm, { device: getDevice(db, d, now)!, onSaved: () => {} }),
  );
  assert.ok(html.includes('Heating state unknown'));
  assert.ok(html.includes('Heating power (kW)'));
  assert.ok(html.includes('switch'));
  assert.ok(html.includes('Turning the thermostat on'));
  assert.ok(!html.includes('checked=""'), 'Estimation must not enable itself');
  assert.ok(html.includes('No recognized heating signal was found.'));
  assert.match(html, /type="checkbox" disabled=""/);
  db.close();
});
