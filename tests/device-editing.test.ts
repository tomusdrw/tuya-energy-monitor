import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { mount, click, change, check, field, deferred, window } from './helpers/dom.js';
import { deviceFixture } from './helpers/devices.js';
import { DeviceDetails, DevicePage } from '../src/DevicePage.js';
import { DeviceConfiguration } from '../src/DeviceConfiguration.js';
import type { DeviceDetail, EstimationConfig, EstimationView } from '../shared/types.js';

const editorProps = { days: 14, onSaved: () => {}, onRefresh: () => {}, onCancel: () => {} };
const detailProps = { days: 14, setDays: () => {}, onSaved: () => {}, onRefresh: () => {} };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('cancel discards the whole draft without writing and reopening uses the latest saved configuration', async (t) => {
  const device = deviceFixture();
  const writes: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (...args: unknown[]) => {
    writes.push(args);
    throw new Error('Cancel must not send a request');
  });
  const ui = await mount(createElement(DeviceDetails, { ...detailProps, device }));
  t.after(ui.unmount);
  await click('Edit');
  await change('input[type=number]', '2');
  await check('input[type=checkbox]');
  assert.equal(field('input[type=number]').value, '2');
  // A background refresh updates the saved data, but not the active draft.
  const refreshed = { ...device, estimation: { ...device.estimation, ratedPowerKw: 1.75 } };
  await ui.render(createElement(DeviceDetails, { ...detailProps, device: refreshed }));
  assert.equal(field('input[type=number]').value, '2');
  await click('Cancel');
  assert.equal(writes.length, 0);
  assert.equal(ui.container.querySelector('form'), null);
  await act(async () => {
    await new Promise<void>((done) => window.requestAnimationFrame(() => done()));
  });
  assert.equal(window.document.activeElement?.textContent, 'Edit');
  await click('Edit');
  assert.equal(field('input[type=number]').value, '1.75');
  assert.equal(field('input[type=checkbox]').checked, device.included);
});

test('saving monitoring alone does not persist suggested estimation defaults', async (t) => {
  const device = deviceFixture();
  const saved = { ...device, included: false };
  let request: RequestInit | undefined;
  let result: DeviceDetail | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    request = init;
    return response({ ok: true, device: saved });
  });
  const ui = await mount(
    createElement(DeviceConfiguration, {
      ...editorProps,
      device,
      onSaved: (d) => {
        result = d;
      },
    }),
  );
  t.after(ui.unmount);
  await check('input[type=checkbox]');
  await click('Save');
  assert.equal(request?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(request?.body)), { included: false });
  assert.deepEqual(result, saved);
});

test('failed save retains edits and an error; retry submits participation and estimation together', async (t) => {
  const device = deviceFixture();
  const writes: unknown[] = [];
  let saved = false;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    writes.push(JSON.parse(String(init.body)));
    return writes.length === 1
      ? response({ error: 'Could not connect to the application.' }, 500)
      : response({ ok: true, device });
  });
  const ui = await mount(
    createElement(DeviceConfiguration, {
      ...editorProps,
      device,
      onSaved: () => {
        saved = true;
      },
    }),
  );
  t.after(ui.unmount);
  await change('input[type=number]', '2.5');
  await check('input[type=checkbox]');
  await check('input[name=estimationEnabled]');
  await click('Save');
  assert.equal(saved, false);
  assert.ok(ui.container.querySelector('[role=alert]')?.textContent.includes('Could not connect'));
  assert.equal(field('input[type=number]').value, '2.5');
  assert.equal(field('input[type=checkbox]').checked, false);
  assert.equal(field('input[name=estimationEnabled]').checked, true);
  await click('Save');
  assert.equal(saved, true);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], {
    included: false,
    estimation: {
      enabled: true,
      ratedPowerKw: 2.5,
      heatingCode: 'work_state',
      onValues: ['heating'],
      offValues: ['idle'],
      temperature: null,
    },
  });
  assert.deepEqual(writes[1], writes[0]);
});

test('saving blocks duplicate submission and native power only exposes monitoring configuration', async (t) => {
  const device = { ...deviceFixture(), energySource: 'power' as const };
  const pending = deferred<Response>();
  let writes = 0;
  t.mock.method(globalThis, 'fetch', () => {
    writes++;
    return pending.promise;
  });
  const ui = await mount(createElement(DeviceConfiguration, { ...editorProps, device }));
  t.after(ui.unmount);
  assert.equal(ui.container.querySelector('input[type=number]'), null);
  assert.equal(ui.container.querySelector('select'), null);
  await click('Save');
  assert.equal(writes, 1);
  const buttons = [...ui.container.querySelectorAll('button')];
  assert.ok(buttons.every((button) => button.disabled));
  await act(async () => {
    buttons.find((button) => button.textContent.includes('Saving'))!.click();
  });
  assert.equal(writes, 1);
  await act(async () => pending.resolve(response({ ok: true, device })));
});

test('a late save from the previous device cannot discard the current device draft', async (t) => {
  const first = { ...deviceFixture(), id: 'first' };
  const second = { ...deviceFixture(), id: 'second', name: 'Other heater' };
  const pending = deferred<Response>();
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'PUT') return pending.promise;
    return response(url.includes('/second') ? second : first);
  });
  const ui = await mount(createElement(DevicePage, { id: first.id }));
  t.after(ui.unmount);
  await click('Edit');
  await click('Save');
  await ui.render(createElement(DevicePage, { id: second.id }));
  await click('Edit');
  await change('input[type=number]', '3');
  await act(async () => pending.resolve(response({ ok: true, device: first })));
  assert.equal(ui.container.querySelector('h1')?.textContent, 'Other heater');
  assert.equal(field('input[type=number]').value, '3');
});

