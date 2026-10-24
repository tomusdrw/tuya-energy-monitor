import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPushClient } from '../src/push.js';
import { api } from '../src/api.js';

function browser(permission: NotificationPermission = 'default') {
  let prompts = 0,
    enrollments = 0,
    subscribed = false;
  const calls: { url: string; method: string; body: any }[] = [];
  const receiver = {
    id: 'receiver',
    name: 'Phone',
    language: 'en',
    kinds: ['threshold'],
    enabled: true,
  };
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/wp/x',
    options: { applicationServerKey: Uint8Array.of(1, 2, 3).buffer },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/wp/x', keys: {} }),
    unsubscribe: async () => {
      subscribed = false;
      return true;
    },
  };
  const registration = {
    active: {},
    pushManager: {
      getSubscription: async () => (subscribed ? subscription : null),
      subscribe: async () => {
        enrollments++;
        subscribed = true;
        return subscription;
      },
    },
  };
  const env: any = {
    secure: true,
    supported: true,
    permission: () => permission,
    requestPermission: async () => {
      prompts++;
      permission = 'granted';
      return permission;
    },
    register: async () => registration,
    storage: { getItem: () => null, setItem: () => {} },
    request: async (url: string, method: string, body: any) => {
      calls.push({ url, method, body });
      return { receiver: url === '/push/subscribe' ? receiver : null };
    },
  };
  return {
    env,
    calls,
    client: createPushClient(env),
    counters: () => ({ prompts, enrollments, subscribed }),
    setSubscribed: () => {
      subscribed = true;
    },
  };
}

test('passive reconciliation never asks permission or creates a subscription', async () => {
  const f = browser();
  await f.client.reconcile();
  assert.deepEqual(f.counters(), { prompts: 0, enrollments: 0, subscribed: false });
  const r = await f.client.enable('AQID', { name: 'Phone', language: 'en', kinds: ['threshold'] });
  assert.equal(r.id, 'receiver');
  assert.equal(f.counters().prompts, 1);
  assert.equal(f.counters().enrollments, 1);
  await f.client.enable('AQID', { name: 'Phone', language: 'en', kinds: ['threshold'] });
  assert.equal(f.counters().enrollments, 1);
});

test('denied and insecure browsers do not subscribe; failed save rolls back a new subscription', async () => {
  const denied = browser('denied');
  await assert.rejects(
    () => denied.client.enable('AQID', { name: 'Phone', language: 'en', kinds: [] }),
    /blocked/i,
  );
  assert.equal(denied.counters().prompts, 0);
  const insecure = browser();
  insecure.env.secure = false;
  await assert.rejects(
    () => insecure.client.enable('AQID', { name: 'Phone', language: 'en', kinds: [] }),
    /HTTPS/,
  );
  const fail = browser();
  fail.env.request = async () => {
    throw new Error('network');
  };
  await assert.rejects(
    () => fail.client.enable('AQID', { name: 'Phone', language: 'en', kinds: [] }),
    /network/,
  );
  assert.equal(fail.counters().subscribed, false);
});

test('logout sends endpoint identity before unsubscribing even if local storage is blocked', async () => {
  const f = browser('granted');
  f.setSubscribed();
  f.env.storage = {
    getItem: () => {
      throw new Error();
    },
    setItem: () => {
      throw new Error();
    },
  };
  await f.client.logout();
  assert.equal(f.calls.at(-1)?.url, '/auth/logout');
  assert.equal(f.calls.at(-1)?.body.endpoint, 'https://fcm.googleapis.com/wp/x');
  assert.equal(f.counters().subscribed, false);
});

test('expired-session logout preserves revocation intent through reauthentication and reload', async (t) => {
  const f = browser('granted');
  f.setSubscribed();
  const storage = new Map<string, string>();
  f.env.storage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  t.after(() => {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  let expired = false;
  events.addEventListener('session-expired', () => {
    expired = true;
  });
  let loggedIn = false;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    loggedIn
      ? new Response('{"ok":true}')
      : new Response('{"error":"Authentication required."}', { status: 401 }),
  );
  f.env.request = api;
  await assert.rejects(() => f.client.logout(), /Authentication required/);
  assert.equal(expired, true);
  assert.equal(f.client.hasPendingLogout(), true);
  assert.equal(f.counters().subscribed, true);
  const reloaded = createPushClient(f.env);
  assert.equal(reloaded.hasPendingLogout(), true);
  await reloaded.reconcile();
  assert.equal(fetchMock.mock.callCount(), 1, 'pending logout must not silently reconcile');
  loggedIn = true;
  await reloaded.logout();
  assert.equal(reloaded.hasPendingLogout(), false);
  assert.equal(createPushClient(f.env).hasPendingLogout(), false);
  assert.equal(f.counters().subscribed, false);
});

function worker() {
  const listeners: Record<string, (event: any) => void> = {};
  const shown: any[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const context = {
    URL,
    self: {
      location: { origin: 'https://energy.example' },
      addEventListener: (name: string, handler: any) => {
        listeners[name] = handler;
      },
      skipWaiting: async () => {},
      registration: {
        showNotification: async (...args: any[]) => {
          shown.push(args);
        },
      },
      clients: {
        claim: async () => {},
        matchAll: async () => [
          {
            url: 'https://energy.example/',
            navigate: async (url: string) => {
              navigated.push(url);
              return { focus: async () => {} };
            },
          },
        ],
        openWindow: async (url: string) => {
          opened.push(url);
        },
      },
    },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  const run = async (name: string, extra: any) => {
    let waiting = Promise.resolve();
    listeners[name]({
      ...extra,
      waitUntil: (p: Promise<void>) => {
        waiting = p;
      },
    });
    await waiting;
  };
  return { listeners, shown, opened, navigated, run };
}

test('worker displays once, navigates safely and never installs a private fetch cache', async () => {
  const w = worker();
  assert.equal(w.listeners.fetch, undefined);
  await w.run('push', {
    data: { json: () => ({ title: 'Energy', body: 'Details', tag: 'event', url: '/#home/abc' }) },
  });
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0][1].tag, 'event');
  await w.run('notificationclick', {
    notification: { close: () => {}, data: { url: 'https://evil.example/steal' } },
  });
  assert.equal(w.navigated[0], 'https://energy.example/#alerts');
  await w.run('notificationclick', {
    notification: { close: () => {}, data: { url: '/#home/abc' } },
  });
  assert.equal(w.navigated[1], 'https://energy.example/#home/abc');
});
