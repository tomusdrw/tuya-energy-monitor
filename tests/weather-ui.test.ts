import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
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
  await click('Edit location');
  await change('input[name="address"]', 'Kraków');
  await click('Search address');
  await click('Kraków');
  await ui.render(
    createElement(HomeLocation, { ...props, location: { ...location, label: 'Refreshed' } }),
  );
  assert.match(ui.container.textContent, /Selected location: Kraków/);
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
  await click('Edit location');
  await change('input[name="address"]', 'Kraków');
  await click('Search address');
  await click('Kraków');
  await click('Save location');
  await act(async () =>
    ui.container
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(writes, 1);
  await act(async () => pending.resolve(Response.json({ error: 'Save failed' }, { status: 503 })));
  assert.match(ui.container.textContent, /Save failed/);
  assert.match(ui.container.textContent, /Selected location: Kraków/);
  await click('Save location');
  assert.deepEqual(saved, other);
  assert.equal(ui.container.querySelector('form'), null);
});

test('switching apartments discards drafts and ignores late search results', async (t) => {
  const pending = deferred<Response>();
  t.mock.method(globalThis, 'fetch', async () => pending.promise);
  const props = { homeId: 'a', location, onSaved: () => {} };
  const ui = await mount(createElement(HomeLocation, props));
  t.after(ui.unmount);
  await click('Edit location');
  await change('input[name="address"]', 'Old search');
  await click('Search address');
  await ui.render(createElement(HomeLocation, { ...props, homeId: 'b', location: other }));
  await act(async () => pending.resolve(Response.json([location])));
  assert.equal(ui.container.querySelector('input'), null);
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
  assert.match(ui.container.textContent, /Outdoor data: Kraków/);
  assert.ok(!ui.container.textContent.includes('Outdoor data: Warszawa'));
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
