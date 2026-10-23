import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { transaction } from './db.js';
import type { EstimationConfig, EstimationView, StatusField } from '../shared/types.js';
import { statusChoices, suggestHeatingMapping } from '../shared/estimation.js';
import { recordPower } from './power.js';
import { suggestTemperatureMapping, temperatureHeatingState } from '../shared/temperature.js';

export const MAX_HEATING_GAP = 180000;
const scalar = z.union([z.boolean(), z.number().finite(), z.string().max(100)]);
const code = z.string().regex(/^[A-Za-z0-9_]{1,100}$/);
const temperatureMetadata = z.object({
  scale: z.number().int().min(0).max(9),
  unit: z.enum(['C', 'F']),
});
export const temperatureMetadataSchema = z.record(code, temperatureMetadata.nullable());
const temperatureField = temperatureMetadata.extend({ code });
const temperatureMapping = z
  .object({
    current: temperatureField,
    target: temperatureField,
    switchCode: code.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.current.code !== v.target.code &&
      v.switchCode !== v.current.code &&
      v.switchCode !== v.target.code,
    'Temperature and switch fields must be distinct.',
  );
export const statusFieldsSchema = z
  .array(
    z.object({
      code,
      value: scalar,
      values: z.array(scalar).max(100).optional(),
      temperature: temperatureMetadata.nullable().optional(),
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
    temperature: temperatureMapping.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.enabled &&
      (!v.ratedPowerKw ||
        (!v.temperature && (!v.heatingCode || !v.onValues.length || !v.offValues.length)))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the power, field, and heating and idle values.',
      });
    if (v.onValues.some((on) => v.offValues.some((off) => off === on)))
      ctx.addIssue({ code: 'custom', message: 'Heating and idle values must not overlap.' });
    if (v.temperature && (v.heatingCode || v.onValues.length || v.offValues.length))
      ctx.addIssue({
        code: 'custom',
        message: 'Choose temperature comparison or a heating signal.',
      });
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
    temperature: d.temperature_config ? JSON.parse(d.temperature_config) : null,
  };
}
export function energySource(d: Row): 'measured' | 'power' | 'estimated' | 'missing' {
  if (d.energy_kind === 'cumulative' || d.energy_kind === 'incremental') return 'measured';
  if (d.energy_kind === 'power') return 'power';
  return d.estimate_enabled && d.rated_power_kw > 0 && (d.heating_code || d.temperature_config)
    ? 'estimated'
    : 'missing';
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
      heating_on_values=?,heating_off_values=?,temperature_config=?,estimate_revision=estimate_revision+1 WHERE id=?`,
    ).run(
      Number(config.enabled),
      config.ratedPowerKw,
      config.heatingCode,
      JSON.stringify(config.onValues),
      JSON.stringify(config.offValues),
      config.temperature ? JSON.stringify(config.temperature) : null,
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
  discoveredTemperatures?: Record<string, StatusField['temperature']>,
): void {
  if (!db.isTransaction) {
    transaction(db, () => recordHeatingState(db, id, input, online, now, discoveredTemperatures));
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
  // Persist only definitions across omitted fields, never their old readings.
  const metadata: Record<string, StatusField['temperature']> =
    discoveredTemperatures ?? JSON.parse(d.temperature_metadata);
  fields = fields.map((field) => {
    if (field.temperature !== undefined) metadata[field.code] = field.temperature;
    const old = oldFields.find(
      (prior) => prior.code === field.code && typeof prior.value === typeof field.value,
    );
    // Learn choices even before estimation is enabled. Metadata replaces old choices;
    // fast reads retain observed choices, but never retain an absent current field.
    return {
      ...field,
      ...(metadata[field.code] !== undefined ? { temperature: metadata[field.code] } : {}),
      values: statusChoices({
        ...field,
        values: field.values?.length ? field.values : old ? statusChoices(old) : [],
      }).slice(-100),
    };
  });
  db.prepare(
    'UPDATE devices SET status_fields=?,status_updated_at=?,temperature_metadata=? WHERE id=?',
  ).run(JSON.stringify(fields), now, JSON.stringify(metadata), id);
  if (!d.estimate_enabled) return;
  const source = energySource(d);
  const config = estimationConfig(d);
  const raw = config.temperature
    ? JSON.stringify({
        current: fields.find((f) => f.code === config.temperature!.current.code)?.value ?? null,
        target: fields.find((f) => f.code === config.temperature!.target.code)?.value ?? null,
        switch: config.temperature.switchCode
          ? (fields.find((f) => f.code === config.temperature!.switchCode)?.value ?? null)
          : null,
      })
    : fields.find((f) => f.code === d.heating_code)?.value;
  const heating =
    online && d.present && source === 'estimated'
      ? config.temperature
        ? temperatureHeatingState(fields, config.temperature)
        : raw !== undefined && config.onValues.includes(raw)
          ? 1
          : raw !== undefined && config.offValues.includes(raw)
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
    config.temperature ? 'temperature_comparison' : d.heating_code,
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
      recordPower(db, d.id, state?.statusFields ?? [], state?.online ?? false, now);
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
  const suggestion = fields.map(suggestHeatingMapping).find((mapping) => mapping !== null) ?? null;
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
    temperatureSuggestion: suggestTemperatureMapping(fields),
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
