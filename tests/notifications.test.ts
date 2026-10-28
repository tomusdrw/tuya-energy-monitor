import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { ingestSnapshot, dayBounds, accounts, notifications } from '../server/energy.js';
import { evaluateNotifications, deliverPending } from '../server/notifications.js';
import type { Config } from '../server/config.js';
import { localizeNotification } from '../shared/notificationMessages.js';
import { localizeSystemMessage } from '../shared/systemMessages.js';
import { ingestEnergyReport } from '../server/incremental.js';

const now = Date.parse('2026-10-16T10:00:00Z'); // Noon Warsaw.
const config: Config = {
  origin: 'https://energy.example',
  password: 'test-password-1234',
  encryptionKey: Buffer.alloc(32),
  dataDir: '/tmp',
  python: 'python3',
  host: '127.0.0.1',
  port: 3000,
  pollSeconds: 300,
  statusPollSeconds: 60,
  resendKey: 'fake-key',
  emailFrom: 'energy@example.com',
  emailTo: 'owner@example.com',
};
function fixture() {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO accounts(id,label,secret) VALUES(?,?,?)').run(
    'a',
    'Account',
    'encrypted',
  );
  ingestSnapshot(
    db,
    'a',
    {
      homes: [
        {
          id: 'h',
          name: 'Apartment',
          devices: [
            {
              id: 'd',
              name: 'Heater',
              category: 'wk',
              online: true,
              energyCode: 'total_forward_energy',
              counterKwh: 100,
              energyKind: 'cumulative',
              temperature: null,
              powerW: null,
            },
          ],
        },
      ],
    },
    now,
  );
  const home = (db.prepare('SELECT id FROM homes').get() as any).id;
  const device = (db.prepare('SELECT id FROM devices').get() as any).id;
  const interval = (day: string, kwh: number, end?: number) => {
    const bounds = dayBounds(day);
    db.prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)').run(
      device,
      bounds.start,
      end ?? bounds.end,
      kwh,
    );
  };
  return { db, home, device, interval };
}

test('daily threshold produces one durable event per home and calendar day with contributors', () => {
  const f = fixture();
  f.interval('2026-10-16', 14, now);
  f.db.prepare('UPDATE homes SET daily_limit=13,anomaly_enabled=0').run();
  evaluateNotifications(f.db, now);
  evaluateNotifications(f.db, now + 1000);
  const events = f.db.prepare("SELECT * FROM notifications WHERE kind='threshold'").all() as any[];
  assert.equal(events.length, 1);
  assert.match(events[0].body, /14[,.]00 kWh/);
  assert.match(events[0].body, /Heater/);
  assert.match(events[0].body, /13[,.]00 kWh/);
  f.db.close();
});

test('a reading after midnight can complete yesterday and trigger its daily threshold once', () => {
  const f = fixture();
  const beforeMidnight = Date.parse('2026-10-16T21:59:00Z');
  const afterMidnight = Date.parse('2026-10-16T22:04:00Z');
  f.interval('2026-10-16', 9.5, beforeMidnight);
  f.db.prepare('UPDATE homes SET daily_limit=10,anomaly_enabled=0').run();
  evaluateNotifications(f.db, beforeMidnight);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='threshold'").all().length, 0);
  // The five-minute delta contributes 0.6 kWh to yesterday and 2.4 kWh to today.
  f.db
    .prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)')
    .run(f.device, beforeMidnight, afterMidnight, 3);
  evaluateNotifications(f.db, afterMidnight);
  evaluateNotifications(f.db, afterMidnight + 300000);
  const events = f.db.prepare("SELECT * FROM notifications WHERE kind='threshold'").all() as any[];
  assert.equal(events.length, 1);
  assert.equal(events[0].id, `threshold/${f.home}/2026-10-16`);
  assert.match(events[0].body, /10\.10 kWh/);
  assert.match(events[0].body, /Day: 2026-10-16/);
  f.db.close();
});

