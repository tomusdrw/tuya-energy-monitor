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
