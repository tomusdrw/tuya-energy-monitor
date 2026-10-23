import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TuyaAiClient, parseModel, readCounter, apiRegion } from '../server/tuya-ai.js';
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/tuya-ai/${name}.json`, import.meta.url), 'utf8'));
const model = fixture('model');
const detail = fixture('detail');
const key = 'sk-EUtest-key';

test('recorded detail/model confirm DP 101, scale 3, kW·h and 370 → 0.370 kWh', () => {
  const metadata = parseModel(model.result);
  assert.equal(metadata.length, 1);
  assert.deepEqual(metadata[0], { code: 'forward_energy_total', dpId: 101, scale: 3, unit: 'kwh' });
  assert.equal(readCounter(detail.result, metadata, 'heater-fixture')?.counterKwh, 0.37);
  assert.throws(() => readCounter(detail.result, metadata, 'different-device'));
});

test('only confirmed cumulative numeric properties with explicit scale and energy units are accepted', () => {
  const property = (JSON.parse(model.result.model).services[0].properties as any[]).find(
    (p) => p.code === 'forward_energy_total',
  );
  const parse = (p: any) =>
    parseModel({ model: JSON.stringify({ services: [{ properties: [p] }] }) });
  for (const p of [
    { ...property, code: 'add_ele' },
    { ...property, accessMode: 'wr' },
    { ...property, typeSpec: { ...property.typeSpec, scale: undefined } },
    { ...property, typeSpec: { ...property.typeSpec, unit: '' } },
    { ...property, typeSpec: { ...property.typeSpec, unit: 'W' } },
    { ...property, typeSpec: { ...property.typeSpec, type: 'enum' } },
  ])
    assert.deepEqual(parse(p), []);
  const meta = parse({ ...property, typeSpec: { ...property.typeSpec, unit: ' Wh ', scale: 0 } });
  assert.equal(readCounter(detail.result, meta, 'heater-fixture')?.counterKwh, 0.37);
  for (const raw of [null, undefined, true, '370', -1, Infinity]) {
    assert.throws(() =>
      readCounter(
        { ...detail.result, properties: { forward_energy_total: raw } },
        parseModel(model.result),
        'heater-fixture',
      ),
    );
  }
  assert.throws(() => parseModel({ model: '{' }));
  assert.throws(() => parseModel({ model: '{}' }));
});

test('regional hosts are fixed by key prefix, including Europe and Singapore; unknown prefixes fail closed', () => {
  assert.deepEqual(apiRegion(key), { region: 'EU', origin: 'https://openapi.tuyaeu.com' });
  assert.equal(apiRegion('sk-WEtest').origin, 'https://openapi-weaz.tuyaeu.com');
  assert.equal(apiRegion('sk-SGtest').origin, 'https://openapi-sg.iotbing.com');
  for (const value of ['sk-XXtest', 'https://evil.example', 'sk-EU\nsecret'])
    assert.throws(() => apiRegion(value));
});

test('HTTP client reads documented envelopes, sends only GET/Bearer, paces calls and retries 1199 and 429', async () => {
  let now = 0;
  const starts: number[] = [];
  const replies = [
    new Response(JSON.stringify({ success: false, code: 1199, msg: key })),
    new Response('', { status: 429, headers: { 'Retry-After': '3' } }),
    new Response(JSON.stringify(detail)),
    new Response(JSON.stringify(model)),
  ];
  const client = new TuyaAiClient({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: async (url, init) => {
      starts.push(now);
      assert.match(
        String(url),
        /^https:\/\/openapi.tuyaeu.com\/v1.0\/end-user\/devices\/heater-fixture\/(detail|model)$/,
      );
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${key}`);
      return replies.shift()!;
    },
  });
  const got = await client.detail(key, 'heater-fixture');
  assert.equal(got.device_id, 'heater-fixture');
  assert.equal((await client.model(key, 'heater-fixture'))[0].scale, 3);
  assert.equal(starts.length, 4);
  assert.ok(starts[1] - starts[0] >= 2000);
  assert.ok(starts[2] - starts[1] >= 3000);
  assert.ok(starts[3] - starts[2] >= 1000);
});

test('limited retries and safe errors: no raw API messages, no retry of auth errors or long Retry-After', async () => {
  for (const response of [
    () => new Response(JSON.stringify({ success: false, code: 1199, msg: key })),
    () => new Response(JSON.stringify({ success: false, code: 1010, msg: key })),
    () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } }),
    () => new Response(JSON.stringify({ success: true, result: null })),
  ]) {
    let calls = 0;
    const client = new TuyaAiClient({
      sleep: async () => {},
      fetch: async () => {
        calls++;
        return response();
      },
    });
    await assert.rejects(client.list(key), (e) => e instanceof Error && !e.message.includes(key));
    assert.ok(calls >= 1 && calls <= 3);
    if (calls > 1) assert.equal(calls, 3);
  }
});

test('network timeout is bounded and list results must contain unique exact device IDs', async () => {
  const client = new TuyaAiClient({
    timeoutMs: 10,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) =>
        init!.signal!.addEventListener('abort', () => reject(new Error(key))),
      ),
  });
  const timer = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(client.list(key), /Tuya.ai/);
  } finally {
    clearTimeout(timer);
  }
  const listed = new TuyaAiClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: {
            devices: [
              { device_id: 'heater-fixture', name: 'one' },
              { device_id: 'heater-fixture', name: 'two' },
            ],
            total: 2,
          },
        }),
      ),
  });
  assert.deepEqual(await listed.list(key), ['heater-fixture']);
});
