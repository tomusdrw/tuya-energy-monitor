import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

// An isolated container, fresh anonymous volume and synthetic credentials only.
const image = process.argv[2] ?? 'tuya-energy-monitor:test';
const container = `tuya-smoke-${randomBytes(5).toString('hex')}`;
const directory = mkdtempSync(path.join(tmpdir(), 'tuya-smoke-'));
const envFile = path.join(directory, 'test.env');
const password = randomBytes(24).toString('hex');
const origin = 'http://localhost:3000';
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim();
writeFileSync(
  envFile,
  `APP_ORIGIN=${origin}\nADMIN_PASSWORD=${password}\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`,
  { mode: 0o600 },
);
try {
  docker('run', '-d', '--name', container, '--env-file', envFile, '-p', '127.0.0.1::3000', image);
  let base = `http://${docker('port', container, '3000/tcp')}`;
  async function ready() {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Container health check timed out');
  }
  await ready();
  assert.equal(docker('exec', container, 'id', '-u'), '1000');
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/api/overview`)).status, 401);
  assert.equal((await fetch(`${base}/%61pi/overview`)).status, 401);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/overview`, { headers: { cookie } })).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/sync`, {
        method: 'POST',
        headers: { cookie, origin: 'https://invalid.example', 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  docker('restart', container);
  base = `http://${docker('port', container, '3000/tcp')}`;
  await ready();
  const persisted = await fetch(`${base}/api/overview`, { headers: { cookie } });
  assert.equal(
    persisted.status,
    200,
    'Owner session should persist across restart with the same password/key',
  );
  assert.equal((await persisted.json()).stats.kwh, null);
  console.log(
    'Container smoke passed: non-root user, frontend, health, authentication, origin protection, persistence.',
  );
} finally {
  try {
    docker('rm', '-f', '-v', container);
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
