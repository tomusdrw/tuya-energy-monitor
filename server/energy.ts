import type { DatabaseSync } from 'node:sqlite';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import type {
  AccountView,
  DeviceDetail,
  DeviceView,
  EnergyStats,
  HistoryPoint,
  HomeDetail,
  HomeView,
  NotificationView,
  Overview,
} from '../shared/types.js';
import { localizeSystemMessage } from '../shared/systemMessages.js';
import { scopedId } from './crypto.js';
import { transaction } from './db.js';
import { STREAM_FRESHNESS } from './incremental.js';
import { powerFieldSchema, recordPower, hasFreshPower } from './power.js';
import { climateReading, currentClimate, climateForPeriod } from './climate.js';
import {
  recordHeatingState,
  statusFieldsSchema,
  temperatureMetadataSchema,
  energySource,
  estimationView,
  currentHeatingState,
  MAX_HEATING_GAP,
} from './estimation.js';

export const TIMEZONE = 'Europe/Warsaw';
export const MAX_GAP = 15 * 60000;
const nullableNumber = z.number().finite().nullable();
export const snapshotSchema = z.object({
  homes: z.array(
    z.object({
      id: z.string().min(1).max(256),
      name: z.string().max(256),
      devices: z.array(
        z.object({
          id: z.string().min(1).max(256),
          name: z.string().max(256),
          category: z.string().max(100),
          online: z.boolean(),
          energyCode: z.string().max(100).nullable(),
          counterKwh: z.number().finite().nonnegative().nullable(),
          energyKind: z.enum(['cumulative', 'incremental', 'power', 'unsupported']),
          temperature: nullableNumber,
          humidity: z.number().finite().min(0).max(100).nullable().default(null),
          powerW: nullableNumber,
          powerField: powerFieldSchema.nullable().default(null),
          statusFields: statusFieldsSchema.default([]),
          temperatureMetadata: temperatureMetadataSchema.optional(),
        }),
      ),
    }),
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
type Row = Record<string, any>;

/** Same continuity rules for both cumulative sources; provenance is part of the baseline. */
function recordCounter(
  db: DatabaseSync,
  id: string,
  now: number,
  counter: number | null,
  code: string | null,
  online: boolean,
  provider = 'qr',
  series = '',
) {
  const last = db
    .prepare('SELECT * FROM readings WHERE device_id=? ORDER BY at DESC LIMIT 1')
    .get(id) as Row | undefined;
  if (last && (last.at > now || (last.at === now && last.provider === provider))) return;
  db.prepare(
    'INSERT OR REPLACE INTO readings(device_id,at,counter_kwh,code,online,provider,series) VALUES(?,?,?,?,?,?,?)',
  ).run(id, now, counter, code, Number(online), provider, series);
  if (
    last &&
    now > last.at &&
    last.online &&
    online &&
    counter !== null &&
    last.counter_kwh !== null &&
    last.code === code &&
    last.provider === provider &&
    last.series === series &&
    now - last.at <= MAX_GAP &&
    counter >= last.counter_kwh &&
    !db
      .prepare('SELECT 1 FROM intervals WHERE device_id=? AND start<? AND end>? LIMIT 1')
      .get(id, now, last.at)
  ) {
    db.prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)').run(
      id,
      last.at,
      now,
      Math.round((counter - last.counter_kwh) * 1e9) / 1e9,
    );
  }
}

export function ingestAiReading(
  db: DatabaseSync,
  accountId: string,
  remoteId: string,
  reading: { code: string; counterKwh: number; online: boolean; series: string },
  revision: number,
  now: number,
): boolean {
  return transaction(db, () => {
    const d = db
      .prepare(
        `SELECT d.* FROM devices d JOIN homes h ON h.id=d.home_id JOIN accounts a ON a.id=h.account_id
      WHERE d.id=? AND h.account_id=? AND a.ai_secret IS NOT NULL AND a.ai_revision=?
      AND d.qr_energy_kind='unsupported' AND d.present=1`,
      )
      .get(scopedId(accountId, remoteId), accountId, revision) as Row | undefined;
    if (!d || !Number.isFinite(reading.counterKwh) || reading.counterKwh < 0) return false;
    const last = db
      .prepare('SELECT at,provider FROM readings WHERE device_id=? ORDER BY at DESC LIMIT 1')
      .get(d.id) as Row | undefined;
    if (last && (last.at > now || (last.at === now && last.provider === 'tuya_ai'))) return false;
    db.prepare(
      `UPDATE devices SET energy_kind='cumulative',energy_code=?,counter_kwh=?,
      measurement_provider='tuya_ai',measurement_at=?,measurement_online=?,measurement_error=NULL WHERE id=?`,
    ).run(reading.code, reading.counterKwh, now, Number(reading.online), d.id);
    recordCounter(
      db,
      d.id,
      now,
      reading.counterKwh,
      reading.code,
      reading.online,
      'tuya_ai',
      `${revision}:${reading.series}`,
    );
    return true;
  });
}

export function failAiReading(db: DatabaseSync, id: string, error: string, now: number): void {
  const d = db
    .prepare("SELECT id FROM devices WHERE id=? AND measurement_provider='tuya_ai'")
    .get(id);
  if (!d) return;
  transaction(db, () => {
    db.prepare('UPDATE devices SET measurement_error=? WHERE id=?').run(error, id);
    recordCounter(db, id, now, null, null, false, 'tuya_ai');
  });
}

export function measurementFresh(d: Row, now: number): boolean {
  return Boolean(
    d.present &&
    !d.measurement_error &&
    d.measurement_online &&
    d.measurement_at !== null &&
    now - d.measurement_at <= MAX_GAP,
  );
}

export function localDate(at: number): string {
  return Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(TIMEZONE)
    .toPlainDate()
    .toString();
}
export function dayBounds(day: string): { start: number; end: number } {
  const date = Temporal.PlainDate.from(day);
  return {
    start: date.toZonedDateTime(TIMEZONE).epochMilliseconds,
    end: date.add({ days: 1 }).toZonedDateTime(TIMEZONE).epochMilliseconds,
  };
}
export function previousDate(day: string, days: number): string {
  return Temporal.PlainDate.from(day).subtract({ days }).toString();
}

export function ingestSnapshot(
  db: DatabaseSync,
  accountId: string,
  input: unknown,
  now: number,
): void {
  const snapshot = snapshotSchema.parse(input);
  transaction(db, () => {
    db.prepare('UPDATE homes SET present=0 WHERE account_id=?').run(accountId);
    db.prepare(
      'UPDATE devices SET present=0 WHERE home_id IN (SELECT id FROM homes WHERE account_id=?)',
    ).run(accountId);
    for (const home of snapshot.homes) {
      const homeId = scopedId(accountId, home.id);
      db.prepare(
        `INSERT INTO homes(id,account_id,remote_id,name) VALUES(?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,present=1`,
      ).run(homeId, accountId, home.id, home.name);
      for (const device of home.devices) {
        const id = scopedId(accountId, device.id);
        const last = db
          .prepare('SELECT * FROM readings WHERE device_id=? ORDER BY at DESC LIMIT 1')
          .get(id) as Row | undefined;
        if (last && now <= last.at) {
          db.prepare('UPDATE devices SET present=1 WHERE id=?').run(id);
          continue;
        }
        const previousDevice = db.prepare('SELECT * FROM devices WHERE id=?').get(id) as
          Row | undefined;
        if (previousDevice?.status_updated_at >= now) {
          db.prepare('UPDATE devices SET present=1 WHERE id=?').run(id);
          continue;
        }
        const counter = device.energyKind === 'cumulative' ? device.counterKwh : null;
        const keepAi =
          previousDevice?.measurement_provider === 'tuya_ai' && device.energyKind === 'unsupported';
        const included =
          device.energyKind === 'power' ||
          device.energyKind === 'incremental' ||
          counter !== null ||
          ['wk', 'qn', 'rs', 'dr', 'dlq'].includes(device.category);
        db.prepare(
          `INSERT INTO devices(id,home_id,remote_id,name,category,included,online,last_seen,
          energy_kind,energy_code,counter_kwh,temperature,power_w) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET home_id=excluded.home_id,name=excluded.name,category=excluded.category,
          online=excluded.online,present=1,last_seen=excluded.last_seen,energy_kind=excluded.energy_kind,
          energy_code=excluded.energy_code,counter_kwh=excluded.counter_kwh,temperature=excluded.temperature,power_w=excluded.power_w`,
        ).run(
          id,
          homeId,
          device.id,
          device.name,
          device.category,
          Number(included),
          Number(device.online),
          now,
          keepAi ? previousDevice.energy_kind : device.energyKind,
          keepAi ? previousDevice.energy_code : device.energyCode,
          keepAi ? previousDevice.counter_kwh : counter,
          device.temperature,
          device.powerW,
        );
        const temperature = device.online ? device.temperature : null;
        const humidity = device.online ? device.humidity : null;
        db.prepare('UPDATE devices SET temperature=?,humidity=?,climate_at=? WHERE id=?').run(
          temperature,
          humidity,
          now,
          id,
        );
        if (temperature !== null || humidity !== null)
          db.prepare(
            `INSERT OR IGNORE INTO climate_observations(device_id,home_id,at,temperature,humidity)
            VALUES(?,?,?,?,?)`,
          ).run(id, homeId, now, temperature, humidity);
        db.prepare('UPDATE devices SET qr_energy_kind=?,qr_energy_code=? WHERE id=?').run(
          device.energyKind,
          device.energyCode,
          id,
        );
        if (!keepAi)
          db.prepare(
            `UPDATE devices SET measurement_provider='qr',measurement_at=?,measurement_online=?,measurement_error=NULL WHERE id=?`,
          ).run(
            counter !== null || device.energyKind === 'incremental' ? now : null,
            Number(device.online),
            id,
          );
        db.prepare('UPDATE devices SET power_field=? WHERE id=?').run(
          device.powerField ? JSON.stringify(device.powerField) : null,
          id,
        );
        if (
          device.energyKind === 'incremental' &&
          (previousDevice?.energy_kind !== 'incremental' ||
            previousDevice?.energy_code !== device.energyCode ||
            previousDevice?.incremental_since == null)
        )
          db.prepare('UPDATE devices SET incremental_since=?,energy_stream_at=NULL WHERE id=?').run(
            now,
            id,
          );
        if (!keepAi) recordCounter(db, id, now, counter, device.energyCode, device.online);
        recordPower(db, id, device.statusFields, device.online, now);
        recordHeatingState(
          db,
          id,
          device.statusFields,
          device.online,
          now,
          device.temperatureMetadata,
        );
      }
    }
    // A disappeared device is a known gap, even if it returns before MAX_GAP.
    // Keep last_seen unchanged: it records the last actual device observation.
    db.prepare(
      `INSERT INTO readings(device_id,at,counter_kwh,code,online)
      SELECT d.id,?,NULL,NULL,0 FROM devices d JOIN homes h ON h.id=d.home_id
      WHERE h.account_id=? AND d.present=0
      AND NOT EXISTS (SELECT 1 FROM readings r WHERE r.device_id=d.id AND r.at>=?)`,
    ).run(now, accountId, now);
    const absent = db
      .prepare(
        'SELECT d.id FROM devices d JOIN homes h ON h.id=d.home_id WHERE h.account_id=? AND d.present=0',
      )
      .all(accountId) as Row[];
    for (const d of absent) {
      recordPower(db, d.id, [], false, now);
      recordHeatingState(db, d.id, [], false, now);
    }
    db.prepare('UPDATE accounts SET last_sync=?,error=NULL WHERE id=?').run(now, accountId);
  });
}

export function devicesFor(db: DatabaseSync, homeId?: string): Row[] {
  return db
    .prepare(
      `SELECT * FROM devices ${homeId ? 'WHERE home_id=?' : ''} ORDER BY name COLLATE NOCASE`,
    )
    .all(...(homeId ? [homeId] : [])) as Row[];
}

export function usage(
  db: DatabaseSync,
  devices: Row[],
  start: number,
  end: number,
  now: number,
  options: { comparable?: boolean } = {},
): EnergyStats {
  let measured = 0,
    power = 0,
    estimated = 0,
    onMs = 0,
    milliseconds = 0;
  let measuredCount = 0,
    powerCount = 0,
    estimatedCount = 0,
    fresh = 0,
    covered = 0;
  const selected = devices.filter((d) => d.included);
  const stmt = db.prepare(`SELECT source,
    SUM(kwh * (MIN(end,?) - MAX(start,?)) / (end-start)) AS kwh,
    SUM(on_ms * (MIN(end,?) - MAX(start,?)) / (end-start)) AS on_ms,
    SUM(MIN(end,?) - MAX(start,?)) AS duration
    FROM intervals WHERE device_id=? AND end>? AND start<?
    AND (?=0 OR (source=? AND (source!='estimated' OR config_revision=?))) GROUP BY source`);
  for (const d of selected) {
    const source = energySource(d);
    if (!options.comparable || source === 'measured') {
      const reports = db
        .prepare(
          `SELECT COUNT(*) AS count,SUM(kwh) AS kwh FROM energy_reports
        WHERE device_id=? AND at>=? AND at<?`,
        )
        .get(d.id, start, end) as Row;
      if (reports.count) {
        measured += reports.kwh;
        measuredCount++;
      }
    }
    const rows = stmt.all(
      end,
      start,
      end,
      start,
      end,
      start,
      d.id,
      start,
      end,
      Number(Boolean(options.comparable)),
      source,
      d.estimate_revision,
    ) as Row[];
    let duration = 0;
    for (const r of rows) {
      if (r.source === 'estimated') {
        estimated += r.kwh;
        onMs += r.on_ms;
        estimatedCount++;
      } else if (r.source === 'power') {
        power += r.kwh;
        powerCount++;
      } else {
        measured += r.kwh;
        measuredCount++;
      }
      duration += r.duration;
    }
    milliseconds += duration;
    if (duration / Math.max(1, end - start) >= 0.95) covered++;
    const recent =
      source === 'measured'
        ? measurementFresh(d, now)
        : d.online &&
          d.present &&
          d.last_seen !== null &&
          now - d.last_seen <= (source === 'estimated' ? MAX_HEATING_GAP : MAX_GAP);
    if (
      recent &&
      ((source === 'measured' &&
        (d.energy_kind !== 'incremental' ||
          (d.energy_stream_at !== null && now - d.energy_stream_at <= STREAM_FRESHNESS))) ||
        (source === 'power' && hasFreshPower(d, now)) ||
        (source === 'estimated' && currentHeatingState(db, d, now) !== 'unknown'))
    )
      fresh++;
  }
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return {
    kwh: measuredCount + powerCount + estimatedCount ? round(measured + power + estimated) : null,
    measuredKwh: measuredCount ? round(measured) : null,
    powerKwh: powerCount ? round(power) : null,
    estimatedKwh: estimatedCount ? round(estimated) : null,
    heatingHours: estimatedCount ? round(onMs / 3600000) : null,
    coverage: selected.length
      ? Math.min(1, milliseconds / (Math.max(1, end - start) * selected.length))
      : 0,
    monitored: selected.length,
    metered: selected.filter((d) => energySource(d) === 'measured').length,
    powerMetered: selected.filter((d) => energySource(d) === 'power').length,
    estimated: selected.filter((d) => energySource(d) === 'estimated').length,
    fresh,
    complete: selected.length > 0 && covered === selected.length && fresh === selected.length,
  };
}

function history(db: DatabaseSync, devices: Row[], now: number, days: number): HistoryPoint[] {
  const today = localDate(now);
  return Array.from({ length: days }, (_, i) => {
    const day = previousDate(today, days - i - 1);
    const { start, end } = dayBounds(day);
    const stats = usage(db, devices, start, Math.min(now, end), now);
    return {
      day,
      kwh: stats.kwh,
      measuredKwh: stats.measuredKwh,
      powerKwh: stats.powerKwh,
      estimatedKwh: stats.estimatedKwh,
      heatingHours: stats.heatingHours,
      coverage: stats.coverage,
    };
  });
}

export function accounts(db: DatabaseSync, now = Date.now()): AccountView[] {
  return (
    db
      .prepare(
        `SELECT a.id,a.label,a.last_sync,a.error,a.ai_secret IS NOT NULL AS ai_configured,
    a.ai_region,a.ai_last_success,a.ai_error,
    (SELECT COUNT(*) FROM devices d JOIN homes h ON h.id=d.home_id WHERE h.account_id=a.id AND d.measurement_provider='tuya_ai' AND d.present=1) AS ai_metered,
    (SELECT COUNT(*) FROM homes h WHERE h.account_id=a.id) AS home_count,
    (SELECT COUNT(*) FROM devices d JOIN homes h ON h.id=d.home_id WHERE h.account_id=a.id) AS device_count
    FROM accounts a ORDER BY label`,
      )
      .all() as Row[]
  ).map((a) => ({
    id: a.id,
    label: a.label,
    lastSync: a.last_sync,
    error: a.error ? localizeSystemMessage(a.error, 'en') : null,
    healthy: !a.error && a.last_sync !== null && now - a.last_sync <= MAX_GAP,
    homeCount: a.home_count,
    deviceCount: a.device_count,
    tuyaAi: {
      configured: Boolean(a.ai_configured),
      region: a.ai_region,
      lastSuccess: a.ai_last_success,
      error: a.ai_error,
      healthy: Boolean(
        a.ai_configured &&
        !a.ai_error &&
        a.ai_last_success !== null &&
        now - a.ai_last_success <= MAX_GAP,
      ),
      meteredDevices: a.ai_metered,
    },
  }));
}

export function notifications(db: DatabaseSync): NotificationView[] {
  const delivery = new Map(
    (
      db
        .prepare(
          `SELECT event_id,
    SUM(status='submitted') AS submitted,SUM(status IN ('pending','retry')) AS pending,
    SUM(status IN ('failed','expired')) AS failed,SUM(status='cancelled') AS cancelled
    FROM push_deliveries GROUP BY event_id`,
        )
        .all() as Row[]
    ).map((r) => [
      r.event_id,
      { submitted: r.submitted, pending: r.pending, failed: r.failed, cancelled: r.cancelled },
    ]),
  );
  return (
    db
      .prepare(
        "SELECT n.*, m.value AS translation FROM notifications n LEFT JOIN metadata m ON m.key='notification-pl/' || n.id ORDER BY n.created_at DESC LIMIT 100",
      )
      .all() as Row[]
  ).map((n) => ({
    id: n.id,
    homeId: n.home_id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    ...(n.translation ? { translations: { pl: JSON.parse(n.translation) } } : {}),
    createdAt: n.created_at,
    status: n.status,
    push: delivery.get(n.id),
    sentAt: n.sent_at,
    error: n.error ? localizeSystemMessage(n.error, 'en') : null,
  }));
}

function homeView(db: DatabaseSync, home: Row, now: number): HomeView {
  const devices = devicesFor(db, home.id);
  return {
    id: home.id,
    name: home.name,
    accountId: home.account_id,
    accountLabel: home.account_label,
    rules: {
      dailyLimit: home.daily_limit,
      anomalyEnabled: Boolean(home.anomaly_enabled),
      windowDays: home.window_days,
      increasePercent: home.increase_percent,
      increaseKwh: home.increase_kwh,
    },
    stats: usage(db, devices, dayBounds(localDate(now)).start, now, now),
    deviceCount: devices.length,
    climate: currentClimate(devices, now),
  };
}

function deviceView(db: DatabaseSync, d: Row, now: number): DeviceView {
  return {
    id: d.id,
    homeId: d.home_id,
    name: d.name,
    category: d.category,
    included: Boolean(d.included),
    ignored: Boolean(d.ignored),
    online: Boolean(d.measurement_provider === 'tuya_ai' ? d.measurement_online : d.online),
    present: Boolean(d.present),
    fresh:
      energySource(d) === 'measured'
        ? measurementFresh(d, now)
        : d.energy_kind === 'power'
          ? hasFreshPower(d, now)
          : Boolean(d.online && d.present && d.last_seen !== null && now - d.last_seen <= MAX_GAP),
    lastSeen: d.last_seen,
    energyKind: d.energy_kind,
    energyCode: d.energy_code,
    reportingConnected:
      d.energy_kind === 'incremental' &&
      d.energy_stream_at !== null &&
      now - d.energy_stream_at <= STREAM_FRESHNESS,
    lastEnergyReport: (
      db.prepare('SELECT MAX(at) AS at FROM energy_reports WHERE device_id=?').get(d.id) as Row
    ).at,
    counterKwh: d.counter_kwh,
    measurementProvider: energySource(d) === 'measured' ? d.measurement_provider : null,
    measurementAt: d.measurement_at,
    measurementError: d.measurement_error,
    ...climateReading(d, now),
    powerW: d.power_field ? (hasFreshPower(d, now) ? d.power_w : null) : d.power_w,
    energySource: energySource(d),
    heatingState: energySource(d) === 'estimated' ? currentHeatingState(db, d, now) : 'unknown',
    stats: usage(db, [{ ...d, included: 1 }], dayBounds(localDate(now)).start, now, now),
  };
}

export function getOverview(db: DatabaseSync, now: number, days = 14): Overview {
  const homes = db
    .prepare(
      'SELECT h.*,a.label account_label FROM homes h JOIN accounts a ON a.id=h.account_id ORDER BY h.name',
    )
    .all() as Row[];
  const devices = devicesFor(db);
  const accountViews = accounts(db, now);
  const stats = usage(db, devices, dayBounds(localDate(now)).start, now, now);
  stats.complete = stats.complete && accountViews.every((account) => account.healthy);
  return {
    now,
    timezone: TIMEZONE,
    homes: homes.map((h) => homeView(db, h, now)),
    accounts: accountViews,
    stats,
    history: history(db, devices, now, days),
    alerts: notifications(db),
  };
}
export function getHome(db: DatabaseSync, id: string, now: number, days = 14): HomeDetail | null {
  const home = db
    .prepare(
      'SELECT h.*,a.label account_label FROM homes h JOIN accounts a ON a.id=h.account_id WHERE h.id=?',
    )
    .get(id) as Row | undefined;
  if (!home) return null;
  const devices = devicesFor(db, id);
  return {
    ...homeView(db, home, now),
    devices: devices.map((d) => deviceView(db, d, now)),
    history: history(db, devices, now, days),
    climateHistory: Array.from({ length: days }, (_, i) => {
      const day = previousDate(localDate(now), days - i - 1);
      const { start, end } = dayBounds(day);
      return { day, ...climateForPeriod(db, id, start, Math.min(end, now + 1)) };
    }),
  };
}
export function getDevice(
  db: DatabaseSync,
  id: string,
  now: number,
  days = 14,
): DeviceDetail | null {
  const d = db
    .prepare(
      'SELECT d.*,h.name home_name FROM devices d JOIN homes h ON h.id=d.home_id WHERE d.id=?',
    )
    .get(id) as Row | undefined;
  return d
    ? {
        ...deviceView(db, d, now),
        homeName: d.home_name,
        estimation: estimationView(db, d, now),
        history: history(db, [{ ...d, included: 1 }], now, days),
      }
    : null;
}
