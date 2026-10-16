import { spawn } from 'node:child_process';
import path from 'node:path';
import type { TuyaCall, TuyaSession } from './tuya.js';

export interface AccountStream {
  readonly alive: boolean;
  call: TuyaCall;
  stop(): Promise<void>;
}
export type StreamFactory = (
  session: TuyaSession,
  onMessage: (message: any) => void,
) => AccountStream;

/** A persistent, private JSON-lines pipe. One process owns each account's tokens. */
export class TuyaStream implements AccountStream {
  private child;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private nextId = 0;
  private buffer = '';
  private closed: Promise<void>;
  alive = true;
  constructor(
    session: TuyaSession,
    private onMessage: (message: any) => void,
    python = 'python3',
    script = path.resolve('bridge/stream.py'),
  ) {
    this.child = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.closed = new Promise((resolve) =>
      this.child.once('close', () => {
        this.fail();
        resolve();
      }),
    );
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline;
      while (this.alive && (newline = this.buffer.indexOf('\n')) !== -1) {
        if (newline > 4 * 1024 * 1024) return this.fail();
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === 'response') {
            const pending = this.pending.get(message.id);
            if (!pending) return this.fail();
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            pending.resolve(message.response);
          } else this.onMessage(message);
        } catch {
          this.fail();
        }
      }
      if (this.buffer.length > 4 * 1024 * 1024) this.fail();
    });
    this.child.stderr.resume(); // SDK errors can contain credentials.
    this.child.on('error', () => this.fail());
    this.child.stdin.on('error', () => this.fail());
    this.child.stdin.write(JSON.stringify({ session }) + '\n');
  }

  call: TuyaCall = (operation, payload) => {
    if (!this.alive) return Promise.reject(new Error('Tuya stream closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), 180000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, operation, payload }) + '\n');
    });
  };

  private fail(): void {
    if (!this.alive) return;
    this.alive = false;
    this.child.kill('SIGKILL');
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Tuya stream closed'));
    }
    this.pending.clear();
    this.onMessage({ type: 'stream', connected: false, deviceIds: [] });
  }

  async stop(): Promise<void> {
    this.fail();
    await this.closed;
  }
}
