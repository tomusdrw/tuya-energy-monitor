import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import { decrypt, encrypt } from './crypto.js';
import { ingestSnapshot } from './energy.js';
import { ingestHeatingSnapshot } from './estimation.js';
import { sessionSchema, type TuyaCall } from './tuya.js';
import type { AccountStream, StreamFactory } from './stream.js';
import { ingestEnergyReport, setEnergyStreamState } from './incremental.js';
import type { TuyaAiIntegration } from './tuya-ai-integration.js';

export class Collector {
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastInventoryAttempt = new Map<string, number>();
  private runningFull = false;
  private fullRequested = false;
  private streams = new Map<string, { secret: string; worker: AccountStream }>();
  afterSync: () => Promise<void> = async () => {};
  constructor(
    private db: DatabaseSync,
    private config: Config,
    private tuya: TuyaCall,
    private clock: () => number = Date.now,
    private streamFactory?: StreamFactory,
    private tuyaAi?: TuyaAiIntegration,
  ) {
    this.db.exec('UPDATE devices SET energy_stream_at=NULL');
  }

  private stream(account: { id: string; secret: string }) {
    if (!this.streamFactory) return undefined;
    let entry = this.streams.get(account.id);
    if (!entry) {
      const session = sessionSchema.parse(decrypt(account.secret, this.config.encryptionKey));
      const worker = this.streamFactory(session, (message) => {
        if (this.stopped) return;
        const current = this.db
          .prepare('SELECT secret FROM accounts WHERE id=?')
          .get(account.id) as { secret: string } | undefined;
        if (
          this.stopped ||
          this.streams.get(account.id) !== entry ||
          current?.secret !== entry?.secret
        )
          return;
        if (message.type === 'session') {
          entry!.secret = encrypt(sessionSchema.parse(message.session), this.config.encryptionKey);
          this.db.prepare('UPDATE accounts SET secret=? WHERE id=?').run(entry!.secret, account.id);
        } else if (message.type === 'energy') {
          ingestEnergyReport(this.db, account.id, message.report, this.clock());
        } else if (
          message.type === 'stream' &&
          typeof message.connected === 'boolean' &&
          Array.isArray(message.deviceIds) &&
          message.deviceIds.length <= 10000 &&
          message.deviceIds.every((id: unknown) => typeof id === 'string')
        ) {
          setEnergyStreamState(
            this.db,
            account.id,
            message.connected,
            this.clock(),
            message.deviceIds,
          );
        }
      });
      entry = { secret: account.secret, worker };
      this.streams.set(account.id, entry);
    }
    return entry;
  }
  get syncing(): boolean {
    return this.running !== null;
  }
  sync(forceFull = true): Promise<void> {
    if (this.stopped) return Promise.resolve();
    void this.tuyaAi?.sync(forceFull).catch(() => {});
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
    const list = this.db.prepare('SELECT id FROM accounts').all() as {
      id: string;
    }[];
    for (const { id } of list) {
      if (this.stopped) break;
      // Other accounts' MQTT callbacks may rotate tokens while a prior read is awaited.
      const account = this.db.prepare('SELECT id,secret FROM accounts WHERE id=?').get(id) as
        { id: string; secret: string } | undefined;
      if (!account) continue;
      const existing = this.streams.get(account.id);
      if (existing && (existing.secret !== account.secret || !existing.worker.alive)) {
        this.streams.delete(account.id);
        setEnergyStreamState(this.db, account.id, false, this.clock());
        await existing.worker.stop();
        if (this.stopped) break;
        const current = this.db.prepare('SELECT secret FROM accounts WHERE id=?').get(id) as
          { secret: string } | undefined;
        if (!current) continue;
        account.secret = current.secret;
        this.lastInventoryAttempt.delete(account.id);
      }
      const full =
        forceFull ||
        this.clock() - (this.lastInventoryAttempt.get(account.id) ?? -Infinity) >=
          this.config.pollSeconds * 1000;
      const requestedIds = (
        this.db
          .prepare(
            `SELECT d.remote_id FROM devices d JOIN homes h ON h.id=d.home_id
        WHERE h.account_id=? AND (d.energy_kind='power' OR
          (d.estimate_enabled=1 AND d.energy_kind NOT IN ('cumulative','incremental')))
          AND d.present=1`,
          )
          .all(account.id) as { remote_id: string }[]
      ).map((d) => d.remote_id);
      if (!full && !requestedIds.length) continue;
      // A broken inventory/specification endpoint must not starve relay polling.
      if (full) this.lastInventoryAttempt.set(account.id, this.clock());
      let activeSecret = account.secret;
      let live: { secret: string; worker: AccountStream } | undefined;
      try {
        const session = sessionSchema.parse(decrypt(account.secret, this.config.encryptionKey));
        live = this.stream(account);
        const response = await (live?.worker.call ?? this.tuya)(full ? 'read' : 'states', {
          ...(live ? {} : { session }),
          ...(full ? {} : { deviceIds: requestedIds }),
        });
        // Ignore responses for credentials reconnected while this request was in flight.
        const current = this.db
          .prepare('SELECT secret FROM accounts WHERE id=?')
          .get(account.id) as { secret: string } | undefined;
        if (!current || current.secret !== (live?.secret ?? account.secret)) continue;
        if (!live && response.session) {
          activeSecret = encrypt(sessionSchema.parse(response.session), this.config.encryptionKey);
          this.db.prepare('UPDATE accounts SET secret=? WHERE id=?').run(activeSecret, account.id);
        }
        if (!response.ok) throw new Error('Cloud read failed');
        const at = this.clock();
        if (full) {
          ingestSnapshot(this.db, account.id, response.snapshot, at);
          if (live) await live.worker.call('subscribe', {});
        } else ingestHeatingSnapshot(this.db, account.id, response.states, requestedIds, at);
      } catch {
        const current = this.db
          .prepare('SELECT secret FROM accounts WHERE id=?')
          .get(account.id) as { secret: string } | undefined;
        if (!current || current.secret !== (live?.secret ?? activeSecret)) continue;
        // Unknown breaks continuity immediately; a successful poll cannot bridge this failure.
        ingestHeatingSnapshot(this.db, account.id, [], requestedIds, this.clock());
        this.db
          .prepare('UPDATE accounts SET error=? WHERE id=?')
          .run(
            'Could not read the account. Sync again; if the problem persists, reconnect the account.',
            account.id,
          );
      }
    }
    await this.afterSync();
  }
  start(): void {
    this.tuyaAi?.start();
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
    await Promise.all([
      ...[...this.streams.values()].map(({ worker }) => worker.stop()),
      this.tuyaAi?.stop(),
    ]);
    this.streams.clear();
    this.db.exec('UPDATE devices SET energy_stream_at=NULL');
    await this.running;
  }
}
