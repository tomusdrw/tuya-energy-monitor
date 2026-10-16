import path from 'node:path';

export interface Config {
  origin: string;
  password: string;
  encryptionKey: Buffer;
  dataDir: string;
  python: string;
  host: string;
  port: number;
  pollSeconds: number;
  statusPollSeconds: number;
  resendKey: string;
  emailFrom: string;
  emailTo: string;
}

export function loadConfig(env = process.env): Config {
  const password = env.ADMIN_PASSWORD ?? '';
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
  const key = env.ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error('ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters.');
  const origin = new URL(env.APP_ORIGIN ?? 'http://localhost:3000');
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('APP_ORIGIN must be an http(s) origin with no path.');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  return {
    origin: origin.origin,
    password,
    encryptionKey: Buffer.from(key, 'hex'),
    dataDir: path.resolve(env.DATA_DIR ?? 'data'),
    python: env.PYTHON_BIN ?? 'python3',
    host: env.HOST ?? '0.0.0.0',
    port,
    pollSeconds: 300,
    statusPollSeconds: 60,
    resendKey: env.RESEND_API_KEY ?? '',
    emailFrom: env.EMAIL_FROM ?? '',
    emailTo: env.EMAIL_TO ?? '',
  };
}
export function emailConfigured(config: Config): boolean {
  return Boolean(config.resendKey && config.emailFrom && config.emailTo);
}
