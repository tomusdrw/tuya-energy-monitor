import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';
import { z, ZodError } from 'zod';
import { openDatabase } from './db.js';
import { encrypt, decrypt, digest } from './crypto.js';
import { accounts, getOverview, getHome, getDevice, notifications, TIMEZONE } from './energy.js';
import { emailConfigured, type Config } from './config.js';
import { callTuya, sessionSchema, type TuyaCall, type TuyaSession } from './tuya.js';
import { Collector } from './collector.js';
import { TuyaStream } from './stream.js';
import { configureEstimation } from './estimation.js';
import { evaluateNotifications, deliverPending } from './notifications.js';

interface Dependencies {
  db?: DatabaseSync;
  background?: boolean;
  tuya?: TuyaCall;
}
const rulesSchema = z
  .object({
    dailyLimit: z.number().positive().max(100000).nullable(),
    anomalyEnabled: z.boolean(),
    windowDays: z.number().int().min(7).max(90),
    increasePercent: z.number().min(1).max(10000),
    increaseKwh: z.number().min(0.1).max(100000),
  })
  .strict();
const daysSchema = z.coerce.number().int().min(1).max(90).default(14);

export async function createApp(config: Config, dependencies: Dependencies = {}) {
  process.umask(0o077);
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const db = dependencies.db ?? openDatabase(path.join(config.dataDir, 'monitor.sqlite'));
  const keyCheck = db.prepare("SELECT value FROM metadata WHERE key='key_check'").get() as
    { value: string } | undefined;
  if (keyCheck) decrypt(keyCheck.value, config.encryptionKey);
  else
    db.prepare("INSERT INTO metadata(key,value) VALUES('key_check',?)").run(
      encrypt('monitor', config.encryptionKey),
    );
  const revision = createHmac('sha256', config.encryptionKey).update(config.password).digest('hex');
  const prior = db.prepare("SELECT value FROM metadata WHERE key='auth_revision'").get() as
    { value: string } | undefined;
  if (prior?.value !== revision) {
    db.exec('DELETE FROM sessions');
    db.prepare(
      "INSERT INTO metadata(key,value) VALUES('auth_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(revision);
  }
  const salt = randomBytes(16),
    passwordHash = scryptSync(config.password, salt, 64);
  const app = Fastify({ logger: false, bodyLimit: 16384, requestTimeout: 200000 });
  const tuya =
    dependencies.tuya ?? ((operation, payload) => callTuya(operation, payload, config.python));
  const collector = new Collector(
    db,
    config,
    tuya,
    Date.now,
    dependencies.tuya
      ? undefined
      : (session, onMessage) => new TuyaStream(session, onMessage, config.python),
  );
  let delivery: Promise<void> | null = null;
  collector.afterSync = async () => {
    const now = Date.now();
    evaluateNotifications(db, now);
    // Keep one outbox owner, independently of the minute-by-minute collector.
    // Slow email responses must not turn healthy relay observations into gaps.
    if (!delivery)
      delivery = deliverPending(db, config, now)
        .catch(() => {})
        .finally(() => {
          delivery = null;
        });
  };
  const flows = new Map<
    string,
    {
      userCode: string;
      qrcode: string;
      label: string;
      owner: string;
      expires: number;
      accountId?: string;
      busy: boolean;
    }
  >();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    path: '/',
    secure: config.origin.startsWith('https://'),
    maxAge: 7 * 86400,
  };
  const authenticated = (token: string | undefined) =>
    token &&
    /^[a-f0-9]{64}$/.test(token) &&
    db
      .prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?')
      .get(digest(token), Date.now());

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    // Protect the matched route: the router accepts percent-encoded static segments.
    const route = request.routeOptions.url;
    if (!route?.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== config.origin)
      return reply
        .code(403)
        .send({ error: 'Żądanie musi pochodzić z adresu aplikacji (APP_ORIGIN).' });
    if (route === '/api/auth' || route === '/api/auth/login') return;
    if (!authenticated(request.cookies.tem_session))
      return reply.code(401).send({ error: 'Zaloguj się, aby kontynuować.' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'Sprawdź wartości w formularzu.',
        fields: error.issues.map((i) => i.path.join('.')),
      });
    const status = Number((error as any).statusCode);
    if (status === 429)
      return reply.code(429).send({ error: 'Zbyt wiele prób. Spróbuj ponownie za minutę.' });
    if (status >= 400 && status < 500)
      return reply.code(status).send({ error: 'Nieprawidłowe żądanie.' });
    return reply.code(500).send({ error: 'Operacja nie powiodła się. Spróbuj ponownie.' });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/auth', async (request) => ({
    authenticated: Boolean(authenticated(request.cookies.tem_session)),
  }));
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { password } = z.object({ password: z.string().max(1024) }).parse(request.body);
      if (!timingSafeEqual(scryptSync(password, salt, 64), passwordHash))
        return reply.code(401).send({ error: 'Nieprawidłowe hasło.' });
      const token = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
      db.prepare('INSERT INTO sessions(hash,expires) VALUES(?,?)').run(
        digest(token),
        Date.now() + 7 * 86400000,
      );
      reply.setCookie('tem_session', token, cookieOptions);
      return { ok: true };
    },
  );
  app.post('/api/auth/logout', async (request, reply) => {
    db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(request.cookies.tem_session!));
    reply.clearCookie('tem_session', cookieOptions);
    return { ok: true };
  });

  app.get('/api/overview', async (request) =>
    getOverview(db, Date.now(), daysSchema.parse((request.query as any).days)),
  );
  app.get<{ Params: { id: string } }>('/api/homes/:id', async (request, reply) => {
    const home = getHome(
      db,
      request.params.id,
      Date.now(),
      daysSchema.parse((request.query as any).days),
    );
    return home ?? reply.code(404).send({ error: 'Nie znaleziono mieszkania.' });
  });
  app.get<{ Params: { id: string } }>('/api/devices/:id', async (request, reply) => {
    const device = getDevice(
      db,
      request.params.id,
      Date.now(),
      daysSchema.parse((request.query as any).days),
    );
    return device ?? reply.code(404).send({ error: 'Nie znaleziono urządzenia.' });
  });
  app.put<{ Params: { id: string } }>('/api/homes/:id/rules', async (request, reply) => {
    const rules = rulesSchema.parse(request.body);
    const result = db
      .prepare(
        'UPDATE homes SET daily_limit=?,anomaly_enabled=?,window_days=?,increase_percent=?,increase_kwh=? WHERE id=?',
      )
      .run(
        rules.dailyLimit,
        Number(rules.anomalyEnabled),
        rules.windowDays,
        rules.increasePercent,
        rules.increaseKwh,
        request.params.id,
      );
    if (!result.changes) return reply.code(404).send({ error: 'Nie znaleziono mieszkania.' });
    return { ok: true };
  });
  app.put<{ Params: { id: string } }>('/api/devices/:id', async (request, reply) => {
    const { included } = z.object({ included: z.boolean() }).strict().parse(request.body);
    const result = db
      .prepare('UPDATE devices SET included=? WHERE id=?')
      .run(Number(included), request.params.id);
    if (!result.changes) return reply.code(404).send({ error: 'Nie znaleziono urządzenia.' });
    return { ok: true };
  });
  app.put<{ Params: { id: string } }>('/api/devices/:id/estimation', async (request, reply) => {
    if (!configureEstimation(db, request.params.id, request.body, Date.now()))
      return reply.code(404).send({ error: 'Nie znaleziono urządzenia.' });
    return { ok: true };
  });
  app.get('/api/accounts', async () => accounts(db));
  app.get('/api/notifications', async () => notifications(db));
  app.get('/api/settings', async () => ({
    timezone: TIMEZONE,
    pollSeconds: config.pollSeconds,
    statusPollSeconds: config.statusPollSeconds,
    origin: config.origin,
    emailConfigured: emailConfigured(config),
    emailFrom: config.emailFrom || null,
    emailTo: config.emailTo || null,
    syncing: collector.syncing,
  }));
  app.post(
    '/api/sync',
    { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      void collector.sync().catch(() => {});
      return reply.code(202).send({ ok: true });
    },
  );

  app.post(
    '/api/accounts/connect',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = z
        .object({
          label: z.string().trim().min(1).max(80),
          userCode: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
          accountId: z.string().optional(),
        })
        .parse(request.body);
      for (const [id, flow] of flows) if (flow.expires < Date.now()) flows.delete(id);
      if (flows.size >= 5)
        return reply
          .code(429)
          .send({ error: 'Dokończ rozpoczęte połączenie lub poczekaj 5 minut.' });
      if (body.accountId && !db.prepare('SELECT id FROM accounts WHERE id=?').get(body.accountId))
        return reply.code(404).send({ error: 'Nie znaleziono konta.' });
      try {
        const response = await tuya('start', { userCode: body.userCode });
        if (!response.ok || typeof response.qrcode !== 'string') throw new Error('QR failed');
        const id = randomUUID(),
          expires = Date.now() + 5 * 60000;
        flows.set(id, {
          ...body,
          qrcode: response.qrcode,
          owner: digest(request.cookies.tem_session!),
          expires,
          busy: false,
        });
        return {
          id,
          expires,
          image: await QRCode.toDataURL(`tuyaSmart--qrLogin?token=${response.qrcode}`, {
            width: 300,
            margin: 2,
          }),
        };
      } catch {
        return reply.code(502).send({
          error: 'Nie udało się wygenerować QR. Sprawdź kod użytkownika i spróbuj ponownie.',
        });
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/accounts/connect/:id/confirm',
    async (request, reply) => {
      const flow = flows.get(request.params.id);
      if (!flow || flow.expires < Date.now() || flow.owner !== digest(request.cookies.tem_session!))
        return reply.code(410).send({ error: 'Kod QR wygasł. Wygeneruj nowy.' });
      if (flow.busy) return reply.code(409).send({ error: 'Trwa potwierdzanie połączenia.' });
      flow.busy = true;
      try {
        const response = await tuya('confirm', { userCode: flow.userCode, qrcode: flow.qrcode });
        if (!response.ok)
          return reply.code(409).send({
            error:
              'Zeskanuj QR i zatwierdź połączenie w aplikacji. Jeśli kod wygasł, wygeneruj nowy.',
          });
        const session = sessionSchema.parse(response.session);
        const identity = digest(session.token_info.uid);
        if (flow.accountId) {
          const existing = db
            .prepare('SELECT identity FROM accounts WHERE id=?')
            .get(flow.accountId) as { identity: string };
          if (existing.identity !== identity)
            return reply.code(409).send({
              error: 'To inne konto Tuya. Zaloguj właściwe konto lub dodaj je jako nowe.',
            });
        }
        db.prepare(
          `INSERT INTO accounts(id,label,identity,secret) VALUES(?,?,?,?)
        ON CONFLICT(identity) DO UPDATE SET label=excluded.label,secret=excluded.secret,error=NULL`,
        ).run(randomUUID(), flow.label, identity, encrypt(session, config.encryptionKey));
        flows.delete(request.params.id);
        void collector.sync().catch(() => {});
        return { ok: true };
      } catch {
        return reply
          .code(502)
          .send({ error: 'Nie udało się potwierdzić połączenia. Spróbuj ponownie.' });
      } finally {
        flow.busy = false;
      }
    },
  );

  const clientRoot = path.resolve('dist/client');
  if (existsSync(path.join(clientRoot, 'index.html'))) {
    await app.register(staticFiles, { root: clientRoot, prefix: '/', index: 'index.html' });
  }
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'Nie znaleziono strony.' }),
  );
  app.addHook('onClose', async () => {
    await collector.stop();
    await delivery; // The sender must finish before its database is closed.
    flows.clear();
    db.close();
  });
  if (dependencies.background !== false)
    app.addHook('onReady', async () => {
      collector.start();
    });
  return app;
}
