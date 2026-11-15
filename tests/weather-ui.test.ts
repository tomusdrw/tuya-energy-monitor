import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mount, click, change, window, deferred } from './helpers/dom.js';
import { ClimateHistory } from '../src/Climate.js';
import { LanguageProvider } from '../src/i18n.js';
import { HomeLocation } from '../src/HomeLocation.js';
const location = { label: 'Warszawa', latitude: 52.2, longitude: 21 };
const other = { label: 'Kraków', latitude: 50, longitude: 20 };
const metric = {
  average: 22,
  minimum: 21,
  maximum: 23,
  count: 1,
  samples: 2,
  oldestObservedAt: 0,
  latestObservedAt: 0,
};
const points = [
  { day: '2026-11-13', temperature: metric, humidity: metric },
  { day: '2026-11-14', temperature: metric, humidity: metric },
];
const outdoor = [
  { day: '2026-11-13', average: -5, forecast: false },
  { day: '2026-11-14', average: 0, forecast: true },
  { day: '2026-11-15', average: 2, forecast: true },
  { day: '2026-11-16', average: null, forecast: true },
  { day: '2026-11-17', average: 4, forecast: true },
];

test('chart extends only temperature by three days, distinguishes forecast and does not bridge missing days', async () => {
  const ui = await mount(createElement(ClimateHistory, { points, outdoor }));
  try {
    const temperature = ui.container.querySelector('.climate-chart.temperature')!;
    assert.equal(temperature.querySelectorAll('.chart-hit-area').length, 5);
    assert.equal(
      ui.container.querySelector('.climate-chart.humidity')!.querySelectorAll('.chart-hit-area')
        .length,
      2,
    );
    assert.equal(temperature.querySelectorAll('line.outdoor-forecast').length, 2);
    assert.ok(temperature.textContent.includes('Forecast'));
    const target = temperature.querySelectorAll('.chart-hit-area')[2];
    await act(async () => target.dispatchEvent(new window.Event('focusin', { bubbles: true })));
    assert.match(ui.container.querySelector('[role="tooltip"]')!.textContent, /Forecast/);
    assert.match(ui.container.querySelector('[role="tooltip"]')!.textContent, /2.0/);
    for (const language of ['en', 'pl'] as const) {
      const html = renderToStaticMarkup(
        createElement(LanguageProvider, {
          initialLanguage: language,
          children: createElement(ClimateHistory, { points, outdoor }),
        }),
      );
      assert.ok(html.includes(language === 'en' ? 'Forecast' : 'Prognoza'));
      assert.ok(html.includes(language === 'en' ? '-5.0' : '-5,0'));
    }
  } finally {
    await ui.unmount();
  }
});

async function toggleLocation() {
  const trigger = window.document.querySelector('button[aria-label="Apartment location"]');
  assert.ok(trigger, 'Saved location has an accessible disclosure button');
  await act(async () => trigger.click());
}

async function editLocation() {
  await toggleLocation();
  await click('Edit location');
  assert.ok(window.document.querySelector('dialog[open]'), 'Editing opens a modal dialog');
}

test('location starts as summary; search does not save, cancel discards draft and refresh preserves it', async (t) => {
  const writes: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'PUT') writes.push(String(init.body));
    return Response.json(url.includes('search') ? [other] : { location: other });
  });
  const props = { homeId: 'a', location, onSaved: () => {} };
  const ui = await mount(createElement(HomeLocation, props));
  t.after(ui.unmount);
  assert.equal(ui.container.querySelector('input'), null);
  assert.ok(!ui.container.textContent.includes('Warszawa'));
  await editLocation();
  await change('input[name="address"]', 'Kraków');
  await click('Search address');
  await click('Kraków');
  await ui.render(
    createElement(HomeLocation, { ...props, location: { ...location, label: 'Refreshed' } }),
  );
  assert.match(window.document.querySelector('dialog')!.textContent, /Selected location: Kraków/);
  assert.equal(writes.length, 0);
  await click('Cancel');
  assert.match(ui.container.textContent, /Refreshed/);
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  assert.equal(window.document.activeElement?.textContent, 'Edit location');
});

