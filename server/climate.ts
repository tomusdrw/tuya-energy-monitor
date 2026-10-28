import type { DatabaseSync } from 'node:sqlite';
import type { ClimateMetric, ClimateSummary } from '../shared/types.js';

const MAX_CLIMATE_AGE = 15 * 60000;
type Row = Record<string, any>;

export function climateReading(device: Row, now: number) {
  const fresh =
    device.present &&
    device.online &&
    device.climate_at !== null &&
    device.climate_at <= now &&
    now - device.climate_at <= MAX_CLIMATE_AGE;
  return {
    temperature: fresh ? device.temperature : null,
    humidity: fresh ? device.humidity : null,
    climateObservedAt: device.climate_at,
  };
}

interface Contribution {
  average: number;
  minimum: number;
  maximum: number;
  samples: number;
  oldestObservedAt: number;
  latestObservedAt: number;
}

function summarize(values: Contribution[]): ClimateMetric {
  return {
    average: values.length ? values.reduce((sum, v) => sum + v.average / values.length, 0) : null,
    minimum: values.length ? Math.min(...values.map((v) => v.minimum)) : null,
    maximum: values.length ? Math.max(...values.map((v) => v.maximum)) : null,
    count: values.length,
    samples: values.reduce((sum, v) => sum + v.samples, 0),
    oldestObservedAt: values.length ? Math.min(...values.map((v) => v.oldestObservedAt)) : null,
    latestObservedAt: values.length ? Math.max(...values.map((v) => v.latestObservedAt)) : null,
  };
}

export function currentClimate(devices: Row[], now: number): ClimateSummary {
  const readings = devices.map((d) => ({
    ...climateReading(d, now),
    temperatureIncluded: Boolean(d.temperature_included),
  }));
  const metric = (key: 'temperature' | 'humidity') =>
    summarize(
      readings.flatMap((r) =>
        r[key] === null || (key === 'temperature' && !r.temperatureIncluded)
          ? []
          : [
              {
                average: r[key],
                minimum: r[key],
                maximum: r[key],
                samples: 1,
                oldestObservedAt: r.climateObservedAt,
                latestObservedAt: r.climateObservedAt,
              },
            ],
      ),
    );
  return { temperature: metric('temperature'), humidity: metric('humidity') };
}

export function climateForPeriod(
  db: DatabaseSync,
  homeId: string,
  start: number,
  end: number,
): ClimateSummary {
  const metric = (key: 'temperature' | 'humidity') =>
    summarize(
      db
        .prepare(
          `
    SELECT AVG(${key}) AS average, MIN(${key}) AS minimum, MAX(${key}) AS maximum,
      COUNT(*) AS samples, MIN(at) AS oldestObservedAt, MAX(at) AS latestObservedAt
    FROM climate_observations
    WHERE home_id=? AND at>=? AND at<? AND ${key} IS NOT NULL
      ${key === 'temperature' ? 'AND EXISTS (SELECT 1 FROM devices WHERE id=climate_observations.device_id AND temperature_included=1)' : ''}
    GROUP BY device_id
  `,
        )
        .all(homeId, start, end) as unknown as Contribution[],
    );
  return { temperature: metric('temperature'), humidity: metric('humidity') };
}
