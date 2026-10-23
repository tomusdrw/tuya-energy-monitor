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
  measurementFresh,
} from './energy.js';
import { digest } from './crypto.js';
import { energySource, currentHeatingState } from './estimation.js';
import { hasFreshPower } from './power.js';
import type { EnergyStats, NotificationContent } from '../shared/types.js';
import type { Language } from '../shared/i18n.js';
import { localizeSystemMessage } from '../shared/systemMessages.js';
import { enqueueNotification, emailEnabled } from './notificationEvents.js';
import type { PushKind } from '../shared/push.js';
import { notificationText as t } from './notificationMessages.js';
import { emailConfigured, type Config } from './config.js';

const format = (n: number | null, language: Language) =>
  n === null
    ? t(language, 'no data')
    : `${language === 'pl' ? n.toFixed(2).replace('.', ',') : n.toFixed(2)} kWh`;
const energy = (stats: EnergyStats, language: Language) =>
  `${stats.estimatedKwh !== null || stats.powerKwh !== null ? '≈ ' : ''}${format(stats.kwh, language)}`;
const sources = (stats: EnergyStats, language: Language) =>
  t(language, 'Measured: {measured}; estimated: {estimated}.', {
    measured: format(stats.measuredKwh, language),
    estimated: format(stats.estimatedKwh, language),
  }) +
  (stats.powerKwh !== null
    ? ' ' + t(language, 'From power: {power}.', { power: format(stats.powerKwh, language) })
    : '');
const coverage = (n: number) => `${Math.round(n * 100)}%`;
type Row = Record<string, any>;

function enqueue(
  db: DatabaseSync,
  id: string,
  homeId: string | null,
  kind: PushKind,
  content: (language: Language) => NotificationContent,
  now: number,
) {
  enqueueNotification(db, { id, homeId, kind, content, now });
}

