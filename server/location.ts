import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import type { HomeLocation } from '../shared/types.js';

export const locationSchema = z
  .object({
    label: z.string().trim().min(1).max(500),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export function homeLocation(db: DatabaseSync, id: string): HomeLocation | null {
  return (
    (db
      .prepare('SELECT label,latitude,longitude FROM home_locations WHERE home_id=?')
      .get(id) as unknown as HomeLocation | undefined) ?? null
  );
}
