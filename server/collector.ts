import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import { decrypt, encrypt } from './crypto.js';
import { ingestSnapshot } from './energy.js';
import { sessionSchema, type TuyaCall } from './tuya.js';

export class Collector {
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  afterSync: () => Promise<void> = async () => {};
  constructor(private db: DatabaseSync, private config: Config, private tuya: TuyaCall) {}
  get syncing(): boolean { return this.running !== null; }
  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.collect().finally(() => { this.running = null; });
    return this.running;
  }
  private async collect(): Promise<void> {
    const list = this.db.prepare('SELECT id,secret FROM accounts').all() as { id: string; secret: string }[];
    for (const account of list) {
      if (this.stopped) break;
      try {
        const session = sessionSchema.parse(decrypt(account.secret, this.config.encryptionKey));
        const response = await this.tuya('read', { session });
        // Do not replace credentials reconnected while this request was in flight.
        const current = this.db.prepare('SELECT secret FROM accounts WHERE id=?').get(account.id) as { secret: string } | undefined;
        if (!current || current.secret !== account.secret) continue;
        if (response.session) this.db.prepare('UPDATE accounts SET secret=? WHERE id=?')
          .run(encrypt(sessionSchema.parse(response.session), this.config.encryptionKey), account.id);
        if (!response.ok) throw new Error('Cloud read failed');
        ingestSnapshot(this.db, account.id, response.snapshot, Date.now());
      } catch {
        this.db.prepare('UPDATE accounts SET error=? WHERE id=?').run('Nie udało się odczytać konta. Ponów synchronizację; jeśli problem trwa, połącz konto ponownie.', account.id);
      }
    }
    await this.afterSync();
  }
  start(): void {
    const tick = async () => {
      try { await this.sync(); } catch { /* next scheduled tick retries safely */ }
      if (!this.stopped) this.timer = setTimeout(tick, this.config.pollSeconds * 1000);
    };
    void tick();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
