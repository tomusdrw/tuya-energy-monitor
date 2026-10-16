import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

export const sessionSchema = z.object({
  user_code: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  terminal_id: z.string().min(1).max(256),
  endpoint: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        [
          '.iotbing.com',
          '.tuya.com',
          '.tuyacn.com',
          '.tuyaeu.com',
          '.tuyaus.com',
          '.tuyain.com',
        ].some((suffix) => url.hostname.endsWith(suffix))
      );
    }),
  token_info: z.object({
    t: z.number(),
    uid: z.string(),
    expire_time: z.number(),
    access_token: z.string(),
    refresh_token: z.string(),
  }),
});
export type TuyaSession = z.infer<typeof sessionSchema>;
export type TuyaCall = (operation: string, payload: Record<string, unknown>) => Promise<any>;

export function callTuya(
  operation: string,
  payload: Record<string, unknown>,
  python = 'python3',
): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.resolve('bridge/tuya.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      settled = false;
    const finish = (error?: Error, data?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(data);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Tuya request timed out'));
    }, 180000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 4 * 1024 * 1024) {
        child.kill('SIGKILL');
        finish(new Error('Tuya response too large'));
      }
    });
    child.stderr.resume(); // SDK errors may contain credentials; never forward them to logs.
    child.on('error', () => finish(new Error('Cannot start Tuya adapter')));
    child.stdin.on('error', () => finish(new Error('Tuya adapter input failed')));
    child.on('close', (code) => {
      if (code !== 0) return finish(new Error('Tuya adapter failed'));
      try {
        finish(undefined, JSON.parse(output));
      } catch {
        finish(new Error('Invalid Tuya adapter response'));
      }
    });
    child.stdin.end(JSON.stringify({ operation, ...payload }));
  });
}
