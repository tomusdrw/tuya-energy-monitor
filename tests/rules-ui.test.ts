import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { mount, click, change, field, deferred, window } from './helpers/dom.js';
import { HomePage } from '../src/pages.js';
import { LanguageProvider } from '../src/i18n.js';
import { openDatabase } from '../server/db.js';
import { getHome, ingestSnapshot } from '../server/energy.js';
import type { Rules } from '../shared/types.js';

function homesFixture() {
  const db = openDatabase(':memory:');
  try {
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          { id: 'first', name: 'First', devices: [] },
          { id: 'second', name: 'Second', devices: [] },
        ],
      },
      Date.now(),
    );
    return (db.prepare('SELECT id FROM homes ORDER BY name').all() as { id: string }[]).map(
      ({ id }) => ({
        ...getHome(db, id, Date.now())!,
        rules: {
          dailyLimit: 12.5,
          anomalyEnabled: true,
          windowDays: 14,
          increasePercent: 35,
          increaseKwh: 2.5,
        },
      }),
    );
  } finally {
    db.close();
  }
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const limit = 'form[aria-label="Notification rules"] input[name="dailyLimit"]';
const rulePanel = () => window.document.querySelector('[aria-label="Notification rules"]')!;
async function saveRules() {
  // happy-dom incorrectly flags valid decimal steps (e.g. 2.5 with step=0.1).
  // Exercise the real submit button/handler without its browser validation emulation.
  (rulePanel() as unknown as HTMLFormElement).noValidate = true;
  await click('Save rules');
}

test('rules start as a summary; cancel discards edits without writing', async (t) => {
  const homes = homesFixture();
  const writes: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') writes.push(init.body);
    return response(homes[0]);
  });
  const ui = await mount(createElement(HomePage, { id: homes[0].id, homes }));
  t.after(ui.unmount);
  assert.equal(Boolean(window.document.querySelector('.rules-form')), false);
  assert.match(rulePanel().textContent, /12.5/);
  assert.match(rulePanel().textContent, /35/);
  assert.match(rulePanel().textContent, /2.5/);
  assert.match(rulePanel().textContent, /14/);
  await click('Edit');
  assert.equal(window.document.activeElement, field(limit));
  await change(limit, '22');
  await click('Cancel');
  assert.equal(Boolean(window.document.querySelector('.rules-form')), false);
  assert.match(rulePanel().textContent, /12.5/);
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  assert.equal(window.document.activeElement?.textContent.trim(), 'Edit');
  await click('Edit');
  assert.equal(field(limit).value, '12.5');
  assert.equal(writes.length, 0);
});

test('save returns to the summary and updates the apartment threshold', async (t) => {
  const homes = homesFixture();
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      assert.equal(url, `/api/homes/${homes[0].id}/rules`);
      const rules = JSON.parse(String(init.body)) as Rules;
      assert.deepEqual(rules, {
        dailyLimit: 23.5,
        anomalyEnabled: true,
        windowDays: 14,
        increasePercent: 35,
        increaseKwh: 2.5,
      });
      homes[0] = { ...homes[0], rules };
      writes++;
      return response({ ok: true });
    }
    return response(homes[0]);
  });
  const ui = await mount(createElement(HomePage, { id: homes[0].id, homes }));
  t.after(ui.unmount);
  await click('Edit');
  await change(limit, '23.5');
  await saveRules();
  assert.equal(writes, 1);
  assert.equal(Boolean(window.document.querySelector('.rules-form')), false);
  assert.match(rulePanel().textContent, /23.5/);
  assert.match(rulePanel().textContent, /Settings saved/);
  assert.match(ui.container.querySelector('.stats-grid')!.textContent, /23.5/);
  await click('Edit');
  assert.equal(field(limit).value, '23.5');
});

