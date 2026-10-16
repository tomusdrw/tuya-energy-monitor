import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { transaction } from './db.js';
import type { EstimationConfig, EstimationView, StatusField } from '../shared/types.js';

export const MAX_HEATING_GAP = 180000;
const scalar = z.union([z.boolean(), z.number().finite(), z.string().max(100)]);
const code = z.string().regex(/^[A-Za-z0-9_]{1,100}$/);
export const statusFieldsSchema = z
  .array(
    z.object({
      code,
      value: scalar,
      values: z.array(scalar).max(100).optional(),
    }),
  )
  .max(256);
export const estimationSchema = z
  .object({
    enabled: z.boolean(),
    ratedPowerKw: z.number().finite().positive().max(1000).nullable(),
    heatingCode: code.nullable(),
    onValues: z.array(scalar).max(100),
    offValues: z.array(scalar).max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.enabled &&
      (!v.ratedPowerKw || !v.heatingCode || !v.onValues.length || !v.offValues.length)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the power, field, and heating and idle values.',
      });
    if (v.onValues.some((on) => v.offValues.some((off) => off === on)))
      ctx.addIssue({ code: 'custom', message: 'Heating and idle values must not overlap.' });
  });
type Row = Record<string, any>;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function estimationConfig(d: Row): EstimationConfig {
  return {
    enabled: Boolean(d.estimate_enabled),
    ratedPowerKw: d.rated_power_kw,
    heatingCode: d.heating_code,
    onValues: JSON.parse(d.heating_on_values),
    offValues: JSON.parse(d.heating_off_values),
  };
}
export function energySource(d: Row): 'measured' | 'estimated' | 'missing' {
  if (d.energy_kind === 'cumulative') return 'measured';
  return d.estimate_enabled && d.rated_power_kw > 0 && d.heating_code ? 'estimated' : 'missing';
}

export function configureEstimation(
  db: DatabaseSync,
  id: string,
  input: unknown,
  now: number,
): boolean {
  const config = estimationSchema.parse(input);
  return transaction(db, () => {
    const device = db.prepare('SELECT * FROM devices WHERE id=?').get(id) as Row | undefined;
    if (!device) return false;
    if (JSON.stringify(config) === JSON.stringify(estimationConfig(device))) return true;
    db.prepare(
      `UPDATE devices SET estimate_enabled=?,rated_power_kw=?,heating_code=?,
      heating_on_values=?,heating_off_values=?,estimate_revision=estimate_revision+1 WHERE id=?`,
    ).run(
      Number(config.enabled),
      config.ratedPowerKw,
      config.heatingCode,
      JSON.stringify(config.onValues),
      JSON.stringify(config.offValues),
      id,
    );
    // Configuration is not an observation. A persisted unknown barrier also prevents
    // a previously fetched status from being reinterpreted using the new power/mapping.
    const updated = db.prepare('SELECT * FROM devices WHERE id=?').get(id) as Row;
    db.prepare(
      `INSERT OR REPLACE INTO heating_observations
      (device_id,at,heating,raw_value,code,online,source,config_revision,rated_power_kw)
      VALUES(?,?,NULL,NULL,?,0,?,?,?)`,
    ).run(
      id,
      now,
      config.heatingCode,
      energySource(updated),
      updated.estimate_revision,
      config.ratedPowerKw,
    );
    return true;
  });
}