export function evaluateNotifications(db: DatabaseSync, now: number): void {
  const overview = getOverview(db, now, 1);
  const today = localDate(now);
  const local = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(TIMEZONE);
  for (const home of overview.homes) {
    const selected = devicesFor(db, home.id).filter((d) => d.included);
    // The first sample after midnight can still complete the preceding day.
    for (const day of [previousDate(today, 1), today]) {
      const bounds = dayBounds(day);
      const start = bounds.start,
        end = Math.min(bounds.end, now);
      const stats = usage(db, selected, start, end, now);
      const contributors = selected
        .map((d) => ({ name: d.name, stats: usage(db, [d], start, end, now) }))
        .filter((d) => d.stats.kwh !== null)
        .sort((a, b) => b.stats.kwh! - a.stats.kwh!)
        .slice(0, 5);
      const details = (language: Language) =>
        t(language, 'Home: {name}\nDay: {day}\nObserved usage: {energy}\n{sources}\n', {
          name: home.name,
          day,
          energy: energy(stats, language),
          sources: sources(stats, language),
        }) +
        t(
          language,
          'Scope: {metered} with measurements, {estimated} estimated / {monitored} selected devices; time coverage {coverage}.\n',
          {
            metered: stats.metered + stats.powerMetered,
            estimated: stats.estimated,
            monitored: stats.monitored,
            coverage: coverage(stats.coverage),
          },
        ) +
        (stats.complete
          ? ''
          : t(language, 'Partial total. Missing readings do not mean zero usage.\n')) +
        t(language, '\nLargest contributors:\n{contributors}', {
          contributors:
            contributors
              .map(
                (d) => `• ${d.name}: ${energy(d.stats, language)} (${sources(d.stats, language)})`,
              )
              .join('\n') || t(language, 'No readings available.'),
        });
      if (
        home.rules.dailyLimit !== null &&
        stats.kwh !== null &&
        stats.kwh >= home.rules.dailyLimit
      ) {
        enqueue(
          db,
          `threshold/${home.id}/${day}`,
          home.id,
          'threshold',
          (language) => ({
            title: t(language, 'Energy threshold: {name}', { name: home.name }),
            body:
              details(language) +
              t(language, '\n\nDaily threshold exceeded: {limit}.', {
                limit: format(home.rules.dailyLimit, language),
              }),
          }),
          now,
        );
      }
      const meters = selected.filter((d) => energySource(d) !== 'missing');
      const everyMeterCovered = (from: number, to: number) =>
        meters.every(
          (meter) => usage(db, [meter], from, to, now, { comparable: true }).coverage >= 0.95,
        );
      const current = usage(db, meters, start, end, now, { comparable: true });
      if (
        !home.rules.anomalyEnabled ||
        !meters.length ||
        end - start < 30 * 60000 ||
        !current.complete ||
        !everyMeterCovered(start, end) ||
        current.kwh === null
      )
        continue;
      const comparable: number[] = [];
      for (let offset = 1; offset <= home.rules.windowDays; offset++) {
        const priorDay = previousDate(day, offset);
        const priorBounds = dayBounds(priorDay);
        const comparisonEnd =
          day !== today
            ? priorBounds.end
            : Temporal.PlainDate.from(priorDay).toZonedDateTime({
                timeZone: TIMEZONE,
                plainTime: local.toPlainTime(),
              }).epochMilliseconds;
        // Equal wall-clock cutoffs can span different durations across a DST change.
        // Such days are not comparable; do not manufacture a rate-adjusted baseline.
        if (comparisonEnd - priorBounds.start !== end - start) continue;
        const prior = usage(db, meters, priorBounds.start, comparisonEnd, now, {
          comparable: true,
        });
        if (prior.kwh !== null && everyMeterCovered(priorBounds.start, comparisonEnd))
          comparable.push(prior.kwh);
      }
      if (comparable.length < 7) continue;
      const average = comparable.reduce((sum, value) => sum + value, 0) / comparable.length;
      if (
        current.kwh >= average * (1 + home.rules.increasePercent / 100) &&
        current.kwh - average >= home.rules.increaseKwh
      ) {
        enqueue(
          db,
          `anomaly/${home.id}/${day}`,
          home.id,
          'anomaly',
          (language) => ({
            title: t(language, 'Unusual usage: {name}', { name: home.name }),
            body:
              details(language) +
              t(
                language,
                '\n\nComparable usage (current configuration): {current}.\nAverage by the same time: {average} ({days} comparable days).\n',
                {
                  current: energy(current, language),
                  average: `${current.estimatedKwh !== null || current.powerKwh !== null ? '≈ ' : ''}${format(average, language)}`,
                  days: comparable.length,
                },
              ) +
              t(language, 'Conditions: an increase of at least {percent}% and {increase}.', {
                percent: String(home.rules.increasePercent).replace(
                  '.',
                  language === 'pl' ? ',' : '.',
                ),
                increase: format(home.rules.increaseKwh, language),
              }),
          }),
          now,
        );
      }
    }
  }

  // Catch up on this week's summary after a restart, but never before Monday 08:00.
  if (!overview.accounts.length || (local.dayOfWeek === 1 && local.hour < 8)) return;
  const monday = local.toPlainDate().subtract({ days: local.dayOfWeek - 1 });
  const weekStart = monday.subtract({ days: 7 }).toString(),
    weekEnd = monday.toString();
  const key = `weekly/${weekStart}`;
  if (db.prepare('SELECT id FROM notifications WHERE id=?').get(key)) return;
  const homes = overview.homes.map((home) => {
    const devices = devicesFor(db, home.id);
    return {
      home,
      current: usage(db, devices, dayBounds(weekStart).start, dayBounds(weekEnd).start, now),
      before: usage(
        db,
        devices,
        dayBounds(previousDate(weekStart, 7)).start,
        dayBounds(weekStart).start,
        now,
      ),
    };
  });
  const monitored = devicesFor(db).filter((d) => d.included);
  const unsupported = monitored.filter((d) => energySource(d) === 'missing');
  const unknown = monitored.filter(
    (d) => energySource(d) === 'estimated' && currentHeatingState(db, d, now) === 'unknown',
  );
  const stale = monitored.filter((d) =>
    energySource(d) === 'measured'
      ? !measurementFresh(d, now)
      : energySource(d) === 'power'
        ? !hasFreshPower(d, now)
        : !d.online || !d.present || now - (d.last_seen ?? 0) > MAX_GAP,
  );
  const health = accounts(db, now);
  enqueue(
    db,
    key,
    null,
    'weekly',
    (language) => {
      const lines = homes.map(
        ({ home, current, before }) =>
          t(language, '{name} ({account}): {energy}; coverage {coverage}. {sources}\n', {
            name: home.name,
            account: home.accountLabel,
            energy: energy(current, language),
            coverage: coverage(current.coverage),
            sources: sources(current, language),
          }) +
          t(language, '  Previous week: {energy}; coverage {coverage}. {sources}', {
            energy: energy(before, language),
            coverage: coverage(before.coverage),
            sources: sources(before, language),
          }),
      );
      const accountHealth = health
        .map(
          (account) =>
            `${account.label}: ${account.error ? localizeSystemMessage(account.error, language) : t(language, account.lastSync && now - account.lastSync <= MAX_GAP ? 'readings working' : 'readings stale')}` +
            (account.tuyaAi.configured
              ? `; Tuya.ai: ${account.tuyaAi.error ? localizeSystemMessage(account.tuyaAi.error, language) : t(language, account.tuyaAi.healthy ? 'readings working' : 'readings stale')}`
              : ''),
        )
        .join('\n');
      const deviceNames = (devices: Row[]) =>
        devices.length ? ` (${devices.map((device) => device.name).join(', ')})` : '';
      return {
        title: t(language, 'Energy: weekly summary {start}', { start: weekStart }),
        body:
          t(language, 'Summary for {start} – {end} ({timezone}).\n\n', {
            start: weekStart,
            end: previousDate(weekEnd, 1),
            timezone: TIMEZONE,
          }) +
          t(language, '{homes}\n\nMonitoring status:\n{accounts}\n', {
            homes: lines.join('\n\n') || t(language, 'No homes.'),
            accounts: accountHealth,
          }) +
          t(language, 'Without measurements or estimation configuration: {count}{names}.\n', {
            count: unsupported.length,
            names: deviceNames(unsupported),
          }) +
          t(language, 'Estimation without a current heating signal: {count}{names}.\n', {
            count: unknown.length,
            names: deviceNames(unknown),
          }) +
          t(language, 'Offline or stale: {count}{names}.\n\n', {
            count: stale.length,
            names: deviceNames(stale),
          }) +
          t(
            language,
            '≈ marks totals containing consumption calculated from sampled power or heating power × observed heating time. Incomplete totals include only available data. We send summaries even when there were no alerts.',
          ),
      };
    },
    now,
  );
}

