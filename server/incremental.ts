import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { scopedId } from './crypto.js';

const reportSchema = z.object({
  deviceId: z.string().min(1).max(256),
  code: z.string().regex(/^[A-Za-z0-9_]{1,100}$/),
  at: z.number().int().positive().safe(),
  kwh: z.number().finite().nonnegative(),
  reportId: z.string().min(1).max(256).optional(),
});
export const STREAM_FRESHNESS = 90000;

/** Reports are point measurements, not intervals or cumulative counters. */
export function ingestEnergyReport(
  db: DatabaseSync,
  accountId: string,
  input: unknown,
  now: number,
): void {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success || parsed.data.at > now) return;
  const report = parsed.data;
  db.prepare(
    `INSERT OR IGNORE INTO energy_reports(device_id,code,report_id,at,kwh,received_at)
    SELECT id,?,?,?,?,? FROM devices WHERE id=? AND energy_kind='incremental'
    AND energy_code=? AND incremental_since<=? AND present=1`,
  ).run(
    report.code,
    report.reportId ? `id:${report.reportId}` : `time:${report.at}`,
    report.at,
    report.kwh,
    now,
    scopedId(accountId, report.deviceId),
    report.code,
    report.at,
  );
}

export function setEnergyStreamState(
  db: DatabaseSync,
  accountId: string,
  connected: boolean,
  now: number,
  deviceIds?: string[],
): void {
  db.prepare(
    `UPDATE devices SET energy_stream_at=? WHERE energy_kind='incremental'
    AND home_id IN (SELECT id FROM homes WHERE account_id=?)`,
  ).run(connected && !deviceIds ? now : null, accountId);
  if (connected && deviceIds)
    for (const id of deviceIds)
      db.prepare(
        `UPDATE devices SET energy_stream_at=? WHERE id=? AND energy_kind='incremental' AND present=1`,
      ).run(now, scopedId(accountId, id));
}
