import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WeatherService } from '../server/weather.js';
const location = { label: 'Warsaw', latitude: 52.2, longitude: 21 };
const body = {
  daily_units: { temperature_2m_mean: '°C' },
  daily: {
    time: ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'],
    temperature_2m_mean: [-2, 0, null, 4, 6],
  },
};

test('weather matches dates, preserves gaps and zero, includes today plus three future days, coalesces and expires cache', async () => {
  let now = Date.parse('2026-11-13T23:30:00Z'),
    calls = 0;
  const service = new WeatherService(
    async (url) => {
      calls++;
      const params = new URL(String(url)).searchParams;
      assert.equal(params.get('timezone'), 'Europe/Warsaw');
      assert.equal(params.get('forecast_days'), '4');
      assert.equal(params.get('past_days'), '1');
      return Response.json(body);
    },
    () => now,
  );
  const [a, b] = await Promise.all([service.weather(location, 2), service.weather(location, 2)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.deepEqual(a.points, [
    { day: '2026-11-13', average: -2, forecast: false },
    { day: '2026-11-14', average: 0, forecast: true },
    { day: '2026-11-15', average: null, forecast: true },
    { day: '2026-11-16', average: 4, forecast: true },
    { day: '2026-11-17', average: 6, forecast: true },
  ]);
  await service.weather(location, 2);
  assert.equal(calls, 1);
  now += 31 * 60000;
  await service.weather(location, 2);
  assert.equal(calls, 2);
  await service.weather({ ...location, latitude: 50 }, 2);
  assert.equal(calls, 3);
});

test('weather rejects malformed data and retries after failure instead of caching an error', async () => {
  let calls = 0;
  const service = new WeatherService(
    async () => {
      if (++calls === 1) return Response.json({ daily: { time: [], temperature_2m_mean: [] } });
      return Response.json(body);
    },
    () => Date.parse('2026-11-14T12:00:00Z'),
  );
  await assert.rejects(service.weather(location, 2));
  assert.equal((await service.weather(location, 2)).points[0].average, -2);
});

test('address search returns named coordinates, drops malformed entries and caches searches', async () => {
  let calls = 0;
  const service = new WeatherService(async () => {
    calls++;
    return Response.json({
      features: [
        {
          geometry: { coordinates: [21, 52.2] },
          properties: {
            street: 'Marszałkowska',
            housenumber: '1',
            city: 'Warszawa',
            country: 'Polska',
          },
        },
        { geometry: { coordinates: [21, 120] }, properties: { name: 'Invalid' } },
      ],
    });
  });
  const found = await service.search('Warszawa Marszałkowska 1');
  assert.deepEqual(found, [
    { label: 'Marszałkowska 1, Warszawa, Polska', latitude: 52.2, longitude: 21 },
  ]);
  await service.search('Warszawa Marszałkowska 1');
  assert.equal(calls, 1);
});

test('cache rolls over at Warsaw midnight and forecast uses calendar dates across DST', async () => {
  let now = Date.parse('2026-10-24T21:59:00Z'),
    calls = 0;
  const service = new WeatherService(
    async () => {
      calls++;
      return Response.json(body);
    },
    () => now,
  );
  const before = await service.weather(location, 1);
  assert.equal(before.points[0].day, '2026-10-24');
  assert.equal(before.points[3].day, '2026-10-27');
  now += 2 * 60000;
  const after = await service.weather(location, 1);
  assert.equal(calls, 2);
  assert.deepEqual(
    after.points.map((p) => p.day),
    ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'],
  );
  assert.ok(after.points.every((p) => p.forecast && p.average === null));
});
