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
import { scopedId } from './crypto.js';
import { transaction } from './db.js';

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
          energyKind: z.enum(['cumulative', 'incremental', 'unsupported']),
          temperature: nullableNumber,
          powerW: nullableNumber,
        }),
      ),
    }),
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
type Row = Record<string, any>;

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
        const counter = device.energyKind === 'cumulative' ? device.counterKwh : null;
        const included =
          counter !== null || ['wk', 'qn', 'rs', 'dr', 'dlq'].includes(device.category);
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
          device.energyKind,
          device.energyCode,
          counter,
          device.temperature,
          device.powerW,
        );
        db.prepare(
          'INSERT INTO readings(device_id,at,counter_kwh,code,online) VALUES(?,?,?,?,?)',
        ).run(id, now, counter, device.energyCode, Number(device.online));
        if (
          last &&
          last.online &&
          device.online &&
          counter !== null &&
          last.counter_kwh !== null &&
          device.energyCode === last.code &&
          now - last.at <= MAX_GAP &&
          counter >= last.counter_kwh
        ) {
          db.prepare('INSERT INTO intervals(device_id,start,end,kwh) VALUES(?,?,?,?)').run(
            id,
            last.at,
            now,
            counter - last.counter_kwh,
          );
        }
      }
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
): EnergyStats {
  let total = 0,
    observed = 0,
    milliseconds = 0;
  const selected = devices.filter((d) => d.included);
  const meter = selected.filter((d) => d.energy_kind === 'cumulative');
  const stmt = db.prepare(`SELECT SUM(kwh * (MIN(end,?) - MAX(start,?)) / (end-start)) AS kwh,
    SUM(MIN(end,?) - MAX(start,?)) AS duration FROM intervals WHERE device_id=? AND end>? AND start<?`);
  for (const device of selected) {
    const row = stmt.get(end, start, end, start, device.id, start, end) as Row;
    if (row.kwh !== null) {
      observed++;
      total += row.kwh;
      milliseconds += row.duration;
    }
  }
  const fresh = meter.filter(
    (d) => d.online && d.present && d.last_seen !== null && now - d.last_seen <= MAX_GAP,
  ).length;
  const coverage = selected.length
    ? Math.min(1, milliseconds / (Math.max(1, end - start) * selected.length))
    : 0;
  return {
    kwh: observed ? Math.round(total * 1e6) / 1e6 : null,
    coverage,
    monitored: selected.length,
    metered: meter.length,
    fresh,
    complete: observed > 0 && coverage >= 0.95 && fresh === selected.length,
  };
}

function history(db: DatabaseSync, devices: Row[], now: number, days: number): HistoryPoint[] {
  const today = localDate(now);
  return Array.from({ length: days }, (_, i) => {
    const day = previousDate(today, days - i - 1);
    const { start, end } = dayBounds(day);
    const stats = usage(db, devices, start, Math.min(now, end), now);
    return { day, kwh: stats.kwh, coverage: stats.coverage };
  });
}

export function accounts(db: DatabaseSync): AccountView[] {
  return (
    db
      .prepare(
        `SELECT a.id,a.label,a.last_sync,a.error,
    (SELECT COUNT(*) FROM homes h WHERE h.account_id=a.id) AS home_count,
    (SELECT COUNT(*) FROM devices d JOIN homes h ON h.id=d.home_id WHERE h.account_id=a.id) AS device_count
    FROM accounts a ORDER BY label`,
      )
      .all() as Row[]
  ).map((a) => ({
    id: a.id,
    label: a.label,
    lastSync: a.last_sync,
    error: a.error,
    homeCount: a.home_count,
    deviceCount: a.device_count,
  }));
}

export function notifications(db: DatabaseSync): NotificationView[] {
  return (
    db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').all() as Row[]
  ).map((n) => ({
    id: n.id,
    homeId: n.home_id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    createdAt: n.created_at,
    status: n.status,
    sentAt: n.sent_at,
    error: n.error,
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
  };
}

function deviceView(db: DatabaseSync, d: Row, now: number): DeviceView {
  return {
    id: d.id,
    homeId: d.home_id,
    name: d.name,
    category: d.category,
    included: Boolean(d.included),
    online: Boolean(d.online),
    present: Boolean(d.present),
    lastSeen: d.last_seen,
    energyKind: d.energy_kind,
    energyCode: d.energy_code,
    counterKwh: d.counter_kwh,
    temperature: d.temperature,
    powerW: d.power_w,
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
  return {
    now,
    timezone: TIMEZONE,
    homes: homes.map((h) => homeView(db, h, now)),
    accounts: accounts(db),
    stats: usage(db, devices, dayBounds(localDate(now)).start, now, now),
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
        history: history(db, [{ ...d, included: 1 }], now, days),
      }
    : null;
}
