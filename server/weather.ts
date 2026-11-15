import { z } from 'zod';
import { locationSchema } from './location.js';
import type { HomeLocation, OutdoorWeather } from '../shared/types.js';
import { localDate, previousDate, TIMEZONE } from './energy.js';

const weatherSchema = z.object({
  daily_units: z.object({ temperature_2m_mean: z.literal('°C') }),
  daily: z.object({
    time: z.array(z.iso.date()).max(96),
    temperature_2m_mean: z.array(z.number().min(-100).max(80).nullable()).max(96),
  }),
});

type CacheEntry<T> = { expires: number; value: Promise<T> };
/** Bounded cache also coalesces concurrent requests; failed requests may be retried. */
function cached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  now: number,
  ttl: number,
  read: () => Promise<T>,
): Promise<T> {
  const old = cache.get(key);
  if (old && old.expires > now) return old.value;
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const entry = { expires: now + ttl, value: read() };
  cache.set(key, entry);
  entry.value.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return entry.value;
}

export class WeatherService {
  private weatherCache = new Map<string, CacheEntry<Omit<OutdoorWeather, 'location'>>>();
  private searchCache = new Map<string, CacheEntry<HomeLocation[]>>();
  private nextSearch = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    private now: () => number = Date.now,
    private geocoderUrl = process.env.PHOTON_URL || 'https://photon.komoot.io/api/',
  ) {}

  private async json(url: URL): Promise<unknown> {
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'TuyaEnergyMonitor/0.1', Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Provider unavailable');
    return response.json();
  }

  async weather(location: HomeLocation, days: number): Promise<OutdoorWeather> {
    const now = this.now(),
      today = localDate(now);
    const key = JSON.stringify([location.latitude, location.longitude, today, days]);
    const result = await cached(this.weatherCache, key, now, 30 * 60000, async () => {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        daily: 'temperature_2m_mean',
        temperature_unit: 'celsius',
        timezone: TIMEZONE,
        past_days: String(days - 1),
        forecast_days: '4',
      }).toString();
      const { daily } = weatherSchema.parse(await this.json(url));
      if (
        daily.time.length !== daily.temperature_2m_mean.length ||
        new Set(daily.time).size !== daily.time.length
      )
        throw new Error('Invalid weather data');
      const values = new Map(daily.time.map((day, i) => [day, daily.temperature_2m_mean[i]]));
      return {
        updatedAt: now,
        points: Array.from({ length: days + 3 }, (_, i) => {
          const day = previousDate(today, days - 1 - i);
          return { day, average: values.get(day) ?? null, forecast: day >= today };
        }),
      };
    });
    return { ...result, location };
  }

  search(query: string): Promise<HomeLocation[]> {
    return cached(this.searchCache, query, this.now(), 86400000, async () => {
      if (this.now() < this.nextSearch) throw new Error('Search rate limited');
      this.nextSearch = this.now() + 1000;
      const url = new URL(this.geocoderUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '5');
      const data = z
        .object({ features: z.array(z.unknown()).max(100) })
        .parse(await this.json(url));
      const featureSchema = z.object({
        geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
        properties: z.record(z.string(), z.unknown()),
      });
      return data.features
        .flatMap((raw) => {
          const parsed = featureSchema.safeParse(raw);
          if (!parsed.success) return [];
          const {
            geometry: {
              coordinates: [longitude, latitude],
            },
            properties: p,
          } = parsed.data;
          const text = (key: string) => (typeof p[key] === 'string' ? (p[key] as string) : '');
          const street = [text('street'), text('housenumber')].filter(Boolean).join(' ');
          const label = [
            ...new Set(
              [
                text('name'),
                street,
                text('postcode'),
                text('city') || text('town') || text('village'),
                text('district'),
                text('state'),
                text('country'),
              ].filter(Boolean),
            ),
          ].join(', ');
          const location = locationSchema.safeParse({ label, latitude, longitude });
          return location.success ? [location.data] : [];
        })
        .slice(0, 5);
    });
  }
}
