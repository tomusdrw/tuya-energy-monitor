import { z } from 'zod';
import policy from '../shared/energy-policy.json' with { type: 'json' };

const hosts = {
  AY: 'https://openapi.tuyacn.com',
  AZ: 'https://openapi.tuyaus.com',
  EU: 'https://openapi.tuyaeu.com',
  IN: 'https://openapi.tuyain.com',
  UE: 'https://openapi-ueaz.tuyaus.com',
  WE: 'https://openapi-weaz.tuyaeu.com',
  SG: 'https://openapi-sg.iotbing.com',
};
export type AiFailure = 'key' | 'access' | 'rate' | 'response' | 'unavailable' | 'counter';
export class TuyaAiError extends Error {
  constructor(readonly kind: AiFailure) {
    super(
      {
        key: 'Check the Tuya.ai key and its region.',
        access: 'Tuya.ai access was rejected. Check the key permissions.',
        rate: 'Tuya.ai rate limit reached. The next scheduled reading will retry.',
        response: 'Tuya.ai returned an invalid device response.',
        unavailable: 'Could not read Tuya.ai. The next scheduled reading will retry.',
        counter: 'Tuya.ai did not provide a valid energy counter.',
      }[kind],
    );
  }
}
export const safeAiError = (error: unknown) =>
  error instanceof TuyaAiError ? error.message : new TuyaAiError('unavailable').message;

export function apiRegion(key: string) {
  if (!/^sk-[A-Z]{2}[A-Za-z0-9_-]{1,500}$/.test(key)) throw new TuyaAiError('key');
  const region = key.slice(3, 5) as keyof typeof hosts;
  if (!Object.hasOwn(hosts, region)) throw new TuyaAiError('key');
  return { region, origin: hosts[region] };
}

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
export const meterSchema = z.object({
  code: z.enum(policy.cumulativeCodes as [string, ...string[]]),
  dpId: z.number().int().positive(),
  scale: z.number().int().min(0).max(policy.maxScale),
  unit: z.enum(['kwh', 'wh']),
});
export type AiMeter = z.infer<typeof meterSchema>;
export const metersSchema = z.array(meterSchema).max(256);

export function parseModel(input: unknown): AiMeter[] {
  try {
    const { model } = z.object({ model: z.string().max(2_000_000) }).parse(input);
    const parsed = z
      .object({ services: z.array(z.object({ properties: z.array(z.unknown()) })) })
      .parse(JSON.parse(model));
    const meters: AiMeter[] = [];
    for (const raw of parsed.services.flatMap((s) => s.properties)) {
      const p = z
        .object({
          code: z.string(),
          abilityId: z.number(),
          accessMode: z.enum(['ro', 'rw']),
          typeSpec: z.object({ type: z.literal('value'), scale: z.number(), unit: z.string() }),
        })
        .safeParse(raw);
      if (!p.success) continue;
      const { code, abilityId, typeSpec } = p.data;
      const meter = meterSchema.safeParse({
        code,
        dpId: abilityId,
        scale: typeSpec.scale,
        unit: typeSpec.unit.toLowerCase().replace(/[ ·]/g, ''),
      });
      if (meter.success) {
        if (meters.some((m) => m.code === code)) throw new Error('Ambiguous model');
        meters.push(meter.data);
      }
    }
    return meters.sort(
      (a, b) => policy.cumulativeCodes.indexOf(a.code) - policy.cumulativeCodes.indexOf(b.code),
    );
  } catch {
    throw new TuyaAiError('response');
  }
}

const detailSchema = z.object({
  device_id: idSchema,
  online: z.boolean(),
  properties: z.record(z.string(), z.unknown()),
});
export function readCounter(input: unknown, meters: AiMeter[], deviceId: string) {
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success || parsed.data.device_id !== deviceId) throw new TuyaAiError('response');
  const detail = parsed.data;
  if (!meters.length) return null;
  // A deterministic property prevents silently switching counters when a field disappears.
  const meter = meters[0];
  const raw = detail.properties[meter.code];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) throw new TuyaAiError('counter');
  return {
    code: meter.code,
    online: detail.online,
    counterKwh: raw / 10 ** meter.scale / policy.kwhDivisors[meter.unit],
    series: JSON.stringify(meter),
  };
}

export interface AiClient {
  list(key: string): Promise<string[]>;
  model(key: string, id: string): Promise<AiMeter[]>;
  detail(key: string, id: string): Promise<unknown>;
}

/** Read-only, fixed-host transport. One queue also paces validation versus background reads. */
export class TuyaAiClient implements AiClient {
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequest = 0;
  private fetcher: typeof fetch;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private timeoutMs: number;
  constructor(
    options: {
      fetch?: typeof fetch;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      timeoutMs?: number;
    } = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? 10000;
  }
  private request(key: string, path: string): Promise<unknown> {
    const work = this.queue.then(async () => {
      const { origin } = apiRegion(key);
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.sleep(Math.max(0, this.nextRequest - this.now()));
        this.nextRequest = this.now() + 1100;
        try {
          const response = await this.fetcher(`${origin}/v1.0/end-user/${path}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${key}` },
            redirect: 'error',
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          const limited = response.status === 429;
          if (!limited && !response.ok)
            throw new TuyaAiError([401, 403].includes(response.status) ? 'access' : 'unavailable');
          const body = limited
            ? null
            : z
                .object({
                  success: z.boolean(),
                  code: z.union([z.string(), z.number()]).optional(),
                  result: z.unknown().optional(),
                })
                .parse(await response.json());
          if (limited || String(body?.code) === '1199') {
            const header = response.headers.get('Retry-After');
            const retryAfter =
              header === null
                ? 0
                : /^\d+(\.\d+)?$/.test(header)
                  ? Number(header) * 1000
                  : Math.max(0, Date.parse(header) - this.now());
            const delay = Math.max(
              2000 * 2 ** attempt,
              Number.isFinite(retryAfter) ? retryAfter : 0,
            );
            if (attempt === 2 || delay > 30000) throw new TuyaAiError('rate');
            this.nextRequest = Math.max(this.nextRequest, this.now() + delay);
            continue;
          }
          if (!body?.success) throw new TuyaAiError('access');
          return body.result;
        } catch (error) {
          if (error instanceof TuyaAiError) throw error;
          throw new TuyaAiError(
            error instanceof z.ZodError || error instanceof SyntaxError
              ? 'response'
              : 'unavailable',
          );
        }
      }
      throw new TuyaAiError('rate');
    });
    this.queue = work.catch(() => {});
    return work;
  }
  async list(key: string): Promise<string[]> {
    const result = z
      .object({ devices: z.array(z.object({ device_id: idSchema })).max(10000) })
      .safeParse(await this.request(key, 'devices/all'));
    if (!result.success) throw new TuyaAiError('response');
    return [...new Set(result.data.devices.map((d) => d.device_id))];
  }
  async model(key: string, id: string): Promise<AiMeter[]> {
    if (!idSchema.safeParse(id).success) throw new TuyaAiError('response');
    return parseModel(await this.request(key, `devices/${encodeURIComponent(id)}/model`));
  }
  async detail(key: string, id: string) {
    if (!idSchema.safeParse(id).success) throw new TuyaAiError('response');
    const result = detailSchema.safeParse(
      await this.request(key, `devices/${encodeURIComponent(id)}/detail`),
    );
    if (!result.success || result.data.device_id !== id) throw new TuyaAiError('response');
    return result.data;
  }
}