test('failed saves keep the draft and pending saves lock the form', async (t) => {
  const homes = homesFixture();
  const pending = deferred<Response>();
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      writes++;
      return pending.promise;
    }
    return response(homes[0]);
  });
  const ui = await mount(createElement(HomePage, { id: homes[0].id, homes }));
  t.after(ui.unmount);
  await click('Edit');
  await change(limit, '22');
  await saveRules();
  assert.ok(field(limit).closest('fieldset')?.disabled);
  const cancel = [...window.document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Cancel',
  )!;
  assert.equal(cancel.disabled, true);
  await act(async () =>
    rulePanel().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(writes, 1);
  await act(async () =>
    pending.resolve(response({ error: 'Could not connect to the application.' }, 500)),
  );
  assert.equal(field(limit).value, '22');
  assert.match(rulePanel().textContent, /Could not connect/);
  assert.equal(cancel.disabled, false);
  await click('Cancel');
  assert.match(rulePanel().textContent, /12.5/);
});

test('refresh updates summaries but preserves drafts; switching apartments closes the editor', async (t) => {
  const homes = homesFixture();
  let refresh: () => void = () => {};
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => {
    refresh = callback;
    return 0;
  });
  t.mock.method(globalThis, 'fetch', async (url: string) =>
    response(homes.find((h) => url.includes(h.id))),
  );
  const ui = await mount(createElement(HomePage, { id: homes[0].id, homes }));
  t.after(ui.unmount);
  homes[0] = { ...homes[0], rules: { ...homes[0].rules, dailyLimit: 18 } };
  await act(async () => refresh());
  assert.match(rulePanel().textContent, /18/);
  await click('Edit');
  await change(limit, '22');
  homes[0] = { ...homes[0], rules: { ...homes[0].rules, dailyLimit: 19 } };
  await act(async () => refresh());
  assert.equal(field(limit).value, '22');
  await click('Cancel');
  assert.match(rulePanel().textContent, /19/);
  await click('Edit');
  await ui.render(createElement(HomePage, { id: homes[1].id, homes }));
  assert.equal(Boolean(window.document.querySelector('.rules-form')), false);
  assert.match(rulePanel().textContent, /12.5/);
});

test('disabled rules are explicit in the Polish summary and can be edited', async (t) => {
  const homes = homesFixture();
  homes[0].rules = { ...homes[0].rules, dailyLimit: null, anomalyEnabled: false };
  t.mock.method(globalThis, 'fetch', async () => response(homes[0]));
  const ui = await mount(
    createElement(LanguageProvider, {
      initialLanguage: 'pl',
      children: createElement(HomePage, { id: homes[0].id, homes }),
    }),
  );
  t.after(ui.unmount);
  const panel = window.document.querySelector('[aria-label="Reguły powiadomień"]')!;
  assert.match(panel.textContent, /Brak progu/);
  assert.match(panel.textContent, /Wyłączone/);
  assert.equal(panel.querySelector('input'), null);
  await click('Edytuj');
  assert.equal(field('input[name="dailyLimit"]').value, '');
  assert.equal(field('input[type="checkbox"]').checked, false);
  await click('Anuluj');
});

test('a failed background refresh keeps the active rules draft through recovery', async (t) => {
  const homes = homesFixture();
  let refresh: () => void = () => {};
  let failing = false;
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => {
    refresh = callback;
    return 0;
  });
  t.mock.method(globalThis, 'fetch', async () =>
    failing
      ? response({ error: 'Could not connect to the application.' }, 500)
      : response(homes[0]),
  );
  const ui = await mount(createElement(HomePage, { id: homes[0].id, homes }));
  t.after(ui.unmount);
  await click('Edit');
  await change(limit, '22');
  failing = true;
  await act(async () => refresh());
  assert.match(ui.container.textContent, /Could not connect/);
  assert.equal(field(limit).value, '22');
  failing = false;
  await act(async () => refresh());
  assert.equal(field(limit).value, '22');
  await click('Cancel');
  assert.match(rulePanel().textContent, /12.5/);
});
