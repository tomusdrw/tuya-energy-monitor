import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import { decrypt, encrypt } from './crypto.js';
import { ingestSnapshot } from './energy.js';
import { ingestHeatingSnapshot } from './estimation.js';
import { sessionSchema, type TuyaCall } from './tuya.js';

export class Collector {
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastInventoryAttempt = new Map<string, number>();
  private runningFull = false;
  private fullRequested = false;
  afterSync: () => Promise<void> = async () => {};
  constructor(
    private db: DatabaseSync,
    private config: Config,
    private tuya: TuyaCall,
    private clock: () => number = Date.now,
  ) {}
  get syncing(): boolean {
    return this.running !== null;
  }
  sync(forceFull = true): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      if (forceFull && !this.runningFull) this.fullRequested = true;
      return this.running;
    }
    this.runningFull = forceFull;
    this.running = this.drain(forceFull).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async drain(forceFull: boolean): Promise<void> {
    await this.collect(forceFull);
    if (this.fullRequested && !this.stopped) {
      this.fullRequested = false;
      this.runningFull = true;
      await this.collect(true);
    }
  }
  private async collect(forceFull: boolean): Promise<void> {
    const list = this.db.prepare('SELECT id,secret FROM accounts').all() as {
      id: string;
      secret: string;
    }[];
    for (const account of list) {
      if (this.stopped) break;
      const full =
        forceFull ||
        this.clock() - (this.lastInventoryAttempt.get(account.id) ?? -Infinity) >=
          this.config.pollSeconds * 1000;
      const requestedIds = (
        this.db
          .prepare(
            `SELECT d.remote_id FROM devices d JOIN homes h ON h.id=d.home_id
        WHERE h.account_id=? AND d.estimate_enabled=1 AND d.energy_kind!='cumulative' AND d.present=1`,
          )
          .all(account.id) as { remote_id: string }[]
      ).map((d) => d.remote_id);
      if (!full && !requestedIds.length) continue;
      // A broken inventory/specification endpoint must not starve relay polling.
      if (full) this.lastInventoryAttempt.set(account.id, this.clock());
      let activeSecret = account.secret;
      try {
        const session = sessionSchema.parse(decrypt(account.secret, this.config.encryptionKey));
        const response = await this.tuya(full ? 'read' : 'states', {
          session,
          ...(full ? {} : { deviceIds: requestedIds }),
        });
        // Ignore responses for credentials reconnected while this request was in flight.
        const current = this.db
          .prepare('SELECT secret FROM accounts WHERE id=?')
          .get(account.id) as { secret: string } | undefined;
        if (!current || current.secret !== account.secret) continue;
        if (response.session) {
          activeSecret = encrypt(sessionSchema.parse(response.session), this.config.encryptionKey);
          this.db.prepare('UPDATE accounts SET secret=? WHERE id=?').run(activeSecret, account.id);
        }
        if (!response.ok) throw new Error('Cloud read failed');
        const at = this.clock();
        if (full) {
          ingestSnapshot(this.db, account.id, response.snapshot, at);
        } else ingestHeatingSnapshot(this.db, account.id, response.states, requestedIds, at);
      } catch {
        const current = this.db
          .prepare('SELECT secret FROM accounts WHERE id=?')
          .get(account.id) as { secret: string } | undefined;
        if (!current || current.secret !== activeSecret) continue;
        // Unknown breaks continuity immediately; a successful poll cannot bridge this failure.
        ingestHeatingSnapshot(this.db, account.id, [], requestedIds, this.clock());
        this.db
          .prepare('UPDATE accounts SET error=? WHERE id=?')
          .run(
            'Nie udało się odczytać konta. Ponów synchronizację; jeśli problem trwa, połącz konto ponownie.',
            account.id,
          );
      }
    }
    await this.afterSync();
  }
  start(): void {
    const tick = async () => {
      const started = this.clock();
      try {
        await this.sync(false);
      } catch {
        /* next scheduled tick retries safely */
      }
      if (!this.stopped)
        this.timer = setTimeout(
          tick,
          Math.max(1000, (this.config.statusPollSeconds ?? 60) * 1000 - (this.clock() - started)),
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
