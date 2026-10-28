import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { mount, click, check, field, deferred, window } from './helpers/dom.js';
import { deviceFixture } from './helpers/devices.js';
import { DeviceSelection, DeviceSelectionList } from '../src/DeviceSelection.js';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const checkbox = '.selection-choice input';

test('pending selection saves retain keyboard focus and reject duplicate changes', async (t) => {
  const device = deviceFixture();
  const pending = deferred<Response>();
  const writes: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    writes.push(init);
    return pending.promise;
  });
  const ui = await mount(
    createElement(DeviceSelectionList, {
      devices: [device],
      mode: 'temperature',
      onSaved: () => {},
    }),
  );
  t.after(ui.unmount);
  const input = field(checkbox);
  input.focus();
  await check(checkbox);
  assert.equal(input.disabled, false, 'Busy checkboxes must stay focusable');
  assert.equal(input.getAttribute('aria-disabled'), 'true');
  assert.equal(input.getAttribute('aria-busy'), 'true');
  assert.equal(window.document.activeElement, input);
  await check(checkbox);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(String(writes[0].body)), { temperatureIncluded: false });
  await act(async () => pending.resolve(response({ ok: true })));
  assert.equal(input.checked, false);
  assert.equal(input.getAttribute('aria-busy'), 'false');
  assert.equal(window.document.activeElement, input);
});

test('closing and reopening a pending picker retains its lock and receives the saved state', async (t) => {
  let device = deviceFixture();
  const pending = deferred<Response>();
  let writes = 0;
  let saved = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      writes++;
      return pending.promise;
    }
    return response({ devices: [device] });
  });
  const ui = await mount(
    createElement(DeviceSelection, {
      homeId: device.homeId,
      mode: 'temperature',
      onSaved: () => {
        saved++;
      },
    }),
  );
  t.after(ui.unmount);
  await click('Choose sensors');
  await check(checkbox);
  const input = field(checkbox);
  await act(async () =>
    window.document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
  );
  assert.equal(Boolean(window.document.querySelector('dialog')?.hasAttribute('open')), false);
  await click('Choose sensors');
  assert.equal(field(checkbox), input, 'Pending row must survive dismissal');
  assert.equal(input.getAttribute('aria-busy'), 'true');
  await check(checkbox);
  assert.equal(writes, 1);
  device = { ...device, temperatureIncluded: false };
  await act(async () => pending.resolve(response({ ok: true, device })));
  assert.equal(field(checkbox).checked, false);
  assert.equal(field(checkbox).getAttribute('aria-busy'), 'false');
  assert.equal(saved, 1);
  await act(async () =>
    window.document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
  );
  assert.equal(window.document.querySelector('dialog'), null);
});

test('failed selection saves keep the old value, expose an error and allow retry', async (t) => {
  const device = deviceFixture();
  let writes = 0;
  let saved = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init.body)), { included: false });
    return ++writes === 1
      ? response({ error: 'Could not connect to the application.' }, 500)
      : response({ ok: true });
  });
  const ui = await mount(
    createElement(DeviceSelectionList, {
      devices: [device],
      mode: 'energy',
      onSaved: () => {
        saved++;
      },
    }),
  );
  t.after(ui.unmount);
  await check(checkbox);
  assert.equal(field(checkbox).checked, true);
  assert.equal(field(checkbox).getAttribute('aria-busy'), 'false');
  assert.ok(
    window.document.querySelector('.selection-error')?.textContent.includes('Could not connect'),
  );
  assert.equal(saved, 0);
  await check(checkbox);
  assert.equal(field(checkbox).checked, false);
  assert.equal(window.document.querySelector('.selection-error'), null);
  assert.equal(saved, 1);
});
