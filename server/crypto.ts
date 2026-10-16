import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

export function encrypt(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((x) => x.toString('base64')).join('.');
}
export function decrypt<T = unknown>(value: string, key: Buffer): T {
  const [iv, tag, data] = value.split('.').map((x) => Buffer.from(x, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')) as T;
}
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function scopedId(account: string, remote: string): string {
  return digest(JSON.stringify([account, remote])).slice(0, 32);
}