test('constant power across the repeated DST hour does not cause an anomaly', () => {
  const f = fixture();
  const repeatedTwoAm = Date.parse('2026-10-25T01:00:00Z');
  f.db.prepare('UPDATE devices SET last_seen=?').run(repeatedTwoAm);
  for (let day = 11; day <= 24; day++) f.interval(`2026-10-${day}`, 72); // 3 kW all day.
  f.interval('2026-10-25', 9, repeatedTwoAm); // Three elapsed hours since Warsaw midnight.
  evaluateNotifications(f.db, repeatedTwoAm);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='anomaly'").all().length, 0);
  f.db.close();
});

test('the shortened spring DST day cannot lower the baseline and manufacture an anomaly', () => {
  const f = fixture();
  const afterSpringChange = Date.parse('2026-03-30T02:00:00Z'); // 04:00 Warsaw.
  f.db.prepare('UPDATE devices SET last_seen=?').run(afterSpringChange);
  f.db.prepare('UPDATE homes SET increase_percent=1,increase_kwh=0.1').run();
  for (let day = 16; day <= 29; day++) {
    const date = `2026-03-${day}`;
    const bounds = dayBounds(date);
    f.interval(date, ((bounds.end - bounds.start) / 3600000) * 3);
  }
  f.interval('2026-03-30', 12, afterSpringChange);
  evaluateNotifications(f.db, afterSpringChange);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='anomaly'").all().length, 0);
  f.db.close();
});

test('anomaly compares the same portion of the previous seven complete days', () => {
  const f = fixture();
  for (let day = 9; day <= 15; day++) f.interval(`2026-10-${String(day).padStart(2, '0')}`, 8); // 4 kWh to noon.
  f.interval('2026-10-16', 8, now);
  evaluateNotifications(f.db, now);
  const events = f.db.prepare("SELECT * FROM notifications WHERE kind='anomaly'").all() as any[];
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Unusual usage: Apartment');
  assert.match(events[0].body, /Average by the same time: 4\.00 kWh \(7 comparable days\)/);
  const polish = localizeNotification(
    notifications(f.db).find((event) => event.kind === 'anomaly')!,
    'pl',
  );
  assert.equal(polish.title, 'Nietypowe zużycie: Apartment');
  assert.match(polish.body, /Średnia do tej samej pory: 4,00 kWh \(7 porównywalnych dni\)/);
  f.db.close();
});

test('new meter without matching history prevents a false anomaly', () => {
  const f = fixture();
  for (let day = 9; day <= 15; day++) f.interval(`2026-10-${String(day).padStart(2, '0')}`, 8);
  f.interval('2026-10-16', 8, now);
  f.db
    .prepare(
      `INSERT INTO devices(id,home_id,remote_id,name,category,included,online,last_seen,energy_kind,energy_code,counter_kwh)
    VALUES('new',?,'new','New heater','wk',1,1,?,'cumulative','total_forward_energy',2)`,
    )
    .run(f.home, now);
  f.db
    .prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)')
    .run('new', dayBounds('2026-10-16').start, now, 5);
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT * FROM notifications WHERE kind='anomaly'").all().length, 0);
  f.db.close();
});

