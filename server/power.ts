import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { StatusField } from '../shared/types.js';

export const MAX_POWER_GAP = 180000;
export const powerFieldSchema = z.object({
  code: z.enum(['cur_power', 'power', 'work_power']),
  scale: z.number().int().min(0).max(9),
  unit: z.enum(['W', 'kW']),
});
type Row = Record<string, any>;

/** Called within the full/fast snapshot transaction; metadata comes from inventory. */
export function recordPower(
  db: DatabaseSync,
  id: string,
  fields: StatusField[],
  online: boolean,
  now: number,
): void {
  const d = db.prepare('SELECT * FROM devices WHERE id=?').get(id) as Row;
  if (!d || (d.power_updated_at !== null && now <= d.power_updated_at)) return;
  if (!d.power_field && d.power_updated_at === null) return;
  const field = d.power_field ? powerFieldSchema.parse(JSON.parse(d.power_field)) : null;
  const raw = fields.find((f) => f.code === field?.code)?.value;
  let watts: number | null = null;
  if (field && online && d.present && typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    const value = (raw / 10 ** field.scale) * (field.unit === 'kW' ? 1000 : 1);
    if (Number.isFinite(value)) watts = value;
  }
  const last = db
    .prepare('SELECT * FROM power_observations WHERE device_id=? ORDER BY at DESC LIMIT 1')
    .get(id) as Row | undefined;
  const elapsed = last ? now - last.at : 0;
  if (
    d.energy_kind === 'power' &&
    watts !== null &&
    last?.source === 'power' &&
    last.power_w !== null &&
    last.field === d.power_field &&
    elapsed > 0 &&
    elapsed <= MAX_POWER_GAP
  ) {
    // Trapezoidal integration of measured W over milliseconds, converted to kWh.
    const kwh = (last.power_w / 2 + watts / 2) * (elapsed / 3600000000);
    db.prepare(`INSERT INTO intervals(device_id,start,end,kwh,source) VALUES(?,?,?,?,'power')`).run(
      id,
      last.at,
      now,
      kwh,
    );
  }
  db.prepare(
    'INSERT INTO power_observations(device_id,at,power_w,field,source) VALUES(?,?,?,?,?)',
  ).run(id, now, watts, d.power_field, d.energy_kind);
  db.prepare('UPDATE devices SET power_w=?,power_updated_at=? WHERE id=?').run(watts, now, id);
}

export function hasFreshPower(d: Row, now: number): boolean {
  return Boolean(
    d.online &&
    d.present &&
    d.power_field &&
    d.power_w !== null &&
    d.power_updated_at !== null &&
    now - d.power_updated_at <= MAX_POWER_GAP,
  );
}
