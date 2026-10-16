import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import {
  accounts,
  dayBounds,
  devicesFor,
  getOverview,
  localDate,
  previousDate,
  TIMEZONE,
  usage,
  MAX_GAP,
} from './energy.js';
import { digest } from './crypto.js';
import { emailConfigured, type Config } from './config.js';

const format = (n: number | null) =>
  n === null ? 'brak danych' : `${n.toFixed(2).replace('.', ',')} kWh`;
const coverage = (n: number) => `${Math.round(n * 100)}%`;
type Row = Record<string, any>;

function enqueue(
  db: DatabaseSync,
  id: string,
  homeId: string | null,
  kind: string,
  title: string,
  body: string,
  now: number,
) {
  db.prepare(
    'INSERT OR IGNORE INTO notifications(id,home_id,kind,title,body,created_at) VALUES(?,?,?,?,?,?)',
  ).run(id, homeId, kind, title, body, now);
}

export function evaluateNotifications(db: DatabaseSync, now: number): void {
  const overview = getOverview(db, now, 1);
  const today = localDate(now),
    start = dayBounds(today).start;
  const local = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(TIMEZONE);
  for (const home of overview.homes) {
    const selected = devicesFor(db, home.id).filter((d) => d.included);
    const contributors = selected
      .map((d) => ({ name: d.name, kwh: usage(db, [d], start, now, now).kwh }))
      .filter((d) => d.kwh !== null)
      .sort((a, b) => b.kwh! - a.kwh!)
      .slice(0, 5)
      .map((d) => `• ${d.name}: ${format(d.kwh)}`)
      .join('\n');
    const details =
      `Mieszkanie: ${home.name}\nDzień: ${today}\nZaobserwowane zużycie: ${format(home.stats.kwh)}\n` +
      `Zakres: ${home.stats.metered}/${home.stats.monitored} urządzeń z licznikiem; pokrycie czasu ${coverage(home.stats.coverage)}.\n` +
      (home.stats.complete ? '' : 'Suma częściowa. Brakujące pomiary nie są zerowym zużyciem.\n') +
      `\nNajwiększy udział w sumie:\n${contributors || 'Brak dostępnych odczytów.'}`;
    if (
      home.rules.dailyLimit !== null &&
      home.stats.kwh !== null &&
      home.stats.kwh >= home.rules.dailyLimit
    ) {
      enqueue(
        db,
        `threshold/${home.id}/${today}`,
        home.id,
        'threshold',
        `Próg energii: ${home.name}`,
        `${details}\n\nPrzekroczony próg dzienny: ${format(home.rules.dailyLimit)}.`,
        now,
      );
    }
    const meters = selected.filter((d) => d.energy_kind === 'cumulative');
    const current = usage(db, meters, start, now, now);
    if (
      !home.rules.anomalyEnabled ||
      !meters.length ||
      now - start < 30 * 60000 ||
      !current.complete ||
      current.kwh === null
    )
      continue;
    const comparable: number[] = [];
    for (let offset = 1; offset <= home.rules.windowDays; offset++) {
      const day = previousDate(today, offset);
      const comparisonEnd = Temporal.PlainDate.from(day).toZonedDateTime({
        timeZone: TIMEZONE,
        plainTime: local.toPlainTime(),
      }).epochMilliseconds;
      const prior = usage(db, meters, dayBounds(day).start, comparisonEnd, now);
      if (prior.coverage >= 0.95 && prior.kwh !== null) comparable.push(prior.kwh);
    }
    if (comparable.length < 7) continue;
    const average = comparable.reduce((sum, value) => sum + value, 0) / comparable.length;
    if (
      current.kwh >= average * (1 + home.rules.increasePercent / 100) &&
      current.kwh - average >= home.rules.increaseKwh
    ) {
      enqueue(
        db,
        `anomaly/${home.id}/${today}`,
        home.id,
        'anomaly',
        `Nietypowe zużycie: ${home.name}`,
        `${details}\n\nŚrednia do tej samej pory: ${format(average)} (${comparable.length} porównywalnych dni).\n` +
          `Warunki: wzrost o co najmniej ${home.rules.increasePercent}% i ${format(home.rules.increaseKwh)}.`,
        now,
      );
    }
  }

  // Catch up on this week's summary after a restart, but never before Monday 08:00.
  if (!overview.accounts.length || (local.dayOfWeek === 1 && local.hour < 8)) return;
  const monday = local.toPlainDate().subtract({ days: local.dayOfWeek - 1 });
  const weekStart = monday.subtract({ days: 7 }).toString(),
    weekEnd = monday.toString();
  const key = `weekly/${weekStart}`;
  if (db.prepare('SELECT id FROM notifications WHERE id=?').get(key)) return;
  const lines = overview.homes.map((home) => {
    const devices = devicesFor(db, home.id);
    const current = usage(db, devices, dayBounds(weekStart).start, dayBounds(weekEnd).start, now);
    const before = usage(
      db,
      devices,
      dayBounds(previousDate(weekStart, 7)).start,
      dayBounds(weekStart).start,
      now,
    );
    return (
      `${home.name} (${home.accountLabel}): ${format(current.kwh)}; pokrycie ${coverage(current.coverage)}.\n` +
      `  Poprzedni tydzień: ${format(before.kwh)}; pokrycie ${coverage(before.coverage)}.`
    );
  });
  const monitored = devicesFor(db).filter((d) => d.included);
  const unsupported = monitored.filter((d) => d.energy_kind !== 'cumulative');
  const stale = monitored.filter(
    (d) => !d.online || !d.present || now - (d.last_seen ?? 0) > MAX_GAP,
  );
  const accountHealth = accounts(db)
    .map(
      (a) =>
        `${a.label}: ${a.error || (a.lastSync && now - a.lastSync <= MAX_GAP ? 'odczyt działa' : 'odczyty nieaktualne')}`,
    )
    .join('\n');
  const body =
    `Podsumowanie okresu ${weekStart} – ${previousDate(weekEnd, 1)} (${TIMEZONE}).\n\n` +
    `${lines.join('\n\n') || 'Brak mieszkań.'}\n\nStan monitorowania:\n${accountHealth}\n` +
    `Bez pomiaru energii: ${unsupported.length}${unsupported.length ? ` (${unsupported.map((d) => d.name).join(', ')})` : ''}.\n` +
    `Offline lub nieaktualne: ${stale.length}${stale.length ? ` (${stale.map((d) => d.name).join(', ')})` : ''}.\n\n` +
    'Niepełne sumy obejmują wyłącznie dostępne pomiary. Podsumowanie wysyłamy również wtedy, gdy nie było alertów.';
  enqueue(db, key, null, 'weekly', `Energia: podsumowanie tygodnia ${weekStart}`, body, now);
}