test('every meter needs history even when one missing meter is only 5% of the apartment', () => {
  const f = fixture();
  f.db.prepare('DELETE FROM readings').run();
  f.db.prepare('DELETE FROM devices').run();
  for (let meter = 0; meter < 20; meter++) {
    const id = `meter-${meter}`;
    f.db
      .prepare(
        `INSERT INTO devices(id,home_id,remote_id,name,category,included,online,last_seen,energy_kind)
      VALUES(?,?,?,?,'wk',1,1,?,'cumulative')`,
      )
      .run(id, f.home, id, id, now);
    f.db
      .prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)')
      .run(id, dayBounds('2026-10-16').start, now, meter === 19 ? 60 : 1.2);
    if (meter === 19) continue; // Newly installed, fully observed today but with no baseline.
    for (let day = 9; day <= 15; day++) {
      const bounds = dayBounds(`2026-10-${String(day).padStart(2, '0')}`);
      f.db
        .prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)')
        .run(id, bounds.start, bounds.end, 2.4);
    }
  }
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='anomaly'").all().length, 0);
  // Adequate baseline is also insufficient when today's missing data is hidden in the average.
  for (let day = 9; day <= 15; day++) {
    const bounds = dayBounds(`2026-10-${String(day).padStart(2, '0')}`);
    f.db
      .prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)')
      .run('meter-19', bounds.start, bounds.end, 2.4);
  }
  f.db
    .prepare('UPDATE intervals SET start=? WHERE device_id=? AND end=?')
    .run(now - 300000, 'meter-19', now);
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='anomaly'").all().length, 0);
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
  evaluateNotifications(f.db, monday);
  evaluateNotifications(f.db, monday + 1000);
  const rows = f.db
    .prepare("SELECT * FROM notifications WHERE kind='weekly' AND id LIKE '%2026-10-12%'")
    .all() as any[];
  assert.equal(rows.length, 1);
  assert.match(rows[0].body, /Apartment/);
  assert.match(rows[0].body, /Apartment.*14\.00 kWh/);
  assert.match(rows[0].body, /previous week: 7\.00 kWh/i);
  assert.match(rows[0].body, /stale|missing|offline/i);
  const polish = localizeNotification(
    notifications(f.db).find((event) => event.id === 'weekly/2026-10-12')!,
    'pl',
  );
  assert.equal(polish.title, 'Energia: podsumowanie tygodnia 2026-10-12');
  assert.match(polish.body, /Poprzedni tydzień: 7,00 kWh/);
  assert.match(polish.body, /Account: odczyty nieaktualne/);
  f.db.close();
});

test('delivery retries preserve recipient, payload and idempotency key across changed config', async () => {
  const f = fixture();
  f.interval('2026-10-16', 14, now);
  f.db.prepare('UPDATE homes SET daily_limit=13,anomaly_enabled=0').run();
  evaluateNotifications(f.db, now);
  f.db.prepare("DELETE FROM notifications WHERE kind='weekly'").run();
  const requests: { body: string; key: string }[] = [];
  const transport: typeof fetch = async (_url, options) => {
    requests.push({
      body: options!.body as string,
      key: (options!.headers as Record<string, string>)['Idempotency-Key'],
    });
    return requests.length === 1
      ? new Response('{}', { status: 500 })
      : Response.json({ id: 'mail-id' });
  };
  await deliverPending(f.db, config, now, transport);
  assert.equal((f.db.prepare('SELECT status FROM notifications').get() as any).status, 'retry');
  await deliverPending(
    f.db,
    { ...config, emailTo: 'different@example.com' },
    now + 600000,
    transport,
  );
  assert.equal((f.db.prepare('SELECT status FROM notifications').get() as any).status, 'sent');
  assert.deepEqual(requests[0], requests[1]);
  const mail = JSON.parse(requests[0].body);
  assert.equal(mail.subject, 'Energy threshold: Apartment');
  assert.match(mail.text, /Observed usage: 14\.00 kWh/);
  assert.match(mail.text, /Open dashboard: https:\/\/energy.example/);
  assert.match(requests[0].body, /owner@example.com/);
  assert.match(requests[0].body, /https:\/\/energy.example/);
  await deliverPending(f.db, config, now + 1200000, transport);
  assert.equal(requests.length, 2);
  f.db.close();
});