/** Caller may wrap this in a snapshot transaction. Duplicate/out-of-order samples are ignored. */
export function recordHeatingState(
  db: DatabaseSync,
  id: string,
  input: unknown,
  online: boolean,
  now: number,
): void {
  if (!db.isTransaction) {
    transaction(db, () => recordHeatingState(db, id, input, online, now));
    return;
  }
  let fields = statusFieldsSchema.parse(input);
  const d = db.prepare('SELECT * FROM devices WHERE id=?').get(id) as Row | undefined;
  if (!d || (d.status_updated_at !== null && now <= d.status_updated_at)) return;
  const previous = db
    .prepare('SELECT * FROM heating_observations WHERE device_id=? ORDER BY at DESC LIMIT 1')
    .get(id) as Row | undefined;
  if (previous && now <= previous.at) return;
  const oldFields: StatusField[] = JSON.parse(d.status_fields);
  fields = fields.map((field) => {
    const old = oldFields.find(
      (prior) => prior.code === field.code && typeof prior.value === typeof field.value,
    );
    return field.values === undefined && old?.values ? { ...field, values: old.values } : field;
  });
  db.prepare('UPDATE devices SET status_fields=?,status_updated_at=? WHERE id=?').run(
    JSON.stringify(fields),
    now,
    id,
  );
  if (!d.estimate_enabled) return;
  const source = energySource(d);
  const raw = fields.find((f) => f.code === d.heating_code)?.value;
  const config = estimationConfig(d);
  const heating =
    online && d.present && source === 'estimated' && raw !== undefined
      ? config.onValues.includes(raw)
        ? 1
        : config.offValues.includes(raw)
          ? 0
          : null
      : null;
  const elapsed = previous ? now - previous.at : 0;
  if (
    heating !== null &&
    previous?.heating !== null &&
    previous?.online &&
    previous.source === source &&
    previous.config_revision === d.estimate_revision &&
    elapsed > 0 &&
    elapsed <= MAX_HEATING_GAP
  ) {
    const onMs = previous.heating ? elapsed : 0;
    db.prepare(
      `INSERT OR IGNORE INTO intervals(device_id,start,end,kwh,source,on_ms,config_revision)
      VALUES(?,?,?,?,?,?,?)`,
    ).run(
      id,
      previous.at,
      now,
      (d.rated_power_kw * onMs) / 3600000,
      'estimated',
      onMs,
      d.estimate_revision,
    );
  }
  db.prepare(
    `INSERT INTO heating_observations
    (device_id,at,heating,raw_value,code,online,source,config_revision,rated_power_kw)
    VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    now,
    heating,
    raw === undefined ? null : JSON.stringify(raw),
    d.heating_code,
    Number(online),
    source,
    d.estimate_revision,
    d.rated_power_kw,
  );
}

export const heatingSnapshotSchema = z.array(
  z.object({
    id: z.string().min(1).max(256),
    online: z.boolean(),
    statusFields: statusFieldsSchema,
  }),
);
export function ingestHeatingSnapshot(
  db: DatabaseSync,
  accountId: string,
  input: unknown,
  requestedIds: string[],
  now: number,
): void {
  const states = heatingSnapshotSchema.parse(input);
  const byId = new Map(states.map((state) => [state.id, state]));
  transaction(db, () => {
    const devices = db
      .prepare(`SELECT d.* FROM devices d JOIN homes h ON h.id=d.home_id WHERE h.account_id=?`)
      .all(accountId) as Row[];
    for (const d of devices) {
      if (
        !requestedIds.includes(d.remote_id) ||
        (d.status_updated_at !== null && now <= d.status_updated_at)
      )
        continue;
      const state = byId.get(d.remote_id);
      if (state)
        db.prepare('UPDATE devices SET online=?,last_seen=? WHERE id=?').run(
          Number(state.online),
          now,
          d.id,
        );
      recordHeatingState(db, d.id, state?.statusFields ?? [], state?.online ?? false, now);
    }
  });
}

export function currentHeatingState(
  db: DatabaseSync,
  d: Row,
  now: number,
  observation?: Row,
): 'on' | 'off' | 'unknown' {
  if (energySource(d) !== 'estimated') return 'unknown';
  const last =
    observation ??
    (db
      .prepare('SELECT * FROM heating_observations WHERE device_id=? ORDER BY at DESC LIMIT 1')
      .get(d.id) as Row | undefined);
  const fresh =
    energySource(d) === 'estimated' &&
    d.online &&
    d.present &&
    last?.heating !== null &&
    last?.online &&
    last.config_revision === d.estimate_revision &&
    last.source === 'estimated' &&
    now - last.at <= MAX_HEATING_GAP;
  return fresh ? (last!.heating ? 'on' : 'off') : 'unknown';
}

export function estimationView(db: DatabaseSync, d: Row, now: number): EstimationView {
  const config = estimationConfig(d);
  const fields: StatusField[] = JSON.parse(d.status_fields);
  const rows = db
    .prepare('SELECT * FROM heating_observations WHERE device_id=? ORDER BY at DESC LIMIT 30')
    .all(d.id) as Row[];
  const last = rows[0];
  let suggestion: EstimationView['suggestion'] = null;
  for (const field of fields) {
    if (!['work_state', 'heating_state', 'heat_state', 'relay_state'].includes(field.code))
      continue;
    const values = field.values ?? [field.value];
    const onValues = values.filter((v) => ['heating', 'heat', true, 1].includes(v));
    const offValues = values.filter((v) => ['standby', 'idle', 'off', false, 0].includes(v));
    if (onValues.length && offValues.length) {
      suggestion = { heatingCode: field.code, onValues, offValues };
      break;
    }
  }
  const total = db
    .prepare("SELECT SUM(on_ms) AS ms FROM intervals WHERE device_id=? AND source='estimated'")
    .get(d.id) as Row;
  return {
    ...config,
    revision: d.estimate_revision,
    source: energySource(d),
    state: currentHeatingState(db, d, now, last),
    lastObservedAt: last?.at ?? null,
    statusUpdatedAt: d.status_updated_at,
    totalHeatingHours: total.ms === null ? null : round(total.ms / 3600000),
    statusFields: fields,
    suggestion,
    observations: rows.map((r) => ({
      at: r.at,
      state: r.heating === null ? 'unknown' : r.heating ? 'on' : 'off',
      rawValue: r.raw_value === null ? null : JSON.parse(r.raw_value),
      code: r.code,
      online: Boolean(r.online),
      revision: r.config_revision,
      ratedPowerKw: r.rated_power_kw,
    })),
  };
}
