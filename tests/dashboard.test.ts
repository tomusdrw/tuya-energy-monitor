import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dashboard } from '../src/App.js';
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
  assert.ok(html.includes('href="#accounts"'));
  db.close();
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
  assert.ok(html.includes('≈ 1,00'), 'Any displayed total containing estimates must be marked');
  assert.ok(html.includes('Estymacja:'), 'Owner can separate estimated and measured totals');
  assert.ok(html.includes('Czas grzania × moc'), 'Chart explains its estimated series');
  db.close();
});

test('estimation form exposes unknown state and requires a real heating signal without guessing a power', async () => {
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
  assert.ok(html.includes('Stan grzania nieznany'));
  assert.ok(html.includes('Moc ogrzewania (kW)'));
  assert.ok(html.includes('switch'));
  assert.ok(html.includes('Samo włączenie termostatu'));
  assert.ok(!html.includes('checked=""'), 'Estimation must not enable itself');
  db.close();
});
