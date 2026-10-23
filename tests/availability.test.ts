import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushFixture } from './helpers/push.js';
import { ingestSnapshot } from '../server/energy.js';
import { evaluateAvailability } from '../server/availability.js';

const minute = 60000;
function fixture() {
  const f = pushFixture();
  f.receiver('phone', [
    'readings_lost',
    'readings_restored',
    'account_problem',
    'account_restored',
  ]);
  f.db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
  ingestSnapshot(
    f.db,
    'a',
    {
      homes: [
        {
          id: 'h',
          name: 'Home',
          devices: ['one', 'two'].map((id) => ({
            id,
            name: id,
            category: 'wk',
            online: true,
            energyKind: 'cumulative' as const,
            energyCode: 'total_forward_energy',
            counterKwh: 10,
            temperature: null,
            powerW: null,
          })),
        },
      ],
    },
    f.now,
  );
  const tick = (
    offset: number,
    online: string[] = [],
    brokenAccount = false,
    startedAt = f.now,
  ) => {
    const at = f.now + offset * minute;
    f.db
      .prepare('UPDATE accounts SET last_sync=?,error=?')
      .run(at, brokenAccount ? 'Cloud read failed' : null);
    f.db.exec('UPDATE devices SET online=0,measurement_online=0');
    for (const id of online)
      f.db
        .prepare(
          'UPDATE devices SET online=1,measurement_online=1,last_seen=?,measurement_at=? WHERE remote_id=?',
        )
        .run(at, at, id);
    evaluateAvailability(f.db, at, startedAt);
  };
  const events = (kind: string) =>
    f.db.prepare('SELECT * FROM notifications WHERE kind=?').all(kind) as any[];
  tick(0, ['one', 'two']);
  return { ...f, tick, events };
}

test('availability waits 15 minutes, groups device losses and records recovery after five healthy minutes', () => {
  const f = fixture();
  try {
    f.tick(1);
    f.tick(15);
    assert.equal(f.events('readings_lost').length, 0);
    f.tick(16);
    f.tick(17);
    assert.equal(f.events('readings_lost').length, 1);
    assert.match(f.events('readings_lost')[0].body, /one/);
    assert.match(f.events('readings_lost')[0].body, /two/);
    f.tick(18, ['one', 'two']);
    f.tick(22, ['one', 'two']);
    assert.equal(f.events('readings_restored').length, 0);
    f.tick(23, ['one', 'two']);
    assert.equal(f.events('readings_restored').length, 1);
    assert.equal(
      f.db.prepare("SELECT status FROM push_deliveries WHERE kind='readings_lost'").get()?.status,
      'cancelled',
    );
  } finally {
    f.db.close();
  }
});

test('account problems suppress device cascades and restart does not repeat episodes or infer recovery', () => {
  const f = fixture();
  try {
    f.tick(1, [], true);
    f.tick(16, [], true);
    f.tick(30, [], true, f.now + 20 * minute);
    assert.equal(f.events('account_problem').length, 1);
    assert.equal(f.events('readings_lost').length, 0);
    f.tick(31, ['one', 'two']);
    f.tick(36, ['one', 'two'], false, f.now + 35 * minute);
    assert.equal(f.events('account_restored').length, 0);
    f.tick(41, ['one', 'two'], false, f.now + 35 * minute);
    assert.equal(f.events('account_restored').length, 1);
    assert.equal(f.events('readings_restored').length, 0);
  } finally {
    f.db.close();
  }
});

test('partial group recovery retains timestamped loss; configuration changes reset without fabricated recovery', () => {
  const f = fixture();
  try {
    f.tick(1);
    f.tick(16);
    f.tick(17, ['one']);
    f.tick(22, ['one']);
    assert.equal(
      f.db.prepare("SELECT status FROM push_deliveries WHERE kind='readings_lost'").get()?.status,
      'pending',
    );
    f.db.exec("UPDATE devices SET included=0 WHERE remote_id='two'");
    f.tick(23, ['one']);
    assert.equal(f.events('readings_restored').length, 1);
    assert.equal(
      f.db.prepare("SELECT status FROM push_deliveries WHERE kind='readings_lost'").get()?.status,
      'cancelled',
    );
  } finally {
    f.db.close();
  }
});

