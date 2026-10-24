import { api } from './api';
import type { PushPreferences, PushReceiver } from '../shared/push';

interface PushEnvironment {
  secure: boolean;
  supported: boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  register(): Promise<ServiceWorkerRegistration>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  request: typeof api;
}
const receiverKey = 'tem-push-receiver';
const logoutKey = 'tem-push-logout-pending';
function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
    char.charCodeAt(0),
  );
}
function matchingKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  return Boolean(
    current &&
    new Uint8Array(current).length === key.length &&
    new Uint8Array(current).every((value, index) => key[index] === value),
  );
}
export function createPushClient(env: PushEnvironment) {
  let remembered: string | undefined;
  let logoutPending = false;
  const hasPendingLogout = () => {
    try {
      return env.storage?.getItem(logoutKey) === 'true' || logoutPending;
    } catch {
      return logoutPending;
    }
  };
  const markLogout = (pending: boolean) => {
    logoutPending = pending;
    try {
      env.storage?.setItem(logoutKey, String(pending));
    } catch {
      /* Keep the recovery intent in memory if persistence is unavailable. */
    }
  };
  let registration: Promise<ServiceWorkerRegistration> | undefined;
  let reconciling: Promise<PushReceiver | null> | undefined;
  const remember = (id: string) => {
    remembered = id;
    try {
      env.storage?.setItem(receiverKey, id);
    } catch {
      /* Session association also identifies this receiver. */
    }
  };
  const id = () => {
    try {
      return env.storage?.getItem(receiverKey) || remembered;
    } catch {
      return remembered;
    }
  };
  const support = () => (!env.secure ? 'insecure' : !env.supported ? 'unsupported' : 'supported');
  const ready = () =>
    (registration ??= env.register().catch((error) => {
      registration = undefined;
      throw error;
    }));
  const subscription = async () => (await ready()).pushManager.getSubscription();
  const reconcile = () => {
    if (support() !== 'supported' || hasPendingLogout()) return Promise.resolve(null);
    return (reconciling ??= (async () => {
      const sub = await subscription();
      const result = await env.request<{ receiver: PushReceiver | null }>(
        '/push/reconcile',
        'POST',
        { subscription: sub?.toJSON() ?? null, receiverId: id() },
      );
      if (result.receiver) remember(result.receiver.id);
      return result.receiver;
    })().finally(() => {
      reconciling = undefined;
    }));
  };
  return {
    support,
    reconcile,
    hasPendingLogout,
    permission: env.permission,
    async enable(publicKey: string, preferences: PushPreferences): Promise<PushReceiver> {
      if (support() === 'insecure')
        throw new Error('Open the application over HTTPS to enable notifications.');
      if (support() === 'unsupported')
        throw new Error(
          'This browser does not support push notifications. On iPhone, open the app from the Home Screen.',
        );
      if (env.permission() === 'denied')
        throw new Error('Notifications are blocked. Allow them in the browser or system settings.');
      // This call occurs before registration/network awaits, preserving the user's gesture.
      const permission = env.permission() === 'granted' ? 'granted' : await env.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const reg = await ready(),
        key = applicationKey(publicKey);
      let sub = await reg.pushManager.getSubscription(),
        created = false;
      if (sub && !matchingKey(sub, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        created = true;
      }
      try {
        const result = await env.request<{ receiver: PushReceiver }>('/push/subscribe', 'POST', {
          subscription: sub.toJSON(),
          receiverId: id(),
          preferences,
        });
        remember(result.receiver.id);
        return result.receiver;
      } catch (error) {
        if (created) await sub.unsubscribe().catch(() => {});
        throw error;
      }
    },
    async disable(receiverId: string): Promise<void> {
      await env.request(`/push/receivers/${receiverId}`, 'DELETE');
      if (support() === 'supported')
        await subscription()
          .then((sub) => sub?.unsubscribe())
          .catch(() => {});
    },
    async logout(): Promise<void> {
      // Keep this intent if authentication expired or the server cannot confirm revocation.
      markLogout(true);
      let sub: PushSubscription | null = null;
      if (support() === 'supported') sub = await subscription().catch(() => null);
      await env.request('/auth/logout', 'POST', { receiverId: id(), endpoint: sub?.endpoint });
      await sub?.unsubscribe().catch(() => {});
      markLogout(false);
    },
  };
}

let client: ReturnType<typeof createPushClient> | undefined;
export function browserPush() {
  if (client) return client;
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    /* Optional; database session association is the fallback. */
  }
  return (client = createPushClient({
    secure: window.isSecureContext,
    supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    permission: () => ('Notification' in window ? Notification.permission : 'denied'),
    requestPermission: () => Notification.requestPermission(),
    register: async () => {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      if (reg.active) return reg;
      return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error('Notification setup timed out. Reload the application and try again.'),
            ),
          10000,
        );
        navigator.serviceWorker.ready.then(
          (active) => {
            clearTimeout(timeout);
            resolve(active);
          },
          (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        );
      });
    },
    storage,
    request: api,
  }));
}