export async function deliverPending(
  db: DatabaseSync,
  config: Config,
  now: number,
  transport: typeof fetch = fetch,
): Promise<void> {
  if (!emailConfigured(config) || !emailEnabled(db)) return;
  db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('instance_id',?)").run(randomUUID());
  const instance = (
    db.prepare("SELECT value FROM metadata WHERE key='instance_id'").get() as { value: string }
  ).value;
  const pending = db
    .prepare(
      "SELECT * FROM notifications WHERE status IN ('pending','retry') AND (next_attempt IS NULL OR next_attempt<=?) ORDER BY created_at LIMIT 20",
    )
    .all(now) as Row[];
  for (const queued of pending) {
    if (!emailEnabled(db)) break;
    // A preceding network await may have allowed the owner to cancel this batch.
    const event = db
      .prepare("SELECT * FROM notifications WHERE id=? AND status IN ('pending','retry')")
      .get(queued.id) as Row | undefined;
    if (!event) continue;
    if (event.first_attempt !== null && now - event.first_attempt >= 23 * 3600000) {
      db.prepare("UPDATE notifications SET status='uncertain',error=? WHERE id=?").run(
        'The safe retry window expired. Check delivery in Resend.',
        event.id,
      );
      continue;
    }
    if (event.first_attempt === null && now - event.created_at >= 24 * 3600000) {
      db.prepare("UPDATE notifications SET status='expired',error=? WHERE id=?").run(
        'The message is older than 24 hours. Outdated delivery was skipped.',
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
        text: `${event.body}\n\nOpen dashboard: ${config.origin}/#${event.home_id ? `home/${event.home_id}` : ''}`,
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
        db.prepare(
          "UPDATE notifications SET status='failed',error=? WHERE id=? AND status IN ('pending','retry')",
        ).run(
          `Resend rejected the message (HTTP ${response.status}). Check the sender and API key configuration.`,
          event.id,
        );
      } else throw new Error('Transient delivery error');
    } catch {
      db.prepare(
        "UPDATE notifications SET status='retry',error=?,next_attempt=? WHERE id=? AND status IN ('pending','retry')",
      ).run(
        'Delivery was not confirmed. We will retry with the same identifier.',
        now + Math.min(3600000, 300000 * 2 ** Math.min(event.attempts, 4)),
        event.id,
      );
    }
  }
}