test('uncertain attempts older than 24 hours are not retried and disabled mail makes no requests', async () => {
  const f = fixture();
  f.db
    .prepare(
      "INSERT INTO notifications(id,kind,title,body,created_at,status,first_attempt) VALUES('x','threshold','Test','Test',?,'retry',?)",
    )
    .run(now, now);
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return Response.json({ id: 'mail-id' });
  };
  await deliverPending(f.db, { ...config, resendKey: '' }, now + 1000, transport);
  assert.equal(calls, 0);
  await deliverPending(f.db, config, now + 25 * 3600000, transport);
  assert.equal(calls, 0);
  assert.equal((f.db.prepare('SELECT status FROM notifications').get() as any).status, 'uncertain');
  f.db.close();
});

test('thresholds and weekly summaries label estimated contributions and split mixed-source totals', () => {
  const f = fixture();
  f.interval('2026-10-16', 10, now - 60000);
  f.db
    .prepare(
      'INSERT INTO intervals(device_id,start,end,kwh,source,on_ms,config_revision) VALUES(?,?,?,?,?,?,?)',
    )
    .run(f.device, now - 60000, now, 4, 'estimated', 60000, 1);
  f.db.prepare('UPDATE homes SET daily_limit=13,anomaly_enabled=0').run();
  evaluateNotifications(f.db, now);
  const alert = f.db.prepare("SELECT body FROM notifications WHERE kind='threshold'").get() as any;
  assert.match(alert.body, /≈ 14\.00 kWh/);
  assert.match(alert.body, /measured: 10\.00 kWh/i);
  assert.match(alert.body, /estimated: 4\.00 kWh/i);
  assert.match(alert.body, /Heater: ≈ 14\.00 kWh/);
  evaluateNotifications(f.db, Date.parse('2026-10-19T06:05Z'));
  const weekly = f.db
    .prepare("SELECT body FROM notifications WHERE id='weekly/2026-10-12'")
    .get() as any;
  assert.match(weekly.body, /≈ 14\.00 kWh/);
  assert.match(weekly.body, /estimated: 4\.00 kWh/i);
  f.db.close();
});

test('runtime anomalies require history from the same source and configuration, including today', async () => {
  const { configureEstimation, recordHeatingState } = await import('../server/estimation.js');
  const f = fixture();
  f.db.prepare("UPDATE devices SET energy_kind='unsupported',status_updated_at=?").run(now - 60000);
  configureEstimation(
    f.db,
    f.device,
    {
      enabled: true,
      ratedPowerKw: 2,
      heatingCode: 'work_state',
      onValues: ['heat'],
      offValues: ['idle'],
    },
    now - 10 * 86400000,
  );
  recordHeatingState(f.db, f.device, [{ code: 'work_state', value: 'heat' }], true, now);
  for (let day = 9; day <= 15; day++) f.interval(`2026-10-${String(day).padStart(2, '0')}`, 8);
  f.interval('2026-10-16', 8, now);
  f.db.exec("UPDATE intervals SET source='estimated',config_revision=1,on_ms=end-start");
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='anomaly'").all().length, 1);
  f.db.exec("DELETE FROM notifications WHERE kind='anomaly'");
  f.db.prepare('UPDATE intervals SET config_revision=0 WHERE end<?').run(now);
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='anomaly'").all().length, 0);
  f.db.exec("UPDATE intervals SET config_revision=1,source='measured'");
  f.db.prepare("UPDATE intervals SET source='estimated' WHERE end=?").run(now);
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='anomaly'").all().length, 0);
  f.db.exec("UPDATE intervals SET source='estimated'");
  f.db.prepare('UPDATE intervals SET config_revision=0 WHERE end=?').run(now);
  evaluateNotifications(f.db, now);
  assert.equal(f.db.prepare("SELECT id FROM notifications WHERE kind='anomaly'").all().length, 0);
  f.db.close();
});