export async function deliverPending(
  db: DatabaseSync,
  config: Config,
  now: number,
  transport: typeof fetch = fetch,
): Promise<void> {
  if (!emailConfigured(config)) return;
  db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('instance_id',?)").run(randomUUID());
  const instance = (
    db.prepare("SELECT value FROM metadata WHERE key='instance_id'").get() as { value: string }
  ).value;
  const pending = db
    .prepare(
      "SELECT * FROM notifications WHERE status IN ('pending','retry') AND (next_attempt IS NULL OR next_attempt<=?) ORDER BY created_at LIMIT 20",
    )
    .all(now) as Row[];
  for (const event of pending) {
    if (event.first_attempt !== null && now - event.first_attempt >= 23 * 3600000) {
      db.prepare("UPDATE notifications SET status='uncertain',error=? WHERE id=?").run(
        'Okno bezpiecznego ponawiania wygasło. Sprawdź dostarczenie w Resend.',
        event.id,
      );
      continue;
    }
    if (event.first_attempt === null && now - event.created_at >= 24 * 3600000) {
      db.prepare("UPDATE notifications SET status='expired',error=? WHERE id=?").run(
        'Wiadomość jest starsza niż 24 godziny. Pominięto nieaktualną wysyłkę.',
        event.id,
      );
      continue;
    }
    const payload =
      event.payload ??
      JSON.stringify({
        from: config.emailFrom,
        to: [config.emailTo],
        subject: event.title,
        text: `${event.body}\n\nOtwórz panel: ${config.origin}/#${event.home_id ? `home/${event.home_id}` : ''}`,
      });
    db.prepare(
      'UPDATE notifications SET payload=?,first_attempt=COALESCE(first_attempt,?),attempts=attempts+1,next_attempt=? WHERE id=?',
    ).run(payload, now, now + 5 * 60000, event.id);
    try {
      const response = await transport('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.resendKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `tuya-energy/${digest(`${instance}/${event.id}`)}`,
        },
        body: payload,
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const result = (await response.json()) as { id?: string };
        if (!result.id) throw new Error('Missing delivery id');
        db.prepare("UPDATE notifications SET status='sent',sent_at=?,error=NULL WHERE id=?").run(
          now,
          event.id,
        );
      } else if (
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 409, 429].includes(response.status)
      ) {
        db.prepare("UPDATE notifications SET status='failed',error=? WHERE id=?").run(
          `Resend odrzucił wiadomość (HTTP ${response.status}). Sprawdź konfigurację nadawcy i klucza.`,
          event.id,
        );
      } else throw new Error('Transient delivery error');
    } catch {
      db.prepare("UPDATE notifications SET status='retry',error=?,next_attempt=? WHERE id=?").run(
        'Nie potwierdzono wysyłki. Ponowimy ją z tym samym identyfikatorem.',
        now + Math.min(3600000, 300000 * 2 ** Math.min(event.attempts, 4)),
        event.id,
      );
    }
  }
}