test('unknown devices do not alert and incremental silence is healthy while heartbeats are fresh', () => {
  const f = fixture();
  try {
    f.db.exec(
      "DELETE FROM availability_state WHERE subject LIKE 'device/%'; DELETE FROM readings; UPDATE devices SET counter_kwh=NULL,measurement_at=NULL",
    );
    f.tick(1);
    f.tick(20);
    assert.equal(f.events('readings_lost').length, 0);
    f.db.exec("UPDATE devices SET energy_kind='incremental',energy_code='add_ele'");
    for (const at of [21, 40, 60]) {
      f.db.prepare('UPDATE devices SET energy_stream_at=?').run(f.now + at * minute);
      f.tick(at, ['one', 'two']);
    }
    assert.equal(f.events('readings_lost').length, 0);
  } finally {
    f.db.close();
  }
});

test('Tuya.ai device errors do not masquerade as connection failure and idle lanes do not alert', () => {
  const f = fixture();
  try {
    f.db.exec(
      "UPDATE accounts SET ai_secret='configured',ai_error='One device offline',ai_connectivity_active=1,ai_connectivity_ok=1; UPDATE devices SET measurement_provider='tuya_ai'",
    );
    f.db.prepare('UPDATE accounts SET ai_connectivity_at=?').run(f.now);
    f.tick(0, ['one', 'two']);
    for (const t of [1, 16]) {
      f.db.prepare('UPDATE accounts SET ai_connectivity_at=?').run(f.now + t * minute);
      f.tick(t);
    }
    assert.equal(f.events('account_problem').length, 0);
    assert.equal(f.events('readings_lost').length, 1);
    f.db.exec(
      'UPDATE accounts SET ai_connectivity_active=0,ai_connectivity_ok=NULL,ai_connectivity_at=NULL',
    );
    f.tick(60);
    f.tick(90);
    assert.equal(f.events('account_problem').length, 0);
  } finally {
    f.db.close();
  }
});

test('initially failing AI configuration and QR reconnection start a new connection grace period', () => {
  const f = fixture();
  try {
    // The inactive AI lane already has persisted state; no successful list call follows setup.
    f.db.exec(
      "UPDATE accounts SET ai_secret='configured',ai_revision=1,ai_connectivity_active=1,ai_connectivity_ok=0",
    );
    f.db.prepare('UPDATE accounts SET ai_connectivity_at=?').run(f.now + minute);
    f.db.exec("INSERT INTO metadata(key,value) VALUES('connection-revision/a','reconnected')");
    f.tick(1, [], true);
    f.tick(15, [], true);
    assert.equal(f.events('account_problem').length, 0);
    f.tick(16, [], true);
    f.tick(40, [], true);
    assert.equal(f.events('account_problem').length, 2);
    assert.equal(f.events('account_restored').length, 0);
    assert.equal(f.events('readings_lost').length, 0);
  } finally {
    f.db.close();
  }
});

test('changing a device source still requires a healthy baseline for that source', () => {
  const f = fixture();
  try {
    f.tick(1);
    f.db.exec("UPDATE devices SET energy_code='new_total'");
    f.tick(10);
    f.tick(30);
    assert.equal(f.events('readings_lost').length, 0);
    f.tick(31, ['one']);
    f.tick(32);
    f.tick(47);
    assert.equal(f.events('readings_lost').length, 1);
    assert.match(f.events('readings_lost')[0].body, /one/);
    assert.doesNotMatch(f.events('readings_lost')[0].body, /two/);
  } finally {
    f.db.close();
  }
});