test('new notifications expose English mail content and Polish display content without translating user names', () => {
  const f = fixture();
  try {
    f.interval('2026-10-16', 14.25, now);
    f.db
      .prepare('UPDATE homes SET name=?,daily_limit=13,anomaly_enabled=0')
      .run('Mieszkanie: Home');
    f.db.prepare('UPDATE devices SET name=?').run('Pomiar: Heater');
    evaluateNotifications(f.db, now);
    const alert = notifications(f.db).find((event) => event.kind === 'threshold')!;
    assert.equal(alert.title, 'Energy threshold: Mieszkanie: Home');
    assert.match(alert.body, /Observed usage: 14\.25 kWh/);
    assert.match(
      alert.body,
      /• Pomiar: Heater: 14\.25 kWh \(Measured: 14\.25 kWh; estimated: no data\.\)/,
    );
    assert.equal(alert.translations?.pl.title, 'Próg energii: Mieszkanie: Home');
    assert.match(alert.translations!.pl.body, /Zaobserwowane zużycie: 14,25 kWh/);
    assert.match(alert.translations!.pl.body, /• Pomiar: Heater: 14,25 kWh/);
    assert.equal(localizeNotification(alert, 'pl').title, 'Próg energii: Mieszkanie: Home');
    assert.equal(localizeNotification(alert, 'en').title, 'Energy threshold: Mieszkanie: Home');
    const original = { ...alert.translations!.pl };
    f.db.prepare('UPDATE homes SET name=?').run('renamed');
    evaluateNotifications(f.db, now + 1000);
    assert.deepEqual(
      notifications(f.db).find((event) => event.kind === 'threshold')!.translations?.pl,
      original,
    );
  } finally {
    f.db.close();
  }
});

test('known persisted Polish errors are canonicalized for API and English weekly mail without rewriting stored history', () => {
  const f = fixture();
  try {
    const legacy =
      'Nie udało się odczytać konta. Ponów synchronizację; jeśli problem trwa, połącz konto ponownie.';
    f.db.prepare('UPDATE accounts SET error=?').run(legacy);
    assert.equal(
      accounts(f.db, now)[0].error,
      'Could not read the account. Sync again; if the problem persists, reconnect the account.',
    );
    evaluateNotifications(f.db, now);
    const weekly = notifications(f.db).find((event) => event.kind === 'weekly')!;
    assert.match(weekly.body, /Account: Could not read the account\./);
    assert.match(weekly.translations!.pl.body, /Account: Nie udało się odczytać konta\./);
    assert.equal((f.db.prepare('SELECT error FROM accounts').get() as any).error, legacy);
    f.db.prepare('UPDATE accounts SET error=?').run('Custom error: nieznany');
    assert.equal(accounts(f.db, now)[0].error, 'Custom error: nieznany');
  } finally {
    f.db.close();
  }
});

test('legacy attempted payloads remain byte-for-byte unchanged while retry status is English', async () => {
  const f = fixture();
  try {
    const payload =
      '{"from":"old@example.com","to":["old-to@example.com"],"subject":"Próg energii: Stare","text":"Otwórz panel: https://old.example"}';
    f.db
      .prepare(
        "INSERT INTO notifications(id,kind,title,body,created_at,status,first_attempt,payload) VALUES('legacy','threshold','Próg energii: Stare','Stara treść',?,'retry',?,?)",
      )
      .run(now, now, payload);
    let delivered: string | undefined;
    await deliverPending(f.db, config, now, async (_url, options) => {
      delivered = options!.body as string;
      return new Response('{}', { status: 500 });
    });
    assert.equal(delivered, payload);
    const legacy = notifications(f.db).find((event) => event.id === 'legacy')!;
    assert.equal(legacy.title, 'Próg energii: Stare');
    assert.equal(legacy.body, 'Stara treść');
    assert.equal(legacy.translations, undefined);
    assert.deepEqual(localizeNotification(legacy, 'en'), {
      title: 'Próg energii: Stare',
      body: 'Stara treść',
    });
    assert.deepEqual(localizeNotification(legacy, 'pl'), {
      title: 'Próg energii: Stare',
      body: 'Stara treść',
    });
    assert.equal(
      legacy.error,
      'Delivery was not confirmed. We will retry with the same identifier.',
    );
  } finally {
    f.db.close();
  }
});

