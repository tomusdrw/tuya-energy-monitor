import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import { decrypt, encrypt } from './crypto.js';
import { transaction } from './db.js';
import { failAiReading, ingestAiReading } from './energy.js';
import {
  apiRegion,
  metersSchema,
  readCounter,
  safeAiError,
  TuyaAiError,
  type AiClient,
  type AiMeter,
} from './tuya-ai.js';

type Account = {
  id: string;
  ai_secret: string | null;
  ai_revision: number;
  ai_last_attempt: number | null;
};
type Device = { id: string; remote_id: string; measurement_provider: string };
export class AiConfigurationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}
const MODEL_TTL = 24 * 3600000;

/** Independent lane: slow Tuya.ai calls must not delay QR inventories or relay polling. */
export class TuyaAiIntegration {
  private running: Promise<void> | null = null;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  afterSync: () => Promise<void> = async () => {};
  constructor(
    private db: DatabaseSync,
    private config: Config,
    private client: AiClient,
    private clock = Date.now,
  ) {}

  private account(id: string) {
    return this.db
      .prepare('SELECT id,ai_secret,ai_revision,ai_last_attempt FROM accounts WHERE id=?')
      .get(id) as Account | undefined;
  }
  private current(account: Account): boolean {
    const current = this.account(account.id);
    return (
      !this.stopped && Boolean(current?.ai_secret) && current?.ai_revision === account.ai_revision
    );
  }
  async save(accountId: string, key: string): Promise<void> {
    const { region } = apiRegion(key);
    const before = this.account(accountId);
    if (!before) throw new AiConfigurationError('Account not found.', 404);
    const ids = await this.client.list(key);
    transaction(this.db, () => {
      const current = this.account(accountId);
      if (this.stopped || !current || current.ai_revision !== before.ai_revision)
        throw new AiConfigurationError('Tuya.ai configuration changed. Try again.', 409);
      const devices = this.db
        .prepare(
          `SELECT d.remote_id FROM devices d JOIN homes h ON h.id=d.home_id
        WHERE h.account_id=? AND d.present=1`,
        )
        .all(accountId) as { remote_id: string }[];
      if (!devices.some((d) => ids.includes(d.remote_id)))
        throw new AiConfigurationError(
          'The key does not grant access to any known devices on this account. Synchronize QR and check the selected account.',
          400,
        );
      this.resetDevices(accountId);
      this.db
        .prepare(
          `UPDATE accounts SET ai_secret=?,ai_revision=ai_revision+1,ai_region=?,
        ai_last_success=NULL,ai_last_attempt=NULL,ai_error=NULL WHERE id=?`,
        )
        .run(encrypt(key, this.config.encryptionKey), region, accountId);
    });
  }
  remove(accountId: string): void {
    if (!this.account(accountId)) throw new AiConfigurationError('Account not found.', 404);
    transaction(this.db, () => {
      this.resetDevices(accountId);
      // Increment even when no key is saved: deletion cancels an in-flight first save.
      this.db
        .prepare(
          `UPDATE accounts SET ai_secret=NULL,ai_revision=ai_revision+1,ai_region=NULL,
        ai_last_success=NULL,ai_last_attempt=NULL,ai_error=NULL WHERE id=?`,
        )
        .run(accountId);
    });
  }
  private resetDevices(accountId: string) {
    const now = this.clock();
    this.db
      .prepare(
        `DELETE FROM ai_models WHERE device_id IN
      (SELECT d.id FROM devices d JOIN homes h ON h.id=d.home_id WHERE h.account_id=?)`,
      )
      .run(accountId);
    const devices = this.db
      .prepare(
        `SELECT d.id FROM devices d JOIN homes h ON h.id=d.home_id
      WHERE h.account_id=? AND d.measurement_provider='tuya_ai'`,
      )
      .all(accountId) as { id: string }[];
    for (const { id } of devices) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO readings(device_id,at,counter_kwh,code,online,provider)
        VALUES(?,?,NULL,NULL,0,'tuya_ai')`,
        )
        .run(id, now);
      this.db
        .prepare(
          `INSERT OR REPLACE INTO heating_observations
        (device_id,at,heating,raw_value,code,online,source,config_revision,rated_power_kw)
        SELECT id,?,NULL,NULL,heating_code,0,'missing',estimate_revision,rated_power_kw FROM devices WHERE id=?`,
        )
        .run(now, id);
      this.db
        .prepare(
          `UPDATE devices SET energy_kind=qr_energy_kind,energy_code=qr_energy_code,counter_kwh=NULL,
        measurement_provider='qr',measurement_at=NULL,measurement_online=0,measurement_error=NULL WHERE id=?`,
        )
        .run(id);
    }
  }
  sync(force = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.collect(force)
      .then(() => this.afterSync())
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  private async collect(force: boolean) {
    const ids = this.db.prepare('SELECT id FROM accounts WHERE ai_secret IS NOT NULL').all() as {
      id: string;
    }[];
    for (const { id } of ids) {
      const account = this.account(id);
      if (!account?.ai_secret || this.stopped) continue;
      if (
        !force &&
        account.ai_last_attempt !== null &&
        this.clock() - account.ai_last_attempt < this.config.pollSeconds * 1000
      )
        continue;
      const started = this.clock();
      this.db.prepare('UPDATE accounts SET ai_last_attempt=? WHERE id=?').run(started, id);
      const devices = this.db
        .prepare(
          `SELECT d.id,d.remote_id,d.measurement_provider FROM devices d JOIN homes h ON h.id=d.home_id
        WHERE h.account_id=? AND d.present=1 AND d.qr_energy_kind='unsupported'
        ORDER BY d.ai_attempt_at ASC,d.id`,
        )
        .all(id) as Device[];
      let error: string | null = null;
      let blocked: string | null = null;
      let key: string;
      let authorized = new Set<string>();
      try {
        key = decrypt<string>(account.ai_secret, this.config.encryptionKey);
        apiRegion(key);
        if (devices.length) authorized = new Set(await this.client.list(key));
      } catch (failure) {
        key = '';
        blocked = safeAiError(failure);
      }
      for (const device of devices) {
        if (!this.current(account)) break;
        if (this.clock() - started > 90000) blocked ??= safeAiError(null);
        if (blocked) {
          error ??= blocked;
          failAiReading(this.db, device.id, blocked, this.clock());
          continue;
        }
        if (!authorized.has(device.remote_id)) {
          if (device.measurement_provider === 'tuya_ai') {
            const message = new TuyaAiError('access').message;
            error ??= message;
            failAiReading(this.db, device.id, message, this.clock());
          }
          continue;
        }
        try {
          // Actual attempts rotate the budget fairly, including repeated failures.
          // Devices skipped at the deadline keep their older priority for the next pass.
          this.db
            .prepare('UPDATE devices SET ai_attempt_at=? WHERE id=?')
            .run(this.clock(), device.id);
          const cached = this.db
            .prepare('SELECT * FROM ai_models WHERE device_id=? AND revision=?')
            .get(device.id, account.ai_revision) as
            { meters: string; fetched_at: number } | undefined;
          let meters: AiMeter[];
          if (cached && this.clock() - cached.fetched_at < MODEL_TTL)
            meters = metersSchema.parse(JSON.parse(cached.meters));
          else {
            meters = metersSchema.parse(await this.client.model(key, device.remote_id));
            if (!this.current(account)) break;
            this.db
              .prepare(
                `INSERT INTO ai_models(device_id,revision,fetched_at,meters) VALUES(?,?,?,?)
              ON CONFLICT(device_id) DO UPDATE SET revision=excluded.revision,fetched_at=excluded.fetched_at,meters=excluded.meters`,
              )
              .run(device.id, account.ai_revision, this.clock(), JSON.stringify(meters));
          }
          if (!meters.length) {
            if (device.measurement_provider === 'tuya_ai') throw new TuyaAiError('counter');
            continue;
          }
          const detail = await this.client.detail(key, device.remote_id);
          if (!this.current(account)) break;
          const reading = readCounter(detail, meters, device.remote_id)!;
          const at = this.clock();
          if (
            ingestAiReading(this.db, id, device.remote_id, reading, account.ai_revision, at) &&
            reading.online
          )
            this.db
              .prepare('UPDATE accounts SET ai_last_success=? WHERE id=? AND ai_revision=?')
              .run(at, id, account.ai_revision);
        } catch (failure) {
          if (!this.current(account)) break;
          const message = safeAiError(failure);
          error ??= message;
          failAiReading(this.db, device.id, message, this.clock());
          if (failure instanceof TuyaAiError && ['rate', 'key'].includes(failure.kind))
            blocked = message;
        }
      }
      if (this.current(account))
        this.db
          .prepare('UPDATE accounts SET ai_error=? WHERE id=? AND ai_revision=?')
          .run(error ?? blocked, id, account.ai_revision);
    }
  }
  start(): void {
    const tick = async () => {
      const started = this.clock();
      try {
        await this.sync();
      } catch {
        /* retry at the next scheduled tick */
      }
      if (!this.stopped)
        this.timer = setTimeout(
          tick,
          Math.max(1000, this.config.pollSeconds * 1000 - (this.clock() - started)),
        );
    };
    void tick();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
