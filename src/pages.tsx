import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Link2,
  Plus,
  ShieldCheck,
  Mail,
  Clock3,
  Settings2,
  Save,
} from 'lucide-react';
import type {
  AccountView,
  DeviceDetail,
  HomeDetail,
  HomeView,
  NotificationView,
  Rules,
  SettingsView,
} from '../shared/types';
import { api, useApi } from './api';
import { EstimationForm } from './EstimationForm';
import { TuyaAiForm } from './TuyaAiForm';
import { DeviceList } from './DeviceList';
import { HomeSwitcher } from './HomeSwitcher';
import { ClimateHistory, ClimateSummaryCards, DeviceClimate } from './Climate';
import { useI18n } from './i18n';
import { messages } from './locales/pages';
import {
  AlertList,
  Badge,
  Coverage,
  Empty,
  EnergyChart,
  EnergyBreakdown,
  Loading,
  Notice,
  PageTitle,
  Range,
  SectionTitle,
} from './components';

function RulesForm({ home, onSaved }: { home: HomeDetail; onSaved: () => void }) {
  const { t } = useI18n(messages);
  const [rules, setRules] = useState<Rules>(home.rules),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const change = (value: Partial<Rules>) => {
    setRules((r) => ({ ...r, ...value }));
    setSaved(false);
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/homes/${home.id}/rules`, 'PUT', rules);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel rules-form" onSubmit={save}>
      <SectionTitle
        title={t('Notification rules')}
        subtitle={t('Settings for this apartment only')}
      >
        <Settings2 size={21} />
      </SectionTitle>
      {error && <Notice tone="error">{t(error)}</Notice>}
      <div className="rules-grid">
        <div>
          <label>
            {t('Daily energy threshold')} <span className="field-unit">kWh</span>
            <input
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
          {saved ? t('Settings saved.') : t('Both increase conditions must be met.')}
        </span>
        <button className="button primary" disabled={busy}>
          <Save size={16} />
          {busy ? t('Saving…') : t('Save rules')}
        </button>
      </div>
    </form>
  );
}

export function HomePage({
  id,
  homes,
  onMonitoringChanged,
}: {
  id: string;
  homes: HomeView[];
  onMonitoringChanged?: () => void;
}) {
  const { t, number, percent, energyNumber } = useI18n(messages);
  const [days, setDays] = useState(14),
    { data, error, refresh } = useApi<HomeDetail>(`/homes/${id}?days=${days}`);
  const home = data?.id === id ? data : null;
  const selectedHome = home ?? homes.find((item) => item.id === id);
  return (
    <>
      <a className="back-link" href="#homes">
        <ArrowLeft size={16} />
        {t('Apartments')}
      </a>
      <PageTitle
        title={selectedHome?.name ?? t('Apartments')}
        titleControl={
          homes.length > 1 && homes.some((item) => item.id === id) ? (
            <HomeSwitcher id={id} homes={homes} />
          ) : undefined
        }
        subtitle={
          selectedHome
            ? t('{account} · Devices: {count}', {
                account: selectedHome.accountLabel,
                count: number(selectedHome.deviceCount, 0),
              })
            : ''
        }
      >
        {home && !error && (
          <Badge tone={home.stats.complete ? 'success' : 'warning'}>
            {home.stats.complete ? t('Current readings') : t('Incomplete readings')}
          </Badge>
        )}
      </PageTitle>
      {error ? (
        <Notice tone="error">{t(error)}</Notice>
      ) : !home ? (
        <Loading />
      ) : (
        <>
          <div className="stats-grid three">
            <div className="stat featured">
              <span>{t('Observed today')}</span>
              <strong>
                {energyNumber(home.stats)} <small>kWh</small>
              </strong>
              <EnergyBreakdown stats={home.stats} />
              <Coverage stats={home.stats} />
            </div>
            <div className="stat">
              <span>{t('Daily threshold')}</span>
              <strong>
                {number(home.rules.dailyLimit, 1)} <small>kWh</small>
              </strong>
              <p>
                {home.rules.dailyLimit === null
                  ? t('Set a threshold below')
                  : t('Individual apartment limit')}
              </p>
            </div>
            <div className="stat">
              <span>{t('Reading coverage')}</span>
              <strong>{percent(home.stats.coverage)}</strong>
              <p>{t('Since midnight, for selected devices')}</p>
            </div>
          </div>
          {!home.stats.complete && (
            <Notice tone="warning">
              {t(
                'This total is partial. It includes meter readings, consumption calculated from power and enabled estimates. Reading gaps and devices without an energy source remain missing data.',
              )}
            </Notice>
          )}
          <ClimateSummaryCards climate={home.climate} />
          <div className="panel">
            <SectionTitle title={t('Climate history')}>
              <Range days={days} setDays={setDays} />
            </SectionTitle>
            <ClimateHistory points={home.climateHistory} />
          </div>
          <div className="panel">
            <SectionTitle title={t('Apartment history')}>
              <Range days={days} setDays={setDays} />
            </SectionTitle>
            <EnergyChart points={home.history} />
          </div>
          <div className="panel">
            <SectionTitle
              title={t('Devices')}
              subtitle={t(
                'Choose which devices count toward the apartment total and alerts. Open a device to see its history.',
              )}
            />
            <DeviceList
              devices={home.devices}
              onSaved={() => {
                refresh();
                onMonitoringChanged?.();
              }}
            />
          </div>
          <RulesForm key={home.id} home={home} onSaved={refresh} />
        </>
      )}
    </>
  );
}

export function DevicePage({ id }: { id: string }) {
  const { t, number, date, percent, energyNumber } = useI18n(messages);
  const [days, setDays] = useState(14),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const { data: device, error, refresh } = useApi<DeviceDetail>(`/devices/${id}?days=${days}`);
  if (error) return <Notice tone="error">{t(error)}</Notice>;
  if (!device) return <Loading />;
  async function toggle(included: boolean) {
    setBusy(true);
    setNotice('');
    try {
      await api(`/devices/${id}`, 'PUT', { included });
      refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a href={`#home/${device.homeId}`} className="back-link">
        <ArrowLeft size={16} />
        {device.homeName}
      </a>
      <PageTitle
        title={device.name}
        subtitle={t('{home} · last cloud reading: {date}', {
          home: device.homeName,
          date: date(device.lastSeen),
        })}
      >
        <Badge tone={device.fresh ? 'success' : 'warning'}>
          {device.fresh ? t('Online') : t('Offline or stale readings')}
        </Badge>
      </PageTitle>
      {notice && <Notice tone="error">{t(notice)}</Notice>}
      <div className="stats-grid three">
        <div className="stat featured">
          <span>{t('Observed today')}</span>
          <strong>
            {energyNumber(device.stats)} <small>kWh</small>
          </strong>
          <EnergyBreakdown stats={device.stats} />
          <p>{t('{coverage} time coverage', { coverage: percent(device.stats.coverage) })}</p>
        </div>
        <div className="stat">
          <span>
            {device.energySource === 'power'
              ? t('Current power')
              : device.energyKind === 'incremental'
                ? t('Report reception')
                : t('Meter reading')}
          </span>
          {device.energySource === 'power' ? (
            <>
              <strong>
                {number(device.powerW, 1)} <small>W</small>
              </strong>
              <p>{t('Reading provided by the device')}</p>
            </>
          ) : device.energyKind === 'incremental' ? (
            <>
              <strong>{device.reportingConnected ? t('Connected') : t('Disconnected')}</strong>
              <p>{t('Last report: {date}', { date: date(device.lastEnergyReport) })}</p>
            </>
          ) : (
            <>
              <strong>
                {number(device.counterKwh, 3)} <small>kWh</small>
              </strong>
              <p>{t("The device's cumulative meter, not daily usage")}</p>
            </>
          )}
        </div>
        <div className="stat">
          <span>{t('Current conditions')}</span>
          <DeviceClimate device={device} detailed />
        </div>
      </div>
      {device.measurementProvider && (
        <Notice tone={device.fresh ? undefined : 'warning'}>
          {t('Measurement source: {source} · last reading: {date}', {
            source: device.measurementProvider === 'tuya_ai' ? 'Tuya.ai' : 'QR',
            date: date(device.measurementAt),
          })}
          {device.measurementProvider === 'tuya_ai' && (
            <>
              {' '}
              {t(
                'The first reading is a baseline. Usage is calculated from subsequent valid readings; earlier Smart Life history is not imported.',
              )}
            </>
          )}
          {device.measurementError && <> {t(device.measurementError)}</>}
        </Notice>
      )}
      {device.energyKind === 'incremental' && (
        <Notice tone={device.reportingConnected ? undefined : 'warning'}>
          {t(
            'We add up energy reports received live. Repeated copies of the same report do not increase usage. Interruptions can leave gaps; earlier reports are not recovered. Point reports do not establish time coverage, so the total remains partial.',
          )}
          {device.lastEnergyReport === null && <> {t('Waiting for the first energy report.')}</>}
        </Notice>
      )}
      {device.energySource === 'missing' && (
        <Notice tone="warning">
          {t(
            'The current Tuya connection does not provide an energy meter for this device. You can configure estimation below using a heating signal or current and target temperatures.',
          )}
        </Notice>
      )}
      <div className="panel">
        <SectionTitle title={t('Device history')}>
          <Range days={days} setDays={setDays} />
        </SectionTitle>
        <EnergyChart points={device.history} />
      </div>
      <div className="panel">
        <SectionTitle
          title={t('Monitoring participation')}
          subtitle={t('Include devices that heat the apartment.')}
        />
        {device.ignored && (
          <Notice>
            {t('This device is ignored. Enabling monitoring also restores it to the device list.')}
          </Notice>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={device.included}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {t('Include in apartment total and alert rules')}
        </label>
        <p className="field-help">
          {t(
            'A device without readings is marked as a missing part of the total. Changing the selection also recalculates history for the current set of devices.',
          )}
        </p>
      </div>
      <EstimationForm key={device.id} device={device} onSaved={refresh} />
    </>
  );
}

export function AccountsPage() {
  const { t, number, date } = useI18n(messages);
  const { data, error, refresh } = useApi<AccountView[]>('/accounts');
  const [form, setForm] = useState(false),
    [label, setLabel] = useState(''),
    [code, setCode] = useState(''),
    [accountId, setAccountId] = useState<string>();
  const [flow, setFlow] = useState<{ id: string; image: string; expires: number } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failure, setFailure] = useState('');
  function open(account?: AccountView) {
    setForm(true);
    setLabel(account?.label ?? '');
    setAccountId(account?.id);
    setCode('');
    setFlow(null);
    setFailure('');
    setMessage('');
  }
  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      setFlow(await api('/accounts/connect', 'POST', { label, userCode: code.trim(), accountId }));
      setCode('');
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setFailure('');
    try {
      await api(`/accounts/connect/${flow!.id}/confirm`, 'POST', {});
      setFlow(null);
      setForm(false);
      setMessage('Account connected. Apartments and devices will appear after synchronization.');
      refresh();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title={t('Connected accounts')}
        subtitle={t('All your Tuya and Smart Life accounts in one dashboard.')}
      >
        <button className="button primary" onClick={() => open()}>
          <Plus size={18} />
          {t('Add account')}
        </button>
      </PageTitle>
      {error && <Notice tone="error">{t(error)}</Notice>}
      {message && <Notice>{t(message)}</Notice>}
      {form && (
        <section className="panel connect-panel">
          <SectionTitle
            title={accountId ? t('Reconnect account') : t('Add a Tuya / Smart Life account')}
          >
            <button
              className="button secondary compact"
              disabled={busy}
              onClick={() => setForm(false)}
            >
              {t('Close')}
            </button>
          </SectionTitle>
          {failure && <Notice tone="error">{t(failure)}</Notice>}
          {!flow ? (
            <form onSubmit={start}>
              <div className="form-two">
                <label>
                  {t('Account name')}
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t('e.g. Apartments')}
                    required
                    maxLength={80}
                  />
                </label>
                <label>
                  {t('User code')}
                  <input
                    type="password"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    required
                    maxLength={128}
                  />
                </label>
              </div>
              <p className="field-help">
                {t('Find the code in the app: Me → Settings → Account and Security → User Code.')}
              </p>
              <button className="button primary" disabled={busy}>
                {busy ? t('Generating…') : t('Show QR code')}
              </button>
            </form>
          ) : (
            <div className="qr-layout">
              <img
                src={flow.image}
                alt={t('QR code for connecting a Tuya account')}
                width={260}
                height={260}
              />
              <div>
                <h3>{t('Approve the connection on your phone')}</h3>
                <ol>
                  <li>{t('Open Tuya or Smart Life with the correct account.')}</li>
                  <li>{t('Choose + → Scan and scan the code.')}</li>
                  <li>{t('Approve the connection, then check it below.')}</li>
                </ol>
                <p className="field-help">
                  {t(
                    'The consent screen may show Home Assistant because we use the same sign-in mechanism. The QR code expires after 5 minutes.',
                  )}
                </p>
                <p className="field-help">
                  {t(
                    'Using this phone? Display the QR code on another screen, then scan it with Tuya or Smart Life on your phone.',
                  )}
                </p>
                <div className="button-row">
                  <button className="button primary" disabled={busy} onClick={confirm}>
                    {busy ? t('Checking…') : t("I've approved it — check")}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setFlow(null)}
                  >
                    {t('New QR code')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
      {data === null ? (
        <Loading />
      ) : data.length ? (
        <div className="account-grid">
          {data.map((a) => (
            <article className="panel account-card" key={a.id}>
              <div className="account-top">
                <span className="account-icon">
                  <Link2 size={23} />
                </span>
                <Badge tone={a.error ? 'danger' : a.healthy ? 'success' : 'warning'}>
                  {a.error
                    ? t('Needs attention')
                    : a.healthy
                      ? t('Connected')
                      : a.lastSync
                        ? t('Stale readings')
                        : t('First reading pending')}
                </Badge>
              </div>
              <h2>{a.label}</h2>
              <p>
                {t('Apartments: {homes} · Devices: {devices}', {
                  homes: number(a.homeCount, 0),
                  devices: number(a.deviceCount, 0),
                })}
              </p>
              <div className="account-sync">
                <Clock3 size={15} />
                {date(a.lastSync)}
              </div>
              {a.error && <Notice tone="error">{t(a.error)}</Notice>}
              <button className="button secondary full" onClick={() => open(a)}>
                {t('Reconnect')}
              </button>
              <TuyaAiForm account={a} onSaved={refresh} />
            </article>
          ))}
        </div>
      ) : (
        !form && (
          <div className="panel">
            <Empty title={t('No accounts connected yet')}>
              {t(
                'Add an account using its user code and a QR code. You do not need your Tuya account password.',
              )}
            </Empty>
          </div>
        )
      )}
      <div className="inline-note">
        <ShieldCheck size={18} />
        <p>
          {t(
            'Connection credentials are encrypted and stay on your server. The application only reads device data.',
          )}
        </p>
      </div>
    </>
  );
}

export function NotificationsPage() {
  const { t } = useI18n(messages);
  const { data, error } = useApi<NotificationView[]>('/notifications');
  const settings = useApi<SettingsView>('/settings');
  return (
    <>
      <PageTitle
        title={t('Notifications')}
        subtitle={t('Threshold alerts, unusual usage, and weekly summaries.')}
      />
      {settings.data && !settings.data.emailConfigured && (
        <Notice tone="warning">
          {t('Email delivery is not configured. Events will be recorded here.')}{' '}
          <a href="#settings">{t('View email settings.')}</a>
        </Notice>
      )}
      {error && <Notice tone="error">{t(error)}</Notice>}
      <div className="panel">{data ? <AlertList items={data} /> : <Loading />}</div>
    </>
  );
}

export function SettingsPage() {
  const { t, number } = useI18n(messages);
  const { data, error } = useApi<SettingsView>('/settings');
  if (error) return <Notice tone="error">{t(error)}</Notice>;
  if (!data) return <Loading />;
  return (
    <>
      <PageTitle
        title={t('Settings')}
        subtitle={t('Your instance configuration and how monitoring works.')}
      />
      <section className="panel prose">
        <SectionTitle title={t('Use on your phone')} />
        <p>
          {t(
            'iPhone: open the Share menu and choose Add to Home Screen. Android: open the browser menu and choose Install app or Add to Home Screen.',
          )}
        </p>
        <p>
          {t(
            'Open the application over HTTPS to install it. Monitoring needs a connection to your server; readings are not available offline.',
          )}
        </p>
      </section>
      <div className="panel">
        <SectionTitle title={t('Email notifications')} subtitle={t('Delivered by Resend')}>
          <Mail size={23} />
        </SectionTitle>
        <Badge tone={data.emailConfigured ? 'success' : 'warning'}>
          {data.emailConfigured ? t('Email delivery configured') : t('Configuration required')}
        </Badge>
        <dl className="settings-list">
          <div>
            <dt>{t('Sender')}</dt>
            <dd>{data.emailFrom || t('Not set')}</dd>
          </div>
          <div>
            <dt>{t('Recipient')}</dt>
            <dd>{data.emailTo || t('Not set')}</dd>
          </div>
          <div>
            <dt>{t('Weekly summary')}</dt>
            <dd>{t('Monday, after 08:00')}</dd>
          </div>
        </dl>
        {!data.emailConfigured && (
          <Notice>
            {t(
              'Set RESEND_API_KEY, EMAIL_FROM (a verified domain), and EMAIL_TO on the server, then restart the application. The key is never sent to the browser.',
            )}
          </Notice>
        )}
        <p className="field-help">
          {t(
            'Threshold and anomaly alerts: at most one notification of each type per apartment per day. The summary is sent even when there were no alerts.',
          )}
        </p>
      </div>
      <div className="panel">
        <SectionTitle title={t('Monitoring')} />
        <dl className="settings-list">
          <div>
            <dt>{t('Time zone')}</dt>
            <dd>{data.timezone}</dd>
          </div>
          <div>
            <dt>{t('Meters and device list')}</dt>
            <dd>{t('Every {minutes} minutes', { minutes: number(data.pollSeconds / 60, 0) })}</dd>
          </div>
          <div>
            <dt>{t('Heating states')}</dt>
            <dd>{t('Every {seconds} seconds', { seconds: number(data.statusPollSeconds, 0) })}</dd>
          </div>
          <div>
            <dt>{t('Incremental reports')}</dt>
            <dd>{t('Live while the Tuya connection is active')}</dd>
          </div>
          <div>
            <dt>{t('Application URL')}</dt>
            <dd>{data.origin}</dd>
          </div>
          <div>
            <dt>{t('Access')}</dt>
            <dd>{t('One owner · password · no registration')}</dd>
          </div>
        </dl>
      </div>
      <div className="panel">
        <SectionTitle title={t('Interface language')} />
        <p>
          {t('Your language choice is saved in this browser. Emails are always sent in English.')}
        </p>
      </div>
      <div className="panel prose">
        <SectionTitle title={t('How to read the results')} />
        <p>
          {t(
            'Usage is calculated from meter increases. The first reading establishes a starting point. Short intervals across day boundaries are split proportionally, so daily values are approximate.',
          )}
        </p>
        <p>
          {t(
            'Incremental reports are counted once using the device report time. Interruptions in reception leave gaps. Point reports do not establish time coverage; the total remains partial even with an active connection.',
          )}
        </p>
        <p>
          {t(
            '≈ marks consumption calculated from sampled power or configured heating power × observed heating time. Native power needs no configuration. Totals show each source separately; they are not intended for billing.',
          )}
        </p>
        <p>
          {t(
            'A missing energy source, offline device, or meter reset leaves a gap. The gap limit is 15 minutes for meters and 3 minutes for power readings and runtime estimates. Coverage shows how much of the time and selected devices have readings. A dash (—) means no data.',
          )}
        </p>
        <p>
          {t(
            'A daily alert may concern a partial total; the message will say so. An anomaly requires at least 7 comparable days with at least 95% coverage for each compared device. Changing power or state mapping requires new comparison history.',
          )}
        </p>
        <p>
          {t(
            'Set thresholds and device selection separately for each apartment. History from the Tuya mobile app is not imported.',
          )}
        </p>
      </div>
    </>
  );
}
