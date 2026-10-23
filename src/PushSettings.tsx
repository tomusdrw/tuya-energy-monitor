import { useEffect, useState, type FormEvent } from 'react';
import { Bell, Send } from 'lucide-react';
import {
  defaultPushKinds,
  pushKinds,
  pushLabels,
  type PushConfigView,
  type PushPreferences,
  type PushReceiver,
} from '../shared/push';
import { api, useApi } from './api';
import { Badge, Loading, Notice, SectionTitle } from './components';
import { useI18n } from './i18n';
import { pushMessages } from './locales/push';
import { browserPush } from './push';

export function PushPreferencesForm({
  initial,
  onSave,
  submitLabel,
  disabled,
}: {
  initial: PushPreferences;
  onSave: (preferences: PushPreferences) => Promise<void>;
  submitLabel: string;
  disabled: boolean;
}) {
  const { t } = useI18n(pushMessages);
  // Keep edits across background polling; a different receiver mounts a keyed form.
  const [preferences, setPreferences] = useState<PushPreferences>(() => ({
    name: initial.name,
    language: initial.language,
    kinds: [...initial.kinds],
  }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave(preferences);
  };
  return (
    <form className="push-preferences" onSubmit={submit}>
      <div className="push-fields">
        <label>
          {t('Device name')}
          <input
            name="receiverName"
            required
            maxLength={80}
            value={preferences.name}
            disabled={disabled}
            onChange={(e) => setPreferences({ ...preferences, name: e.target.value })}
          />
        </label>
        <label>
          {t('Notification language')}
          <select
            value={preferences.language}
            disabled={disabled}
            onChange={(e) =>
              setPreferences({ ...preferences, language: e.target.value as 'en' | 'pl' })
            }
          >
            <option value="en">English</option>
            <option value="pl">Polski</option>
          </select>
        </label>
      </div>
      <fieldset disabled={disabled}>
        <legend>{t('Events to receive')}</legend>
        <div className="push-categories">
          {pushKinds.map((kind) => (
            <label className="check-label" key={kind}>
              <input
                type="checkbox"
                checked={preferences.kinds.includes(kind)}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    kinds: e.target.checked
                      ? [...preferences.kinds, kind]
                      : preferences.kinds.filter((k) => k !== kind),
                  })
                }
              />
              <span>{t(pushLabels[kind])}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button className="button primary" disabled={disabled || !preferences.name.trim()}>
        {t(submitLabel)}
      </button>
    </form>
  );
}

export function PushSettings() {
  const { t, language, date } = useI18n(pushMessages);
  const config = useApi<PushConfigView>('/push/config');
  const devices = useApi<{ receivers: PushReceiver[]; currentReceiverId: string | null }>(
    '/push/receivers',
  );
  const [currentId, setCurrentId] = useState<string | null>(null),
    [snapshot, setSnapshot] = useState<PushReceiver | null>(null);
  const [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(true);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [capability, setCapability] = useState('supported'),
    [permission, setPermission] = useState<NotificationPermission>('default');
  useEffect(() => {
    let live = true;
    const reconcile = async () => {
      const client = browserPush();
      if (live) {
        setCapability(client.support());
        setPermission(client.permission());
      }
      try {
        const receiver = await client.reconcile();
        if (live && receiver) {
          setCurrentId(receiver.id);
          setSnapshot(receiver);
          devices.refresh();
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setSyncing(false);
      }
    };
    void reconcile();
    window.addEventListener('focus', reconcile);
    return () => {
      live = false;
      window.removeEventListener('focus', reconcile);
    };
  }, [devices.refresh]);
  const id = currentId ?? devices.data?.currentReceiverId;
  const current = devices.data?.receivers.find((r) => r.id === id) ?? snapshot;
  async function act(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      devices.refresh();
      setMessage(success);
    } catch (e) {
      setError(
        e instanceof DOMException
          ? 'Could not enable notifications. Check browser permissions and try again.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      setPermission(browserPush().permission());
    }
  }
  const status = (receiver: PushReceiver) =>
    t(
      receiver.state === 'active'
        ? 'Enabled'
        : receiver.state === 'expired'
          ? 'Subscription expired'
          : 'Disabled',
    );
  const canEnable = Boolean(
    config.data?.configured &&
    config.data.publicKey &&
    capability === 'supported' &&
    permission !== 'denied',
  );
  const others = devices.data?.receivers.filter((r) => r.id !== id) ?? [];
  return (
    <section className="panel push-settings">
      <SectionTitle
        title={t('Notifications on this device')}
        subtitle={t('Choose what this phone or browser receives.')}
      >
        <Bell size={23} />
      </SectionTitle>
      {(error || config.error || devices.error) && (
        <Notice tone="error">{t(error || config.error || devices.error)}</Notice>
      )}
      {message && (
        <p className="saved-message" role="status">
          {t(message)}
        </p>
      )}
      {!config.data || !devices.data || syncing ? (
        <Loading />
      ) : (
        <>
          <Badge tone={current?.enabled ? 'success' : 'muted'}>
            {current ? status(current) : t('Disabled')}
          </Badge>
          {capability === 'insecure' && (
            <Notice>{t('Open the application over HTTPS to enable notifications.')}</Notice>
          )}
          {capability === 'unsupported' && (
            <Notice>
              {t(
                'This browser does not support push notifications. On iPhone, open the app from the Home Screen.',
              )}
            </Notice>
          )}
          {capability === 'supported' && permission === 'denied' && (
            <Notice tone="warning">
              {t('Notifications are blocked. Allow them in the browser or system settings.')}
            </Notice>
          )}
          {!config.data.configured && (
            <Notice>
              {t('Push notifications are not configured on the server.')}{' '}
              {t(
                'Configure the VAPID keys and contact on the server, then restart the application.',
              )}
            </Notice>
          )}
          {current?.error && <Notice tone="warning">{t(current.error)}</Notice>}
          <PushPreferencesForm
            key={current?.id ?? `new-${language}`}
            initial={current ?? { name: t('This device'), language, kinds: [...defaultPushKinds] }}
            disabled={busy || (!current?.enabled && !canEnable)}
            submitLabel={current?.enabled ? 'Save preferences' : 'Enable notifications'}
            onSave={(preferences) =>
              act(
                async () => {
                  const receiver = current?.enabled
                    ? (
                        await api<{ receiver: PushReceiver }>(
                          `/push/receivers/${current.id}`,
                          'PUT',
                          preferences,
                        )
                      ).receiver
                    : await browserPush().enable(config.data!.publicKey!, preferences);
                  setCurrentId(receiver.id);
                  setSnapshot(receiver);
                },
                current?.enabled ? 'Preferences saved.' : 'Notifications enabled.',
              )
            }
          />
          {current?.enabled && (
            <div className="button-row push-actions">
              <button
                className="button"
                disabled={busy || !config.data.configured}
                onClick={() =>
                  void act(async () => {
                    await api(`/push/receivers/${current.id}/test`, 'POST', {});
                  }, 'Test notification queued. Delivery depends on browser and system settings.')
                }
              >
                <Send size={16} />
                {t('Send test notification')}
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await browserPush().disable(current.id);
                    setSnapshot({ ...current, enabled: false, state: 'disabled' });
                  }, 'Notifications disabled.')
                }
              >
                {t('Disable on this device')}
              </button>
            </div>
          )}
          <p className="field-help">
            {t(
              'Preferences apply to all monitored apartments. Other devices keep their own choices.',
            )}
          </p>
          <p className="field-help">
            {t('Problems are confirmed after 15 minutes; recovery after 5 minutes.')}
          </p>
          <p className="field-help">
            {t(
              'On iPhone or iPad, add the app to the Home Screen and open it there before enabling notifications.',
            )}
          </p>
          <p className="field-help">
            {t('Signing out disables notifications on this device. Closing the app does not.')}
          </p>
          <h3>{t('Other notification devices')}</h3>
          {!others.length && <p className="field-help">{t('No other devices registered.')}</p>}
          {others.map((receiver) => (
            <article className="push-receiver" key={receiver.id}>
              <div className="push-receiver-heading">
                <strong>{receiver.name}</strong>
                <Badge tone={receiver.enabled ? 'success' : 'muted'}>{status(receiver)}</Badge>
              </div>
              {receiver.lastSubmittedAt && (
                <p className="field-help">
                  {t('Last submitted: {time}', { time: date(receiver.lastSubmittedAt) })}
                </p>
              )}
              {receiver.error && <Notice tone="warning">{t(receiver.error)}</Notice>}
              <details>
                <summary>{t('Edit preferences')}</summary>
                <PushPreferencesForm
                  initial={receiver}
                  disabled={busy}
                  submitLabel="Save preferences"
                  onSave={(preferences) =>
                    act(async () => {
                      await api(`/push/receivers/${receiver.id}`, 'PUT', preferences);
                    }, 'Preferences saved.')
                  }
                />
              </details>
              {receiver.enabled && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(`/push/receivers/${receiver.id}`, 'DELETE');
                    }, 'Notifications disabled.')
                  }
                >
                  {t('Disable device')}
                </button>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}

export function EmailDeliverySwitch({
  enabled,
  onSaved,
}: {
  enabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useI18n(pushMessages);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function change(value: boolean) {
    setBusy(true);
    setError('');
    try {
      await api('/settings/email', 'PUT', { enabled: value });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="push-email-switch">
      <label className="check-label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
        />
        <span>{t('Email notifications enabled')}</span>
      </label>
      <p className="field-help">
        {t('This switch applies to the whole instance. Push preferences stay independent.')}
      </p>
      {error && <Notice tone="error">{t(error)}</Notice>}
    </div>
  );
}
