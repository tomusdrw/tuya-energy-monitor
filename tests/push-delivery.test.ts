import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushConfig, pushFixture } from './helpers/push.js';
import { enqueueNotification, setEmailEnabled } from '../server/notificationEvents.js';
import { deliverPushPending, isPublicAddress } from '../server/pushDelivery.js';
import { revokeReceiver, updateReceiver } from '../server/pushSubscriptions.js';
import { deliverPending } from '../server/notifications.js';

function event(f: ReturnType<typeof pushFixture>, id = 'one', kind = 'threshold') {
  enqueueNotification(f.db, {
    id,
    homeId: null,
    kind: kind as any,
    now: f.now,
    content: (language) => ({
      title: language === 'pl' ? 'Próg energii' : 'Energy threshold',
      body: `${language}: ${'🙂'.repeat(3000)}`,
    }),
  });
}
const rows = (f: ReturnType<typeof pushFixture>) =>
  f.db.prepare('SELECT * FROM push_deliveries ORDER BY receiver_id,event_id').all() as any[];

test('event fanout is atomic, filtered, localized and byte bounded, and never backfills', () => {
  const f = pushFixture();
  try {
    f.receiver('phone', ['threshold'], 'pl');
    f.receiver('desktop', ['weekly']);
    event(f);
    assert.equal(rows(f).length, 1);
    assert.equal(JSON.parse(rows(f)[0].payload).title, 'Próg energii');
    assert.ok(Buffer.byteLength(rows(f)[0].payload) <= 3000);
    f.receiver('new');
    event(f);
    assert.equal(rows(f).length, 1);
    assert.throws(() =>
      enqueueNotification(f.db, {
        id: 'bad',
        kind: 'threshold',
        homeId: null,
        now: f.now,
        content: () => {
          throw new Error('render');
        },
      }),
    );
    assert.equal(f.db.prepare("SELECT id FROM notifications WHERE id='bad'").get(), undefined);
  } finally {
    f.db.close();
  }
});

test('push retries freeze payloads, expire invalid endpoints and continue for healthy recipients', async () => {
  const f = pushFixture();
  try {
    f.receiver('bad');
    f.receiver('good');
    f.receiver('retry');
    event(f);
    const payloads: string[] = [];
    await deliverPushPending(f.db, pushConfig, f.now, async (sub, payload) => {
      if (sub.endpoint.endsWith('/bad')) throw { statusCode: 410 };
      if (sub.endpoint.endsWith('/retry')) {
        payloads.push(payload);
        throw { statusCode: 429, headers: { 'retry-after': '600' } };
      }
    });
    assert.deepEqual(
      rows(f)
        .map((r) => r.status)
        .sort(),
      ['cancelled', 'retry', 'submitted'],
    );
    assert.equal(
      f.db.prepare("SELECT state FROM push_receivers WHERE name='bad'").get()?.state,
      'expired',
    );
    const retry = rows(f).find((r) => r.status === 'retry');
    assert.ok(retry.next_attempt >= f.now + 600000);
    await deliverPushPending(f.db, pushConfig, f.now + 600000, async (_sub, payload) => {
      payloads.push(payload);
    });
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0], payloads[1]);
    assert.equal(rows(f).filter((r) => r.status === 'submitted').length, 2);
  } finally {
    f.db.close();
  }
});

test('delivery observes category cancellation, deadline and receiver revocation during batches', async () => {
  const f = pushFixture();
  try {
    const a = f.receiver('a');
    event(f, 'old');
    let calls = 0;
    await deliverPushPending(f.db, pushConfig, f.now + 86400000, async () => {
      calls++;
    });
    assert.equal(calls, 0);
    assert.equal(rows(f)[0].status, 'expired');
    event(f, 'next');
    event(f, 'last');
    await deliverPushPending(f.db, pushConfig, f.now, async () => {
      calls++;
      revokeReceiver(f.db, a.id);
    });
    assert.equal(calls, 1);
    assert.equal(rows(f).filter((r) => r.status === 'pending').length, 0);
    const b = f.receiver('b');
    event(f, 'change');
    updateReceiver(f.db, b.id, { name: 'b', language: 'en', kinds: [] });
    assert.equal(rows(f).find((r) => r.receiver_id === b.id)?.status, 'cancelled');
  } finally {
    f.db.close();
  }
});

test('bounded batches fairly include receivers with a small backlog', async () => {
  const f = pushFixture();
  try {
    f.receiver('big');
    for (let i = 0; i < 25; i++) event(f, `backlog-${i}`);
    f.receiver('small');
    event(f, 'latest');
    const targets: string[] = [];
    await deliverPushPending(f.db, pushConfig, f.now, async (s) => {
      targets.push(s.endpoint);
    });
    assert.ok(targets.some((t) => t.endsWith('/small')));
    assert.equal(targets.length, 20);
  } finally {
    f.db.close();
  }
});

test('email switch cancels outstanding work and reenabling does not replay skipped or operational events', async () => {
  const f = pushFixture();
  try {
    event(f, 'old');
    f.db.exec("UPDATE notifications SET payload='frozen',first_attempt=1,status='retry'");
    setEmailEnabled(f.db, false);
    assert.equal(f.db.prepare('SELECT payload FROM notifications').get()?.payload, 'frozen');
    event(f, 'off');
    event(f, 'operational', 'account_problem');
    setEmailEnabled(f.db, true);
    let calls = 0;
    await deliverPending(f.db, pushConfig, f.now, async () => {
      calls++;
      return new Response('{}');
    });
    assert.equal(calls, 0);
    assert.ok(
      (f.db.prepare('SELECT status FROM notifications').all() as any[]).every(
        (r) => r.status === 'skipped',
      ),
    );
  } finally {
    f.db.close();
  }
});

test('transport rejects local, mapped, reserved and non-global DNS answers', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111'])
    assert.equal(isPublicAddress(ip), true, ip);
});
