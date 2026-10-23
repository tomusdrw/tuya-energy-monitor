import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { decrypt } from '../server/crypto.js';
import { loadConfig } from '../server/config.js';
import {
  saveSubscription,
  listReceivers,
  updateReceiver,
  revokeReceiver,
  validateEndpoint,
} from '../server/pushSubscriptions.js';
import { defaultPushKinds } from '../shared/push.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removePushSchema } from './helpers/schema.js';

const curve = createECDH('prime256v1');
curve.generateKeys();
const config = {
  encryptionKey: Buffer.alloc(32, 4),
  vapidPublicKey: curve.getPublicKey().toString('base64url'),
} as any;
const subscription = (suffix = 'one') => ({
  endpoint: `https://fcm.googleapis.com/wp/${suffix}`,
  keys: {
    p256dh: curve.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  },
  expirationTime: null,
});

test('receivers are encrypted, deduplicated and retain independent preferences on reconciliation', () => {
  const db = openDatabase(':memory:');
  try {
    const sub = subscription();
    const a = saveSubscription(
      db,
      config,
      {
        subscription: sub,
        enable: true,
        preferences: { name: 'Phone', language: 'pl', kinds: ['threshold'] },
      },
      10,
    );
    const b = saveSubscription(db, config, { subscription: subscription('two'), enable: true }, 20);
    assert.deepEqual(b.kinds, defaultPushKinds);
    assert.deepEqual(saveSubscription(db, config, { subscription: sub, enable: false }, 30).kinds, [
      'threshold',
    ]);
    assert.equal(listReceivers(db).length, 2);
    assert.ok(!JSON.stringify(listReceivers(db)).includes(sub.endpoint));
    const row = db.prepare('SELECT secret FROM push_receivers WHERE id=?').get(a.id) as any;
    assert.ok(!row.secret.includes(sub.keys.auth));
    assert.deepEqual(decrypt(row.secret, config.encryptionKey), sub);
    updateReceiver(db, b.id, { name: 'Desktop', language: 'en', kinds: ['weekly'] });
    assert.deepEqual(listReceivers(db).find((r) => r.id === a.id)?.kinds, ['threshold']);
    revokeReceiver(db, a.id);
    assert.equal(
      saveSubscription(db, config, { subscription: sub, enable: false }, 40).enabled,
      false,
    );
    const rotated = saveSubscription(
      db,
      config,
      { subscription: subscription('rotated'), receiverId: a.id, enable: true },
      50,
    );
    assert.equal(rotated.id, a.id);
    assert.deepEqual(rotated.kinds, ['threshold']);
    assert.equal(rotated.language, 'pl');
    assert.equal(rotated.enabled, true);
  } finally {
    db.close();
  }
});

test('strict subscription validation rejects hostile destinations, invalid keys and unknown categories', () => {
  const db = openDatabase(':memory:');
  try {
    for (const endpoint of [
      'http://fcm.googleapis.com/wp/x',
      'https://127.0.0.1/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://fcm.googleapis.com:444/x',
      'https://user@fcm.googleapis.com/x',
      'https://updates.push.services.mozilla.com@localhost/x',
      'https://example.com/x',
      'https://fcm.googleapis.com/x#secret',
    ]) {
      assert.throws(() => validateEndpoint(endpoint), endpoint);
    }
    for (const endpoint of [
      'https://fcm.googleapis.com/wp/x',
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://web.push.apple.com/x',
      'https://wns2-bl2p.notify.windows.com/x',
    ])
      assert.doesNotThrow(() => validateEndpoint(endpoint));
    assert.throws(() =>
      saveSubscription(
        db,
        config,
        {
          subscription: subscription(),
          enable: true,
          preferences: { name: 'X', language: 'en', kinds: ['anything'] },
        },
        1,
      ),
    );
    assert.throws(() =>
      saveSubscription(
        db,
        config,
        { subscription: { ...subscription(), keys: { auth: 'bad', p256dh: 'bad' } }, enable: true },
        1,
      ),
    );
    assert.throws(() =>
      saveSubscription(db, config, { subscription: subscription(), enable: false }, 1),
    );
  } finally {
    db.close();
  }
});

test('schema v9 preserves old notification retry data and allows receiver-session association', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-migration-'));
  const file = join(dir, 'db.sqlite');
  let db = openDatabase(file);
  try {
    db.prepare(
      "INSERT INTO notifications(id,kind,title,body,created_at,status,payload) VALUES('old','threshold','Title','Body',1,'retry','unchanged')",
    ).run();
    db.prepare("INSERT INTO sessions(hash,expires) VALUES('session',100)").run();
    removePushSchema(db);
    db.exec('PRAGMA user_version=8');
    db.close();
    db = openDatabase(file);
    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, 9);
    assert.equal((db.prepare('SELECT receiver_id FROM sessions').get() as any).receiver_id, null);
    assert.equal(
      (db.prepare('SELECT payload FROM notifications').get() as any).payload,
      'unchanged',
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('VAPID configuration must be complete and use matching valid keys and contact', () => {
  const env = { ADMIN_PASSWORD: 'long-password-for-tests', ENCRYPTION_KEY: '04'.repeat(32) };
  assert.doesNotThrow(() => loadConfig(env));
  assert.throws(() => loadConfig({ ...env, VAPID_PUBLIC_KEY: config.vapidPublicKey }), /VAPID/);
  const valid = {
    ...env,
    VAPID_PUBLIC_KEY: config.vapidPublicKey,
    VAPID_PRIVATE_KEY: curve.getPrivateKey().toString('base64url'),
    VAPID_SUBJECT: 'mailto:owner@example.com',
  };
  assert.equal(loadConfig(valid).vapidPublicKey, config.vapidPublicKey);
  assert.throws(
    () => loadConfig({ ...valid, VAPID_PRIVATE_KEY: randomBytes(32).toString('base64url') }),
    /VAPID/,
  );
  assert.throws(() => loadConfig({ ...valid, VAPID_SUBJECT: 'http://localhost' }), /VAPID/);
});
