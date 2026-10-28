import { useRef, useState, type FormEvent } from 'react';
import { Pencil, Save, Settings2 } from 'lucide-react';
import type { HomeDetail, Rules } from '../shared/types';
import { api } from './api';
import { Badge, Notice, SectionTitle } from './components';
import { useI18n } from './i18n';
import { messages } from './locales/pages';

export function NotificationRules({
  home,
  onSaved,
}: {
  home: Pick<HomeDetail, 'id' | 'rules'>;
  onSaved: (rules: Rules) => void;
}) {
  const { t, number } = useI18n(messages);
  const [draft, setDraft] = useState<Pick<HomeDetail, 'id' | 'rules'> | null>(null);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const { rules } = home;
  function closeEditor() {
    setDraft(null);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  if (draft)
    return (
      <RulesForm
        home={draft}
        onCancel={closeEditor}
        onSaved={(updated) => {
          onSaved(updated);
          setSaved(true);
          closeEditor();
        }}
      />
    );
  return (
    <section className="panel rules-summary" aria-label={t('Notification rules')}>
      <SectionTitle
        title={t('Notification rules')}
        subtitle={t('Settings for this apartment only')}
      >
        <button
          ref={editButton}
          type="button"
          className="button secondary compact"
          onClick={() => {
            setSaved(false);
            // Polling may update the summary, but must not replace a user's draft.
            setDraft({ id: home.id, rules: { ...home.rules } });
          }}
        >
          <Pencil size={16} aria-hidden="true" />
          {t('Edit')}
        </button>
      </SectionTitle>
      {saved && <Notice>{t('Settings saved.')}</Notice>}
      <div className="rules-summary-grid">
        <article className="rule-card">
          <div className="rule-card-heading">
            <h3>{t('Daily energy threshold')}</h3>
            <Badge tone={rules.dailyLimit === null ? 'muted' : 'success'}>
              {t(rules.dailyLimit === null ? 'Disabled' : 'Enabled')}
            </Badge>
          </div>
          <p className="rule-threshold">
            {rules.dailyLimit === null ? (
              t('No threshold')
            ) : (
              <>
                {number(rules.dailyLimit, 1)} <small>kWh</small>
              </>
            )}
          </p>
          <p className="field-help">
            {t(
              rules.dailyLimit === null
                ? 'Edit rules to set a daily threshold.'
                : 'Alert when daily usage exceeds this threshold, at most once a day.',
            )}
          </p>
        </article>
        <article className="rule-card">
          <div className="rule-card-heading">
            <h3>{t('Detect unusual usage')}</h3>
            <Badge tone={rules.anomalyEnabled ? 'success' : 'muted'}>
              {t(rules.anomalyEnabled ? 'Enabled' : 'Disabled')}
            </Badge>
          </div>
          <dl className="rule-conditions">
            <div>
              <dt>{t('Comparison window (days)')}</dt>
              <dd>{number(rules.windowDays, 0)}</dd>
            </div>
            <div>
              <dt>{t('Increase over average (%)')}</dt>
              <dd>+{number(rules.increasePercent, 0)}%</dd>
            </div>
            <div>
              <dt>{t('Minimum increase (kWh)')}</dt>
              <dd>+{number(rules.increaseKwh, 1)} kWh</dd>
            </div>
          </dl>
          <p className="field-help">
            {t(
              rules.anomalyEnabled
                ? 'Both increase conditions must be met.'
                : 'These conditions are saved but alerts are disabled.',
            )}
          </p>
          <p className="field-help">
            {t(
              'Compares usage at the same time on previous days. Requires at least 7 days with sufficient data.',
            )}
          </p>
        </article>
      </div>
    </section>
  );
}

function RulesForm({
  home,
  onSaved,
  onCancel,
}: {
  home: Pick<HomeDetail, 'id' | 'rules'>;
  onSaved: (rules: Rules) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n(messages);
  const [rules, setRules] = useState<Rules>(home.rules),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const saving = useRef(false);
  const change = (value: Partial<Rules>) => {
    setRules((r) => ({ ...r, ...value }));
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await api(`/homes/${home.id}/rules`, 'PUT', rules);
      onSaved(rules);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="panel rules-form"
      onSubmit={save}
      aria-label={t('Notification rules')}
      aria-busy={busy}
    >
      <SectionTitle
        title={t('Notification rules')}
        subtitle={t('Changes take effect only after saving.')}
      >
        <Settings2 size={21} />
      </SectionTitle>
      {error && <Notice tone="error">{t(error)}</Notice>}
      <fieldset disabled={busy}>
        <div className="rules-grid">
          <div>
            <label>
              {t('Daily energy threshold')} <span className="field-unit">kWh</span>
              <input
                autoFocus
                name="dailyLimit"
                type="number"
                inputMode="decimal"
                min="0.1"
                max="100000"
                step="0.1"
                placeholder={t('No threshold')}
                value={rules.dailyLimit ?? ''}
                onChange={(e) =>
                  change({ dailyLimit: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </label>
            <p className="field-help">
              {t(
                'An email is sent when the threshold is exceeded, at most once a day. Leave blank to disable this alert.',
              )}
            </p>
          </div>
          <div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={rules.anomalyEnabled}
                onChange={(e) => change({ anomalyEnabled: e.target.checked })}
              />
              {t('Detect unusual usage')}
            </label>
            <p className="field-help">
              {t(
                'Compares usage at the same time on previous days. Requires at least 7 days with sufficient data.',
              )}
            </p>
          </div>
        </div>
        <fieldset disabled={!rules.anomalyEnabled} className="anomaly-fields">
          <legend>{t('Anomaly detection conditions')}</legend>
          <label>
            {t('Comparison window (days)')}
            <input
              type="number"
              inputMode="numeric"
              min="7"
              max="90"
              step="1"
              value={rules.windowDays}
              required
              onChange={(e) => change({ windowDays: Number(e.target.value) })}
            />
          </label>
          <label>
            {t('Increase over average (%)')}
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="10000"
              value={rules.increasePercent}
              required
              onChange={(e) => change({ increasePercent: Number(e.target.value) })}
            />
          </label>
          <label>
            {t('Minimum increase (kWh)')}
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              max="100000"
              step="0.1"
              value={rules.increaseKwh}
              required
              onChange={(e) => change({ increaseKwh: Number(e.target.value) })}
            />
          </label>
        </fieldset>
        <div className="form-footer">
          <span role="status" className="saved-message">
            {t('Both increase conditions must be met.')}
          </span>
          <div className="rules-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
              {t('Cancel')}
            </button>
            <button className="button primary" disabled={busy}>
              <Save size={16} />
              {busy ? t('Saving…') : t('Save rules')}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
