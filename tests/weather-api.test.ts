import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { ingestSnapshot } from '../server/energy.js';
import { scopedId } from '../server/crypto.js';
import type { Config } from '../server/config.js';

const config: Config = {
  origin: 'http://localhost:3000',
  password: 'test-password-1234',
  encryptionKey: Buffer.alloc(32, 4),
  dataDir: '/tmp',
  python: 'python3',
  port: 3000,
  host: '127.0.0.1',
  pollSeconds: 300,
  statusPollSeconds: 60,
  resendKey: '',
  emailFrom: '',
  emailTo: '',
};
const location = { label: 'Warszawa, Marszałkowska 1', latitude: 52.22, longitude: 21.01 };

test('locations require authentication, validate coordinates, survive sync and stay scoped to a home', async () => {
  const db = openDatabase(':memory:');
  db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
  const snapshot = {
    homes: [
      { id: 'h', name: 'Home', devices: [] },
      { id: 'b', name: 'Other', devices: [] },
    ],
  };
  ingestSnapshot(db, 'a', snapshot, Date.now());
  const app = await createApp(config, { db, background: false });
  const id = scopedId('a', 'h'),
    other = scopedId('a', 'b');
  try {
    assert.equal((await app.inject(`/api/homes/${id}/weather`)).statusCode, 401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin },
      payload: { password: config.password },
    });
    const headers = {
      cookie: String(login.headers['set-cookie']).split(';')[0],
      origin: config.origin,
    };
    const put = (payload: unknown, home = id) =>
      app.inject({
        method: 'PUT',
        url: `/api/homes/${home}/location`,
        headers,
        payload: { location: payload },
      });
    assert.equal((await put(location)).statusCode, 200);
    assert.equal((await put({ ...location, latitude: 91 })).statusCode, 400);
    assert.equal((await put(location, 'missing')).statusCode, 404);
    ingestSnapshot(db, 'a', snapshot, Date.now());
    assert.deepEqual(
      (await app.inject({ url: `/api/homes/${id}`, headers })).json().location,
      location,
    );
    assert.equal((await app.inject({ url: `/api/homes/${other}`, headers })).json().location, null);
    assert.equal((await put(null)).statusCode, 200);
    assert.deepEqual((await app.inject({ url: `/api/homes/${id}/weather`, headers })).json(), {
      location: null,
      points: [],
      updatedAt: null,
    });
  } finally {
    await app.close();
  }
});

test('weather failures are isolated from apartment readings and search validates query/auth', async () => {
  const { WeatherService } = await import('../server/weather.js');
  const db = openDatabase(':memory:');
  db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
  ingestSnapshot(db, 'a', { homes: [{ id: 'h', name: 'Home', devices: [] }] }, Date.now());
  const weather = new WeatherService(async () => {
    throw new Error('provider secret');
  });
  const app = await createApp(config, { db, background: false, weather });
  const id = scopedId('a', 'h');
  try {
    assert.equal((await app.inject('/api/locations/search?q=Warsaw')).statusCode, 401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin },
      payload: { password: config.password },
    });
    const headers = {
      cookie: String(login.headers['set-cookie']).split(';')[0],
      origin: config.origin,
    };
    const wrongOrigin = await app.inject({
      method: 'PUT',
      url: `/api/homes/${id}/location`,
      headers: { ...headers, origin: 'https://evil.example' },
      payload: { location },
    });
    assert.equal(wrongOrigin.statusCode, 403);
    await app.inject({
      method: 'PUT',
      url: `/api/homes/${id}/location`,
      headers,
      payload: { location },
    });
    const failed = await app.inject({ url: `/api/homes/${id}/weather`, headers });
    assert.equal(failed.statusCode, 503);
    assert.ok(!failed.body.includes('provider secret'));
    assert.equal((await app.inject({ url: `/api/homes/${id}`, headers })).statusCode, 200);
    assert.equal(
      (await app.inject({ url: `/api/homes/${id}/weather?days=1000`, headers })).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: '/api/locations/search?q=ab', headers })).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: '/api/locations/search?q=Warsaw', headers })).statusCode,
      503,
    );
  } finally {
    await app.close();
  }
});

test('v10 migration preserves homes and persisted locations survive reopening', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'weather-migration-'));
  const path = join(dir, 'db.sqlite');
  let db = openDatabase(path);
  try {
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
    ingestSnapshot(db, 'a', { homes: [{ id: 'h', name: 'Home', devices: [] }] }, Date.now());
    db.exec('DROP TABLE home_locations; PRAGMA user_version=10');
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 11);
    assert.equal(db.prepare('SELECT name FROM homes').get()?.name, 'Home');
    db.prepare('INSERT INTO home_locations VALUES(?,?,?,?)').run(
      scopedId('a', 'h'),
      location.label,
      location.latitude,
      location.longitude,
    );
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare('SELECT label FROM home_locations').get()?.label, location.label);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