test('system error localization recognizes exact legacy and parameterized errors and preserves unknown content', () => {
  for (const source of [
    'Resend rejected the message (HTTP 403). Check the sender and API key configuration.',
    'Resend odrzucił wiadomość (HTTP 403). Sprawdź konfigurację nadawcy i klucza.',
  ]) {
    assert.equal(
      localizeSystemMessage(source, 'en'),
      'Resend rejected the message (HTTP 403). Check the sender and API key configuration.',
    );
    assert.equal(
      localizeSystemMessage(source, 'pl'),
      'Resend odrzucił wiadomość (HTTP 403). Sprawdź konfigurację nadawcy i klucza.',
    );
  }
  assert.equal(localizeSystemMessage('Incorrect password.', 'pl'), 'Nieprawidłowe hasło.');
  assert.equal(localizeSystemMessage('Nieprawidłowe hasło.', 'en'), 'Incorrect password.');
  assert.equal(
    localizeSystemMessage('User message: Nieprawidłowe hasło.', 'en'),
    'User message: Nieprawidłowe hasło.',
  );
  assert.equal(localizeSystemMessage('Unknown provider error', 'pl'), 'Unknown provider error');
});

test('evaluating an existing historical alert does not attach a translation from newer readings', () => {
  const f = fixture();
  try {
    f.interval('2026-10-16', 14, now);
    f.db.prepare('UPDATE homes SET daily_limit=13,anomaly_enabled=0').run();
    const id = `threshold/${f.home}/2026-10-16`;
    f.db
      .prepare(
        'INSERT INTO notifications(id,home_id,kind,title,body,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(id, f.home, 'threshold', 'Historyczny tytuł', 'Historyczna treść', now - 1000);
    evaluateNotifications(f.db, now);
    const historical = notifications(f.db).find((event) => event.id === id)!;
    assert.equal(historical.title, 'Historyczny tytuł');
    assert.equal(historical.body, 'Historyczna treść');
    assert.equal(historical.translations, undefined);
    assert.equal((f.db.prepare('PRAGMA user_version').get() as any).user_version, 10);
  } finally {
    f.db.close();
  }
});

test('incremental reports produce measured English alerts and Polish display text without inventing coverage', () => {
  const f = fixture();
  try {
    const start = dayBounds('2026-10-16').start;
    f.db
      .prepare(
        "UPDATE devices SET energy_kind='incremental',energy_code='add_ele',counter_kwh=NULL,incremental_since=?",
      )
      .run(start);
    f.db.prepare('UPDATE homes SET daily_limit=1,anomaly_enabled=0').run();
    ingestEnergyReport(
      f.db,
      'a',
      { deviceId: 'd', code: 'add_ele', at: now - 1000, kwh: 1.25 },
      now,
    );
    evaluateNotifications(f.db, now);
    const alert = notifications(f.db).find((event) => event.kind === 'threshold')!;
    assert.match(alert.body, /Observed usage: 1\.25 kWh/);
    assert.match(
      alert.body,
      /Scope: 1 with measurements, 0 estimated \/ 1 selected devices; time coverage 0%/,
    );
    assert.match(alert.body, /Partial total\. Missing readings do not mean zero usage\./);
    const polish = localizeNotification(alert, 'pl');
    assert.match(polish.body, /Zaobserwowane zużycie: 1,25 kWh/);
    assert.match(
      polish.body,
      /Zakres: 1 z pomiarem, 0 estymowanych \/ 1 wybranych urządzeń; pokrycie czasu 0%/,
    );
    assert.match(polish.body, /Suma częściowa\./);
    const weekly = notifications(f.db).find((event) => event.kind === 'weekly')!;
    assert.match(weekly.body, /Without measurements or estimation configuration: 0\./);
    assert.match(
      localizeNotification(weekly, 'pl').body,
      /Bez pomiaru lub konfiguracji estymacji: 0\./,
    );
  } finally {
    f.db.close();
  }
});
