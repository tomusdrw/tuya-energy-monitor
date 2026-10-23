import { useState, type FormEvent } from 'react';
import type { AccountView } from '../shared/types';
import { api } from './api';
import { Badge, Notice } from './components';
import { useI18n } from './i18n';
import { messages } from './locales/tuyaAi';

export function TuyaAiForm({
  account,
  onSaved,
}: {
  account: Pick<AccountView, 'id' | 'tuyaAi'>;
  onSaved: () => void;
}) {
  const { t, date, number } = useI18n(messages);
  const ai = account.tuyaAi;
  const [editing, setEditing] = useState(!ai.configured);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/accounts/${account.id}/tuya-ai`, 'PUT', { key: key.trim() });
      setEditing(false);
      setMessage('Tuya.ai key saved. Energy collection will start automatically.');
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setKey('');
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/accounts/${account.id}/tuya-ai`, 'DELETE');
      setKey('');
      setEditing(true);
      setMessage('Key removed. Recorded energy history is preserved.');
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tuya-ai-form" aria-label={t('Optional Tuya.ai integration')}>
      <div className="tuya-ai-heading">
        <h3>
          Tuya.ai <small>{t('optional')}</small>
        </h3>
        <Badge tone={ai.error ? 'danger' : ai.healthy ? 'success' : 'warning'}>
          {!ai.configured
            ? t('Not configured')
            : ai.error
              ? t('Needs attention')
              : ai.healthy
                ? t('Current readings')
                : ai.lastSuccess
                  ? t('Stale readings')
                  : t('Waiting for a confirmed counter')}
        </Badge>
      </div>
      <p className="field-help">
        {t(
          'Adds confirmed energy meters unavailable through QR. Usage is collected from the start of observation; Smart Life history is not imported.',
        )}
      </p>
      <p className="field-help">
        {t('Last successful reading')}: {date(ai.lastSuccess)}
        {ai.configured && (
          <>
            {' '}
            · {t('Meters: {count}', { count: number(ai.meteredDevices, 0) })} · {ai.region}
          </>
        )}
      </p>
      {ai.error && <Notice tone="error">{t(ai.error)}</Notice>}
      {error && <Notice tone="error">{t(error)}</Notice>}
      {message && (
        <p role="status" className="saved-message">
          {t(message)}
        </p>
      )}
      {editing ? (
        <form onSubmit={save}>
          <label>
            {t('Tuya.ai API key')}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              required
              maxLength={512}
              disabled={busy}
            />
          </label>
          <p className="field-help">
            <a href="https://tuya.ai/developer" target="_blank" rel="noreferrer">
              {t('Get a key for this Smart Life account')}
            </a>
          </p>
          <div className="tuya-ai-actions">
            <button className="button primary compact" disabled={busy}>
              {busy ? t('Checking…') : t('Check and save')}
            </button>
            {ai.configured && (
              <button
                type="button"
                className="button secondary compact"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setKey('');
                  setError('');
                }}
              >
                {t('Cancel')}
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="tuya-ai-actions">
          <button
            className="button secondary compact"
            disabled={busy}
            onClick={() => {
              setEditing(true);
              setKey('');
              setMessage('');
            }}
          >
            {t('Change')}
          </button>
          <button
            className="button secondary compact"
            disabled={busy}
            onClick={() => void remove()}
          >
            {t('Remove')}
          </button>
        </div>
      )}
    </section>
  );
}