test('failed location save keeps draft, blocks duplicate submission, then succeeds on retry', async (t) => {
  const pending = deferred<Response>();
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'PUT')
      return ++writes === 1 ? pending.promise : Response.json({ location: other });
    return Response.json([other]);
  });
  let saved: unknown;
  const ui = await mount(
    createElement(HomeLocation, {
      homeId: 'a',
      location,
      onSaved: (value) => {
        saved = value;
      },
    }),
  );
  t.after(ui.unmount);
  await editLocation();
  await change('input[name="address"]', 'Kraków');
  await click('Search address');
  await click('Kraków');
  await click('Save location');
  await act(async () =>
    window.document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(writes, 1);
  await act(async () =>
    window.document
      .querySelector('dialog')!
      .dispatchEvent(new window.Event('cancel', { cancelable: true })),
  );
  assert.ok(window.document.querySelector('dialog'), 'Cannot dismiss an in-flight save');
  await act(async () => pending.resolve(Response.json({ error: 'Save failed' }, { status: 503 })));
  assert.match(window.document.querySelector('dialog')!.textContent, /Save failed/);
  assert.match(window.document.querySelector('dialog')!.textContent, /Selected location: Kraków/);
  await click('Save location');
  assert.deepEqual(saved, other);
  assert.equal(window.document.querySelector('dialog'), null);
});

test('switching apartments discards drafts and ignores late search results', async (t) => {
  const pending = deferred<Response>();
  t.mock.method(globalThis, 'fetch', async () => pending.promise);
  const props = { homeId: 'a', location, onSaved: () => {} };
  const ui = await mount(createElement(HomeLocation, props));
  t.after(ui.unmount);
  await editLocation();
  await change('input[name="address"]', 'Old search');
  await click('Search address');
  await ui.render(createElement(HomeLocation, { ...props, homeId: 'b', location: other }));
  await act(async () => pending.resolve(Response.json([location])));
  assert.equal(ui.container.querySelector('input'), null);
  assert.equal(window.document.querySelector('dialog'), null);
  await toggleLocation();
  assert.match(ui.container.textContent, /Kraków/);
  assert.ok(!ui.container.textContent.includes('Warszawa'));
});

test('outdoor-only chart includes negative temperatures without inventing indoor readings', () => {
  const empty = {
    average: null,
    minimum: null,
    maximum: null,
    count: 0,
    samples: 0,
    oldestObservedAt: null,
    latestObservedAt: null,
  };
  const html = renderToStaticMarkup(
    createElement(ClimateHistory, {
      points: points.map((p) => ({ ...p, temperature: empty, humidity: empty })),
      outdoor,
    }),
  );
  assert.equal((html.match(/role="group"/g) ?? []).length, 1);
  assert.ok(html.includes('-6.0'));
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('class="climate-point"'));
});

test('weather for a previous location is ignored after a location change', async (t) => {
  const { OutdoorWeather } = await import('../src/OutdoorWeather.js');
  const pending = deferred<Response>();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    ++calls === 1
      ? pending.promise
      : Response.json({
          location: other,
          points: outdoor.map((p) => ({ ...p, average: 8 })),
          updatedAt: 123,
        }),
  );
  const props = { homeId: 'a', location, days: 2, points };
  const ui = await mount(createElement(OutdoorWeather, props));
  t.after(ui.unmount);
  await ui.render(createElement(OutdoorWeather, { ...props, location: other }));
  await act(async () =>
    pending.resolve(Response.json({ location, points: outdoor, updatedAt: 123 })),
  );
  assert.match(ui.container.textContent, /Outdoor data updated:/);
  assert.ok(!ui.container.textContent.includes('Kraków'));
  assert.ok(!ui.container.textContent.includes('Warszawa'));
  assert.ok(!ui.container.textContent.includes('-5.0'));
});