test('polling errors and recovery keep the active editor and its unsaved values', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const device = deviceFixture();
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads++;
    return reads === 2
      ? response({ error: 'Could not connect to the application.' }, 503)
      : response({
          ...device,
          estimation: { ...device.estimation, ratedPowerKw: reads === 1 ? 1 : 4 },
        });
  });
  const ui = await mount(createElement(DevicePage, { id: device.id }));
  t.after(ui.unmount);
  await click('Edit');
  await change('input[type=number]', '2');
  await act(async () => t.mock.timers.tick(30000));
  assert.equal(reads, 2);
  assert.ok(ui.container.querySelector('[role=alert]'));
  assert.equal(field('input[type=number]').value, '2');
  await act(async () => t.mock.timers.tick(30000));
  assert.equal(reads, 3);
  assert.equal(ui.container.querySelector('[role=alert]'), null);
  assert.equal(field('input[type=number]').value, '2');
  await click('Cancel');
  await click('Edit');
  assert.equal(field('input[type=number]').value, '4');
});

test('successful save returns to an overview of the canonical saved configuration', async (t) => {
  const device = deviceFixture();
  let current = device;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      current = { ...device, included: false };
      return response({ ok: true, device: current });
    }
    return response(current);
  });
  const ui = await mount(createElement(DevicePage, { id: device.id }));
  t.after(ui.unmount);
  await click('Edit');
  await check('input[type=checkbox]');
  await click('Save');
  assert.equal(ui.container.querySelector('form'), null);
  assert.ok(ui.container.querySelector('.device-summary')?.textContent.includes('Excluded'));
  assert.ok(ui.container.textContent.includes('Settings saved.'));
  await click('Edit');
  assert.equal(field('input[type=checkbox]').checked, false);
});

test('accepting detected temperatures is an explicit choice that survives the next probe', async (t) => {
  const base = deviceFixture();
  const oldTemperature = {
    current: { code: 'old_current', scale: 0, unit: 'C' as const },
    target: { code: 'old_target', scale: 0, unit: 'C' as const },
    switchCode: null,
  };
  const detectedTemperature = {
    current: { code: 'temp_current', scale: 1, unit: 'C' as const },
    target: { code: 'temp_set', scale: 1, unit: 'C' as const },
    switchCode: null,
  };
  const device = {
    ...base,
    estimation: {
      ...base.estimation,
      temperature: oldTemperature,
      temperatureSuggestion: detectedTemperature,
    },
  };
  // A probe can return configuration changed elsewhere, together with new live fields.
  const probed: EstimationView = {
    ...base.estimation,
    statusUpdatedAt: Date.now() + 1000,
    temperature: null,
    temperatureSuggestion: null,
  };
  let submitted: { estimation: EstimationConfig } | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      submitted = JSON.parse(String(init.body));
      return response({ ok: true, device });
    }
    return response(probed);
  });
  const ui = await mount(createElement(DeviceConfiguration, { ...editorProps, device }));
  t.after(ui.unmount);
  await click('Use detected temperatures');
  assert.equal(field('select[name=estimationMethod]').value, 'temperature');
  assert.equal(field('select[name=currentTemperature]').value, 'temp_current');
  await click('Detect again');
  assert.equal(field('select[name=estimationMethod]').value, 'temperature');
  assert.equal(field('select[name=currentTemperature]').value, 'temp_current');
  assert.equal(field('select[name=targetTemperature]').value, 'temp_set');
  await click('Save');
  assert.deepEqual(submitted?.estimation.temperature, detectedTemperature);
  assert.equal(submitted?.estimation.heatingCode, null);
});

test('accepting a detected heating signal also keeps its method and assignments across probes', async (t) => {
  const base = deviceFixture();
  const device = {
    ...base,
    estimation: { ...base.estimation, heatingCode: 'old_relay', onValues: [1], offValues: [0] },
  };
  let submitted: { estimation: EstimationConfig } | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      submitted = JSON.parse(String(init.body));
      return response({ ok: true, device });
    }
    return response({
      ...base.estimation,
      statusUpdatedAt: Date.now() + 1000,
      temperature: {
        current: { code: 'temp_current', scale: 1, unit: 'C' },
        target: { code: 'temp_set', scale: 1, unit: 'C' },
        switchCode: null,
      },
    });
  });
  const ui = await mount(createElement(DeviceConfiguration, { ...editorProps, device }));
  t.after(ui.unmount);
  await click('Use detected field: work_state');
  await click('Detect again');
  assert.equal(field('select[name=estimationMethod]').value, 'relay');
  assert.equal(field('select[name=heatingCode]').value, 'work_state');
  assert.equal(field('select[name=state-0]').value, 'on');
  assert.equal(field('select[name=state-1]').value, 'off');
  await click('Save');
  assert.equal(submitted?.estimation.heatingCode, 'work_state');
  assert.equal(submitted?.estimation.temperature, null);
  assert.deepEqual(submitted?.estimation.onValues, ['heating']);
  assert.deepEqual(submitted?.estimation.offValues, ['idle']);
});
