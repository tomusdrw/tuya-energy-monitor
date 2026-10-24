import { createECDH, randomBytes } from 'node:crypto';
import { openDatabase } from '../../server/db.js';
import { saveSubscription } from '../../server/pushSubscriptions.js';
import type { Config } from '../../server/config.js';
import type { PushKind } from '../../shared/push.js';

const curve = createECDH('prime256v1');
curve.generateKeys();
export const pushConfig: Config = {
  origin: 'http://localhost:3000',
  password: 'password-long-for-tests',
  encryptionKey: Buffer.alloc(32, 9),
  dataDir: '/tmp',
  python: 'python3',
  host: '127.0.0.1',
  port: 3000,
  pollSeconds: 300,
  statusPollSeconds: 60,
  resendKey: 'fake',
  emailFrom: 'owner@example.com',
  emailTo: 'owner@example.com',
  vapidPublicKey: curve.getPublicKey().toString('base64url'),
  vapidPrivateKey: curve.getPrivateKey().toString('base64url'),
  vapidSubject: 'mailto:owner@example.com',
};
export const makeSubscription = (id = 'one') => ({
  endpoint: `https://fcm.googleapis.com/wp/${id}`,
  keys: {
    p256dh: curve.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  },
  expirationTime: null,
});
export function pushFixture() {
  const db = openDatabase(':memory:');
  const now = Date.parse('2026-10-23T10:00:00Z');
  const receiver = (id: string, kinds: PushKind[] = ['threshold'], language: 'en' | 'pl' = 'en') =>
    saveSubscription(
      db,
      pushConfig,
      {
        subscription: makeSubscription(id),
        enable: true,
        preferences: { name: id, kinds, language },
      },
      now,
    );
  return { db, now, receiver };
}
