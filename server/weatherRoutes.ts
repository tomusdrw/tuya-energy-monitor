import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { WeatherService } from './weather.js';
import { homeLocation, locationSchema } from './location.js';

export function registerWeatherRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  weather: WeatherService,
) {
  app.get(
    '/api/locations/search',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { q } = z.object({ q: z.string().trim().min(3).max(200) }).parse(request.query);
      try {
        return await weather.search(q);
      } catch {
        return reply.code(503).send({ error: 'Address search is unavailable. Please try again.' });
      }
    },
  );
  app.put<{ Params: { id: string } }>('/api/homes/:id/location', async (request, reply) => {
    const { location } = z
      .object({ location: locationSchema.nullable() })
      .strict()
      .parse(request.body);
    if (!db.prepare('SELECT 1 FROM homes WHERE id=?').get(request.params.id))
      return reply.code(404).send({ error: 'Home not found.' });
    if (location)
      db.prepare(
        `INSERT INTO home_locations(home_id,label,latitude,longitude) VALUES(?,?,?,?)
      ON CONFLICT(home_id) DO UPDATE SET label=excluded.label,latitude=excluded.latitude,longitude=excluded.longitude`,
      ).run(request.params.id, location.label, location.latitude, location.longitude);
    else db.prepare('DELETE FROM home_locations WHERE home_id=?').run(request.params.id);
    return { location };
  });
  app.get<{ Params: { id: string } }>('/api/homes/:id/weather', async (request, reply) => {
    const { days } = z
      .object({ days: z.coerce.number().int().min(1).max(90).default(14) })
      .parse(request.query);
    if (!db.prepare('SELECT 1 FROM homes WHERE id=?').get(request.params.id))
      return reply.code(404).send({ error: 'Home not found.' });
    const location = homeLocation(db, request.params.id);
    if (!location) return { location: null, points: [], updatedAt: null };
    try {
      return await weather.weather(location, days);
    } catch {
      return reply.code(503).send({ error: 'Weather is unavailable. Please try again.' });
    }
  });
}
