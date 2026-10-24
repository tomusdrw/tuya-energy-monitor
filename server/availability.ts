import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { digest } from './crypto.js';
import { MAX_GAP, measurementFresh } from './energy.js';
import { currentHeatingState, energySource } from './estimation.js';
import { hasFreshPower } from './power.js';
import { STREAM_FRESHNESS } from './incremental.js';
import { enqueueNotification, type NotificationEvent } from './notificationEvents.js';

type Row = Record<string, any>;
interface Condition {
  seen: boolean;
  lost: boolean;
  unavailable: boolean;
  lossSince: number | null;
  recoverySince: number | null;
  episode: string | null;
  boot: number;
}
interface Change {
  subject: string;
  episode: string;
  direction: 'lost' | 'restored';
}
const LOSS_GRACE = 15 * 60000,
  RECOVERY_GRACE = 5 * 60000;

function observe(
  db: DatabaseSync,
  input: {
    subject: string;
    fingerprint: string;
    eligible: boolean;
    healthy: boolean;
    historical: boolean;
    requiresHealthyBaseline?: boolean;
    observation: number | null;
    suppressed?: boolean;
  },
  now: number,
  boot: number,
): { state: Condition; change: Change | null } {
  const prior = db
    .prepare('SELECT * FROM availability_state WHERE subject=?')
    .get(input.subject) as Row | undefined;
  const fresh = !prior || prior.fingerprint !== input.fingerprint;
  const state: Condition = fresh
    ? {
        seen: input.eligible && (input.healthy || (!prior && input.historical)),
        lost: false,
        unavailable: !input.healthy,
        lossSince: null,
        recoverySince: null,
        episode: null,
        boot,
      }
    : JSON.parse(prior.value);
  let change: Change | null = null;
  if (state.boot !== boot) {
    state.boot = boot;
    state.recoverySince = null;
  }
  state.unavailable = !input.healthy;
  if (!input.eligible) {
    state.seen = false;
    state.lost = false;
    state.episode = null;
    state.lossSince = null;
    state.recoverySince = null;
  } else {
    // A configured connection must report persistent setup failures, even before its first success.
    // Device source changes still need a known healthy observation before detecting a loss.
    if (input.healthy || input.requiresHealthyBaseline === false) state.seen = true;
    if (state.lost) {
      if (input.healthy && input.observation !== null && input.observation >= boot) {
        state.recoverySince ??= now;
        if (now - state.recoverySince >= RECOVERY_GRACE) {
          state.lost = false;
          state.lossSince = null;
          state.recoverySince = null;
          change = { subject: input.subject, episode: state.episode!, direction: 'restored' };
        }
      } else state.recoverySince = null;
    } else if (state.seen && !input.healthy && !input.suppressed) {
      state.lossSince ??= now;
      if (now - state.lossSince >= LOSS_GRACE) {
        state.lost = true;
        state.episode = randomUUID();
        state.recoverySince = null;
        change = { subject: input.subject, episode: state.episode, direction: 'lost' };
      }
    } else state.lossSince = null;
  }
  db.prepare(
    `INSERT INTO availability_state(subject,fingerprint,value) VALUES(?,?,?)
    ON CONFLICT(subject) DO UPDATE SET fingerprint=excluded.fingerprint,value=excluded.value`,
  ).run(input.subject, input.fingerprint, JSON.stringify(state));
  return { state, change };
}

function historicalReading(db: DatabaseSync, d: Row): boolean {
  const source = energySource(d);
  if (source === 'power')
    return Boolean(
      db
        .prepare(
          'SELECT 1 FROM power_observations WHERE device_id=? AND power_w IS NOT NULL AND field=? LIMIT 1',
        )
        .get(d.id, d.power_field),
    );
  if (source === 'estimated')
    return Boolean(
      db
        .prepare(
          'SELECT 1 FROM heating_observations WHERE device_id=? AND heating IS NOT NULL AND online=1 AND config_revision=? LIMIT 1',
        )
        .get(d.id, d.estimate_revision),
    );
  if (d.energy_kind === 'incremental') return d.energy_stream_at !== null;
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM readings WHERE device_id=? AND online=1 AND counter_kwh IS NOT NULL AND provider=? LIMIT 1',
      )
      .get(d.id, d.measurement_provider),
  );
}

function cancelSuperseded(db: DatabaseSync): void {
  const members = db
    .prepare(
      `SELECT DISTINCT c.* FROM notification_conditions c JOIN push_deliveries p ON p.event_id=c.event_id
    WHERE p.status IN ('pending','retry')`,
    )
    .all() as Row[];
  const current = new Map<string, boolean>();
  for (const member of members) {
    const row = db
      .prepare('SELECT value FROM availability_state WHERE subject=?')
      .get(member.subject);
    const state: Condition | null = row ? JSON.parse(String(row.value)) : null;
    const relevant =
      state !== null &&
      state.episode === member.episode &&
      (member.direction === 'lost' ? state.lost : !state.lost && !state.unavailable);
    current.set(member.event_id, Boolean(current.get(member.event_id) || relevant));
  }
  for (const [event, relevant] of current)
    if (!relevant)
      db.prepare(
        "UPDATE push_deliveries SET status='cancelled',error=NULL WHERE event_id=? AND status IN ('pending','retry')",
      ).run(event);
}

