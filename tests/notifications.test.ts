import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { ingestSnapshot, dayBounds } from '../server/energy.js';
import { evaluateNotifications, deliverPending } from '../server/notifications.js';
import type { Config } from '../server/config.js';

const now = Date.parse('2026-10-16T10:00:00Z'); // Noon Warsaw.
const config: Config = { origin: 'https://energy.example', password: 'test-password-1234', encryptionKey: Buffer.alloc(32),
  dataDir: '/tmp', python: 'python3', host: '127.0.0.1', port: 3000, pollSeconds: 300,
  resendKey: 'fake-key', emailFrom: 'energy@example.com', emailTo: 'owner@example.com' };
function fixture() {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run('a', 'Account', 'encrypted');
  ingestSnapshot(db, 'a', { homes: [{ id: 'h', name: 'Apartment', devices: [{ id: 'd', name: 'Heater', category: 'wk', online: true,
    energyCode: 'total_forward_energy', counterKwh: 100, energyKind: 'cumulative', temperature: null, powerW: null }] }] }, now);
  const home = (db.prepare('SELECT id FROM homes').get() as any).id;
  const device = (db.prepare('SELECT id FROM devices').get() as any).id;
  const interval = (day: string, kwh: number, end?: number) => {
    const bounds = dayBounds(day);
    db.prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)').run(device, bounds.start, end ?? bounds.end, kwh);
  };
  return { db, home, device, interval };
}

test('daily threshold produces one durable event per home and calendar day with contributors', () => {
  const f = fixture(); f.interval('2026-10-16', 14, now);
  f.db.prepare('UPDATE homes SET daily_limit=13,anomaly_enabled=0').run();
  evaluateNotifications(f.db, now); evaluateNotifications(f.db, now + 1000);
  const events = f.db.prepare("SELECT * FROM notifications WHERE kind='threshold'").all() as any[];
  assert.equal(events.length, 1);
  assert.match(events[0].body, /14[,.]00 kWh/);
  assert.match(events[0].body, /Heater/);
  assert.match(events[0].body, /13[,.]00 kWh/);
  f.db.close();
});

test('anomaly compares the same portion of the previous seven complete days', () => {
  const f = fixture();
  for (let day = 9; day <= 15; day++) f.interval(`2026-10-${String(day).padStart(2,'0')}`, 8); // 4 kWh to noon.
  f.interval('2026-10-16', 8, now);
  evaluateNotifications(f.db, now);
  const events = f.db.prepare("SELECT * FROM notifications WHERE kind='anomaly'").all() as any[];
  assert.equal(events.length, 1);
  assert.match(events[0].body, /4[,.]00 kWh/);
  f.db.close();
});

test('new meter without matching history prevents a false anomaly', () => {
  const f = fixture();
  for (let day = 9; day <= 15; day++) f.interval(`2026-10-${String(day).padStart(2,'0')}`, 8);
  f.interval('2026-10-16', 8, now);
  f.db.prepare(`INSERT INTO devices(id,home_id,remote_id,name,category,included,online,last_seen,energy_kind,energy_code,counter_kwh)
    VALUES('new',?,'new','New heater','wk',1,1,?,'cumulative','total_forward_energy',2)`).run(f.home, now);
  f.db.prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)').run('new', dayBounds('2026-10-16').start, now, 5);
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT * FROM notifications WHERE kind='anomaly'").all().length, 0);
  f.db.close();
});

test('incomplete baseline and insufficient history do not trigger anomaly', () => {
  const f = fixture();
  for (let day = 10; day <= 15; day++) f.interval(`2026-10-${day}`, 8);
  f.interval('2026-10-16', 100, now);
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT * FROM notifications WHERE kind='anomaly'").all().length, 0);
  f.db.close();
});

test('weekly summary exists even with no alerts, has health and comparison, and is deduplicated', () => {
  const f = fixture();
  f.interval('2026-10-16', 14);
  f.interval('2026-10-09', 7);
  const monday = Date.parse('2026-10-19T06:05:00Z');
  evaluateNotifications(f.db, monday); evaluateNotifications(f.db, monday + 1000);
  const rows = f.db.prepare("SELECT * FROM notifications WHERE kind='weekly' AND id LIKE '%2026-10-12%'").all() as any[];
  assert.equal(rows.length, 1);
  assert.match(rows[0].body, /Apartment/);
  assert.match(rows[0].body, /Apartment.*14,00 kWh/);
  assert.match(rows[0].body, /poprzedni tydzień: 7,00 kWh/i);
  assert.match(rows[0].body, /nieaktualne|brak|offline/i);
  f.db.close();
});

test('delivery retries preserve recipient, payload and idempotency key across changed config', async () => {
  const f = fixture(); f.interval('2026-10-16', 14, now);
  f.db.prepare('UPDATE homes SET daily_limit=13,anomaly_enabled=0').run();
  evaluateNotifications(f.db, now);
  f.db.prepare("DELETE FROM notifications WHERE kind='weekly'").run();
  const requests: { body: string; key: string }[] = [];
  const transport: typeof fetch = async (_url, options) => {
    requests.push({ body: options!.body as string, key: (options!.headers as Record<string,string>)['Idempotency-Key'] });
    return requests.length === 1 ? new Response('{}', { status: 500 }) : Response.json({ id: 'mail-id' });
  };
  await deliverPending(f.db, config, now, transport);
  assert.equal((f.db.prepare('SELECT status FROM notifications').get() as any).status, 'retry');
  await deliverPending(f.db, { ...config, emailTo: 'different@example.com' }, now + 600000, transport);
  assert.equal((f.db.prepare('SELECT status FROM notifications').get() as any).status, 'sent');
  assert.deepEqual(requests[0], requests[1]);
  assert.match(requests[0].body, /owner@example.com/);
  assert.match(requests[0].body, /https:\/\/energy.example/);
  await deliverPending(f.db, config, now + 1200000, transport);
  assert.equal(requests.length, 2);
  f.db.close();
});

test('uncertain attempts older than 24 hours are not retried and disabled mail makes no requests', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO notifications(id,kind,title,body,created_at,status,first_attempt) VALUES('x','threshold','Test','Test',?,'retry',?)").run(now, now);
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return Response.json({ id: 'mail-id' }); };
  await deliverPending(f.db, { ...config, resendKey: '' }, now + 1000, transport);
  assert.equal(calls, 0);
  await deliverPending(f.db, config, now + 25 * 3600000, transport);
  assert.equal(calls, 0);
  assert.equal((f.db.prepare('SELECT status FROM notifications').get() as any).status, 'uncertain');
  f.db.close();
});