test('no saved location makes no weather request; provider failure keeps indoor readings visible and offers retry', async (t) => {
  const { OutdoorWeather } = await import('../src/OutdoorWeather.js');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1
      ? Response.json({ error: 'Weather is unavailable. Please try again.' }, { status: 503 })
      : Response.json({ location, points: outdoor, updatedAt: 123 });
  });
  const props = { homeId: 'a', location: null, days: 2, points };
  const ui = await mount(createElement(OutdoorWeather, props));
  t.after(ui.unmount);
  assert.equal(calls, 0);
  await ui.render(createElement(OutdoorWeather, { ...props, location }));
  assert.match(ui.container.textContent, /Weather is unavailable/);
  assert.equal(ui.container.querySelectorAll('.climate-point').length, 4);
  await click('Retry weather');
  assert.equal(calls, 2);
  assert.ok(!ui.container.textContent.includes('Weather is unavailable'));
  assert.ok(ui.container.querySelector('.outdoor-forecast'));
});

test('location popover dismisses on Escape and outside interaction; dialog cancellation discards draft', async (t) => {
  const ui = await mount(createElement(HomeLocation, { homeId: 'a', location, onSaved: () => {} }));
  t.after(ui.unmount);
  await toggleLocation();
  assert.match(ui.container.textContent, /Warszawa/);
  await act(async () =>
    window.document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  assert.ok(!ui.container.textContent.includes('Warszawa'));
  assert.equal(window.document.activeElement?.getAttribute('aria-label'), 'Apartment location');
  await toggleLocation();
  await act(async () =>
    window.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })),
  );
  assert.ok(!ui.container.textContent.includes('Warszawa'));
  await editLocation();
  await change('input[name="address"]', 'Unsaved address');
  await act(async () =>
    window.document
      .querySelector('dialog')!
      .dispatchEvent(new window.Event('cancel', { cancelable: true })),
  );
  assert.equal(window.document.querySelector('dialog'), null);
  await click('Edit location');
  assert.equal(window.document.querySelector('input')?.value, 'Warszawa');
});

test('missing location offers a localized explicit setup action and cancellation returns focus', async (t) => {
  const ui = await mount(
    createElement(LanguageProvider, {
      initialLanguage: 'pl',
      children: createElement(HomeLocation, { homeId: 'a', location: null, onSaved: () => {} }),
    }),
  );
  t.after(ui.unmount);
  assert.equal(window.document.querySelector('dialog'), null);
  await click('Ustaw lokalizację');
  const dialog = window.document.querySelector('dialog[open]');
  assert.ok(dialog);
  assert.match(dialog.textContent, /Lokalizacja mieszkania/);
  assert.equal(
    window.document.querySelector('button[type="submit"]')?.hasAttribute('disabled'),
    true,
  );
  await click('Anuluj');
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  assert.equal(window.document.activeElement?.textContent, 'Ustaw lokalizację');
});

test('creating and removing a location updates the summary only after save', async (t) => {
  const writes: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method !== 'PUT') return Response.json([other]);
    const body = JSON.parse(String(init.body));
    writes.push(body);
    return Response.json(body);
  });
  function SavedLocation() {
    const [saved, setSaved] = useState<typeof location | null>(null);
    return createElement(HomeLocation, { homeId: 'a', location: saved, onSaved: setSaved });
  }
  const ui = await mount(createElement(SavedLocation));
  t.after(ui.unmount);
  await click('Set location');
  await change('input[name="address"]', 'Kraków');
  await click('Search address');
  await click('Kraków');
  assert.equal(writes.length, 0);
  await click('Save location');
  assert.deepEqual(writes, [{ location: other }]);
  assert.equal(window.document.querySelector('dialog'), null);
  assert.match(ui.container.textContent, /Kraków/);
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  assert.equal(window.document.activeElement?.getAttribute('aria-label'), 'Apartment location');
  await click('Edit location');
  await click('Remove location');
  assert.match(
    window.document.querySelector('dialog')!.textContent,
    /will be disabled after saving/,
  );
  await click('Cancel');
  assert.equal(writes.length, 1);
  assert.match(ui.container.textContent, /Kraków/);
  await click('Edit location');
  await click('Remove location');
  await click('Save location');
  assert.deepEqual(writes, [{ location: other }, { location: null }]);
  assert.ok(!ui.container.textContent.includes('Kraków'));
  assert.equal(window.document.querySelector('dialog'), null);
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  assert.equal(window.document.activeElement?.textContent, 'Set location');
});