/** Called synchronously: state transitions and their outbox entries commit together. */
export function evaluateAvailability(db: DatabaseSync, now: number, startedAt: number): void {
  transaction(db, () => {
    const blocked = new Set<string>();
    const accountRows = db.prepare('SELECT * FROM accounts').all() as Row[];
    const revisions = new Map<string, string>();
    for (const account of accountRows) {
      const revision = String(
        db
          .prepare('SELECT value FROM metadata WHERE key=?')
          .get(`connection-revision/${account.id}`)?.value ?? '0',
      );
      revisions.set(account.id, revision);
      for (const provider of ['qr', 'tuya_ai'] as const) {
        const ai = provider === 'tuya_ai';
        const active = !ai || Boolean(account.ai_secret && account.ai_connectivity_active);
        const observed = ai ? account.ai_connectivity_at : account.last_sync;
        const healthy =
          active &&
          Boolean(ai ? account.ai_connectivity_ok : !account.error) &&
          observed !== null &&
          now - observed <= MAX_GAP;
        const subject = `account/${account.id}/${provider}`;
        const { state, change } = observe(
          db,
          {
            subject,
            fingerprint: String(ai ? `${account.ai_revision}/${active}` : revision),
            eligible: active,
            historical: true,
            requiresHealthyBaseline: false,
            healthy,
            observation: observed,
          },
          now,
          startedAt,
        );
        if (active && (!healthy || state.lost)) blocked.add(`${account.id}/${provider}`);
        if (!change) continue;
        const restored = change.direction === 'restored';
        enqueueNotification(db, {
          id: `availability/${subject}/${change.episode}/${change.direction}`,
          homeId: null,
          kind: restored ? 'account_restored' : 'account_problem',
          now,
          members: [change],
          content: (language) => ({
            title:
              language === 'pl'
                ? `${restored ? 'Połączenie przywrócone' : 'Problem z połączeniem'}: ${account.label}`
                : `${restored ? 'Connection restored' : 'Connection problem'}: ${account.label}`,
            body:
              language === 'pl'
                ? `${ai ? 'Tuya.ai' : 'Tuya Sharing/QR'}: ${restored ? 'połączenie działa ponownie.' : 'nie można potwierdzić połączenia od co najmniej 15 minut. Sprawdź połączone konto.'}\n${new Date(now).toISOString()}`
                : `${ai ? 'Tuya.ai' : 'Tuya Sharing/QR'}: ${restored ? 'the connection is working again.' : 'the connection has been unavailable for at least 15 minutes. Check the connected account.'}\n${new Date(now).toISOString()}`,
          }),
        });
      }
    }
    const groups = new Map<
      string,
      { homeId: string; homeName: string; changes: Change[]; names: string[] }
    >();
    const devices = db
      .prepare(
        'SELECT d.*,h.account_id,h.name AS home_name,a.ai_revision FROM devices d JOIN homes h ON h.id=d.home_id JOIN accounts a ON a.id=h.account_id',
      )
      .all() as Row[];
    for (const d of devices) {
      const source = energySource(d);
      const provider =
        source === 'measured' && d.measurement_provider === 'tuya_ai' ? 'tuya_ai' : 'qr';
      const healthy =
        source === 'measured'
          ? measurementFresh(d, now) &&
            (d.energy_kind !== 'incremental' ||
              (d.energy_stream_at !== null && now - d.energy_stream_at <= STREAM_FRESHNESS))
          : source === 'power'
            ? hasFreshPower(d, now)
            : source === 'estimated' && currentHeatingState(db, d, now) !== 'unknown';
      const observation =
        source === 'measured'
          ? d.measurement_at
          : source === 'power'
            ? d.power_updated_at
            : d.last_seen;
      const eligible = Boolean(d.included && !d.ignored && source !== 'missing');
      const { change } = observe(
        db,
        {
          subject: `device/${d.id}`,
          fingerprint: JSON.stringify([
            eligible,
            d.home_id,
            source,
            d.energy_kind,
            d.energy_code,
            d.estimate_revision,
            d.power_field,
            provider,
            provider === 'tuya_ai' ? d.ai_revision : revisions.get(d.account_id),
          ]),
          eligible,
          healthy,
          observation,
          historical: eligible && historicalReading(db, d),
          suppressed: blocked.has(`${d.account_id}/${provider}`),
        },
        now,
        startedAt,
      );
      if (!change) continue;
      const key = `${d.home_id}/${change.direction}`;
      const group: { homeId: string; homeName: string; changes: Change[]; names: string[] } =
        groups.get(key) ?? {
          homeId: d.home_id,
          homeName: d.home_name,
          changes: [],
          names: [],
        };
      group.changes.push(change);
      group.names.push(d.name);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const restored = group.changes[0].direction === 'restored';
      const event: NotificationEvent = {
        id: `availability/home/${digest(JSON.stringify(group.changes))}`,
        homeId: group.homeId,
        kind: restored ? 'readings_restored' : 'readings_lost',
        now,
        members: group.changes,
        content: (language) => ({
          title:
            language === 'pl'
              ? `${restored ? 'Odczyty przywrócone' : 'Utrata odczytów'}: ${group.homeName}`
              : `${restored ? 'Readings restored' : 'Readings lost'}: ${group.homeName}`,
          body:
            language === 'pl'
              ? `Stan zaobserwowany ${new Date(now).toISOString()}: ${group.names.length} urządzeń.\n${group.names.join(', ')}.\n${restored ? 'Odczyty są ponownie dostępne od 5 minut.' : 'Odczyty są niedostępne od co najmniej 15 minut. Brak danych nie oznacza zerowego zużycia.'}`
              : `Observed at ${new Date(now).toISOString()}: ${group.names.length} devices.\n${group.names.join(', ')}.\n${restored ? 'Readings have been available again for 5 minutes.' : 'Readings have been unavailable for at least 15 minutes. Missing data does not mean zero usage.'}`,
        }),
      };
      enqueueNotification(db, event);
    }
    cancelSuperseded(db);
  });
}
