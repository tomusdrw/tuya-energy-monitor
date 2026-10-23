import { useEffect, useState, type FormEvent } from 'react';
import {
  LayoutDashboard,
  Building2,
  Link2,
  Bell,
  Settings,
  LogOut,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  ArrowUpRight,
} from 'lucide-react';
import type { Overview, SettingsView } from '../shared/types';
import { api, useApi } from './api';
import { LanguageSwitcher, useI18n } from './i18n';
import { appMessages } from './locales/app';
import {
  Brand,
  Badge,
  Notice,
  Loading,
  PageTitle,
  SectionTitle,
  EnergyChart,
  HomeCard,
  Empty,
  EnergyBreakdown,
  Coverage,
  Range,
} from './components';
import { HomePage, DevicePage, AccountsPage, NotificationsPage, SettingsPage } from './pages';

function Login({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n(appMessages);
  const [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', 'POST', { password });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-intro">
        <Brand />
        <div>
          <span className="eyebrow light">{t('YOUR APARTMENTS. ONE VIEW.')}</span>
          <h2>
            {t('Keep your energy')}
            <br />
            {t('under control.')}
          </h2>
          <p>
            {t('See how much energy your heating uses.')}
            <br />
            {t('Spot changes that need your attention.')}
          </p>
          <div className="login-art" aria-hidden="true">
            {[30, 46, 38, 62, 47, 72, 56, 82, 62, 96, 75, 88].map((v, i) => (
              <span key={i} style={{ height: `${v}%` }} />
            ))}
          </div>
        </div>
        <span className="login-caption">{t('TUYA ENERGY MONITOR · YOUR PRIVATE INSTANCE')}</span>
      </div>
      <main className="login-main">
        <div className="login-language">
          <LanguageSwitcher />
        </div>
        <form className="login-form" onSubmit={submit}>
          <span className="secure-icon">
            <ShieldCheck size={27} />
          </span>
          <h1>{t('Welcome back')}</h1>
          <p>{t('Sign in to your monitoring dashboard.')}</p>
          {error && <Notice tone="error">{t(error)}</Notice>}
          <label>
            {t('Owner password')}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={1024}
            />
          </label>
          <button className="button primary full" disabled={busy}>
            {busy ? t('Signing in…') : t('Sign in')}
            <ChevronRight size={18} />
          </button>
          <p className="login-help">
            {t('Owner access only. Use the password configured when the app was set up.')}
          </p>
        </form>
      </main>
    </div>
  );
}

export function Dashboard({
  data,
  days,
  setDays,
}: {
  data: Overview;
  days: number;
  setDays: (n: number) => void;
}) {
  const { t, number, date, energyNumber } = useI18n(appMessages);
  const outstanding = data.homes.filter((h) => h.stats.fresh < h.stats.monitored).length;
  const limits = data.homes.filter((h) => h.rules.dailyLimit !== null).length;
  return (
    <>
      <PageTitle
        title={t('Energy usage')}
        subtitle={t('Your apartments and heating in one place.')}
      >
        <Badge tone="blue">
          {t('Today')} · {date(data.now, false)}
        </Badge>
      </PageTitle>
      {!data.accounts.length ? (
        <div className="panel">
          <Empty title={t('Start by connecting an account')}>
            {t(
              'Add a Tuya or Smart Life account. We will read its homes, devices and available energy measurements.',
            )}
            <br />
            {t('Your heating settings stay under your control.')}
          </Empty>
          <div className="empty-action">
            <a href="#accounts" className="button primary">
              {t('Connect your first account')} <ArrowUpRight size={18} />
            </a>
          </div>
        </div>
      ) : (
        <>
          {data.accounts
            .filter((account) => !account.healthy)
            .map((account) => (
              <Notice key={account.id} tone="warning">
                <strong>{t('Account {name} needs attention.', { name: account.label })}</strong>{' '}
                {t(
                  account.error ??
                    (account.lastSync === null
                      ? 'Waiting for the first home and device readings.'
                      : 'Readings from this account are out of date.'),
                )}{' '}
                {t('The total may not include all apartments.')}{' '}
                <a href="#accounts">{t('Check connection')}</a>
              </Notice>
            ))}
          <div className="stats-grid">
            <div className="stat featured">
              <span>{t('Observed today')}</span>
              <strong>
                {energyNumber(data.stats)} <small>kWh</small>
              </strong>
              <EnergyBreakdown stats={data.stats} />
              <Coverage stats={data.stats} />
            </div>
            <div className="stat">
              <span>{t('Monitored apartments')}</span>
              <strong>{number(data.homes.length, 0).padStart(2, '0')}</strong>
              <p>
                {t('Up-to-date accounts: {healthy} / {total}', {
                  healthy: number(data.accounts.filter((account) => account.healthy).length, 0),
                  total: number(data.accounts.length, 0),
                })}
              </p>
            </div>
            <div className="stat">
              <span>{t('Devices with energy readings')}</span>
              <strong>
                {number(data.stats.metered + data.stats.powerMetered + data.stats.estimated, 0)}
                <small> / {number(data.stats.monitored, 0)}</small>
              </strong>
              <p>
                {t('{count} with a current connection', { count: number(data.stats.fresh, 0) })}
              </p>
            </div>
            <div className="stat">
              <span>{t('Daily limits set')}</span>
              <strong>
                {number(limits, 0)}
                <small> / {number(data.homes.length, 0)}</small>
              </strong>
              <p>
                {outstanding
                  ? t('Apartments with incomplete readings: {count}', {
                      count: number(outstanding, 0),
                    })
                  : t('Apartment monitoring status')}
              </p>
            </div>
          </div>
          {!data.stats.complete && (
            <Notice tone="warning">
              <strong>
                {data.stats.kwh === null
                  ? t('Waiting for the first energy readings.')
                  : t('This total includes available readings only.')}
              </strong>{' '}
              {t(
                'Devices without energy measurements or configured estimation, gaps in readings and time before monitoring started are not counted as zero.',
              )}
            </Notice>
          )}
          <div className="panel">
            <SectionTitle
              title={t('Usage history')}
              subtitle={t('Total energy from devices selected for monitoring')}
            >
              <Range days={days} setDays={setDays} />
            </SectionTitle>
            <EnergyChart points={data.history} />
          </div>
          <SectionTitle
            title={t('Your apartments')}
            subtitle={t('Open an apartment to see its devices and set a daily limit.')}
          >
            <a className="text-link" href="#homes">
              {t('All apartments')} <ChevronRight size={16} />
            </a>
          </SectionTitle>
          <div className="home-grid">
            {data.homes.map((h) => (
              <HomeCard key={h.id} home={h} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ authenticated: boolean }>('/auth')
      .then((r) => setAuthenticated(r.authenticated))
      .catch(() => setAuthenticated(false));
    const expired = () => setAuthenticated(false);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  if (authenticated === null) return <Loading />;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <Shell onLogout={() => setAuthenticated(false)} />;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { t, number } = useI18n(appMessages);
  const [route, setRoute] = useState(location.hash.slice(1));
  const [days, setDays] = useState(14),
    [syncing, setSyncing] = useState(false),
    [message, setMessage] = useState('');
  const overview = useApi<Overview>(`/overview?days=${days}`),
    settings = useApi<SettingsView>('/settings');
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1));
      setMessage('');
      window.scrollTo(0, 0);
      requestAnimationFrame(() =>
        document.getElementById('main-content')?.focus({ preventScroll: true }),
      );
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const nav = [
    { path: '', label: 'Overview', shortLabel: 'Overview', icon: LayoutDashboard },
    { path: 'homes', label: 'Apartments', shortLabel: 'Apartments', icon: Building2 },
    { path: 'accounts', label: 'Connected accounts', shortLabel: 'Accounts', icon: Link2 },
    { path: 'alerts', label: 'Notifications', shortLabel: 'Alerts', icon: Bell },
    { path: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
  ];
  const active = route.startsWith('home/') || route.startsWith('device/') ? 'homes' : route;
  const title = nav.find((n) => n.path === active)?.label ?? 'Overview';
  async function logout() {
    try {
      await api('/auth/logout', 'POST', {});
      onLogout();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function sync() {
    setSyncing(true);
    setMessage('');
    try {
      await api('/sync', 'POST', {});
      setMessage('Sync started. Data will refresh automatically.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        {t('Skip to content')}
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="nav-label">{t('MONITORING')}</div>
        <nav aria-label={t('Main menu')}>
          {nav.map((n) => (
            <a
              key={n.path}
              href={`#${n.path}`}
              className={active === n.path ? 'active' : ''}
              aria-current={active === n.path ? 'page' : undefined}
            >
              <n.icon size={19} />
              {t(n.label)}
              {n.path === 'homes' && !!overview.data?.homes.length && (
                <span className="nav-count">{number(overview.data.homes.length, 0)}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <div>
            <strong>{t('Monitoring only')}</strong>
            <p>{t('The app does not change device settings.')}</p>
          </div>
        </div>
        <div className="owner">
          <span className="avatar" aria-hidden="true">
            {t('Owner').slice(0, 1)}
          </span>
          <div>
            <strong>{t('Owner')}</strong>
            <small>{t('Private dashboard')}</small>
          </div>
          <button
            title={t('Log out')}
            aria-label={t('Log out')}
            className="icon-button"
            onClick={logout}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <div className="breadcrumb">
            <span>{t('Owner dashboard')}</span>
            <ChevronRight size={14} />
            <strong>{t(title)}</strong>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher />
            <button
              className="button secondary compact refresh-button"
              aria-label={syncing || settings.data?.syncing ? t('Syncing…') : t('Refresh data')}
              title={t('Refresh data')}
              onClick={sync}
              disabled={syncing || settings.data?.syncing}
            >
              <RefreshCw size={15} className={syncing || settings.data?.syncing ? 'spin' : ''} />
              <span>{syncing || settings.data?.syncing ? t('Syncing…') : t('Refresh data')}</span>
            </button>
            <button
              className="mobile-logout icon-button"
              onClick={logout}
              aria-label={t('Log out')}
              title={t('Log out')}
            >
              <LogOut size={19} />
            </button>
          </div>
        </div>
        <main className="content" id="main-content" tabIndex={-1}>
          {message && <Notice>{t(message)}</Notice>}
          {overview.error && <Notice tone="error">{t(overview.error)}</Notice>}
          {route === '' &&
            (overview.data ? (
              <Dashboard data={overview.data} days={days} setDays={setDays} />
            ) : (
              <Loading />
            ))}
          {route === 'homes' && (
            <>
              <PageTitle
                title={t('Apartments')}
                subtitle={t('Each Tuya home has its own usage, history and alert rules.')}
              />
              {overview.data?.homes.length ? (
                <div className="home-grid">
                  {overview.data.homes.map((h) => (
                    <HomeCard key={h.id} home={h} />
                  ))}
                </div>
              ) : (
                <Empty title={t('No apartments yet')}>
                  {t('Connect an account to see its apartments here.')}
                  <a className="text-link" href="#accounts">
                    {t('Go to accounts')} <ChevronRight size={16} />
                  </a>
                </Empty>
              )}
            </>
          )}
          {route.startsWith('home/') && (
            <HomePage id={route.slice(5)} onMonitoringChanged={overview.refresh} />
          )}
          {route.startsWith('device/') && <DevicePage id={route.slice(7)} />}
          {route === 'accounts' && <AccountsPage />}
          {route === 'alerts' && <NotificationsPage />}
          {route === 'settings' && <SettingsPage />}
          {route !== '' &&
            !['homes', 'accounts', 'alerts', 'settings'].includes(route) &&
            !route.startsWith('home/') &&
            !route.startsWith('device/') && (
              <Empty title={t('Page not found')}>
                <a href="#">{t('Back to overview')}</a>
              </Empty>
            )}
        </main>
        <footer className="app-footer">
          <span>Tuya Energy Monitor</span>
          <span>{t('Europe/Warsaw · Status every 60 s · Meters every 5 min')}</span>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label={t('Main menu')}>
        {nav.map((n) => (
          <a
            key={n.path}
            href={`#${n.path}`}
            title={t(n.label)}
            aria-current={active === n.path ? 'page' : undefined}
            className={active === n.path ? 'active' : ''}
          >
            <n.icon size={21} aria-hidden="true" />
            <span>{t(n.shortLabel)}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
