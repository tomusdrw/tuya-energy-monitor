import { useEffect, useState, type FormEvent } from 'react';
import { LayoutDashboard, Building2, Link2, Bell, Settings, LogOut, RefreshCw, ChevronRight, ShieldCheck, ArrowUpRight, Menu, X } from 'lucide-react';
import type { Overview, SettingsView } from '../shared/types';
import { api, useApi } from './api';
import { Brand, Badge, Notice, Loading, PageTitle, SectionTitle, EnergyChart, HomeCard, Empty, number, Coverage, Range, date } from './components';
import { HomePage, DevicePage, AccountsPage, NotificationsPage, SettingsPage } from './pages';

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/auth/login', 'POST', { password }); onLogin(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><div className="login-intro"><Brand /><div><span className="eyebrow light">TWOJE MIESZKANIA. JEDEN WIDOK.</span><h1>Miej energię<br />pod kontrolą.</h1><p>Zobacz, ile zużywa ogrzewanie.<br />Wychwyć zmiany, które wymagają uwagi.</p><div className="login-art" aria-hidden="true">{[30, 46, 38, 62, 47, 72, 56, 82, 62, 96, 75, 88].map((v, i) => <span key={i} style={{ height: `${v}%` }} />)}</div></div><span className="login-caption">TUYA ENERGY MONITOR · TWOJA PRYWATNA INSTANCJA</span></div><main className="login-main"><form className="login-form" onSubmit={submit}><span className="secure-icon"><ShieldCheck size={27} /></span><h2>Witaj ponownie</h2><p>Zaloguj się do panelu monitorowania.</p>{error && <Notice tone="error">{error}</Notice>}<label>Hasło właściciela<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus maxLength={1024} /></label><button className="button primary full" disabled={busy}>{busy ? 'Logowanie…' : 'Zaloguj się'}<ChevronRight size={18} /></button><p className="login-help">Dostęp tylko dla właściciela. Użyj hasła ustawionego przy uruchomieniu aplikacji.</p></form></main></div>;
}

function Dashboard({ data, days, setDays }: { data: Overview; days: number; setDays: (n: number) => void }) {
  const outstanding = data.homes.filter(h => h.stats.fresh < h.stats.monitored).length;
  const limits = data.homes.filter(h => h.rules.dailyLimit !== null).length;
  return <>
    <PageTitle title="Zużycie energii" subtitle="Twoje mieszkania i ogrzewanie — w jednym miejscu."><Badge tone="blue">Dzisiaj · {date(data.now, false)}</Badge></PageTitle>
    {!data.accounts.length ? <div className="panel"><Empty title="Zacznij od połączenia konta">Dodaj konto Tuya lub Smart Life. Odczytamy domy, urządzenia i dostępne liczniki energii.<br />Ustawienia ogrzewania pozostaną pod Twoją kontrolą.</Empty><div className="empty-action"><a href="#accounts" className="button primary">Połącz pierwsze konto <ArrowUpRight size={18} /></a></div></div> : <>
      <div className="stats-grid"><div className="stat featured"><span>Zaobserwowane dzisiaj</span><strong>{number(data.stats.kwh)} <small>kWh</small></strong><Coverage stats={data.stats} /></div><div className="stat"><span>Monitorowane mieszkania</span><strong>{data.homes.length.toString().padStart(2, '0')}</strong><p>{data.accounts.length} połączone konta Tuya</p></div><div className="stat"><span>Urządzenia z licznikiem</span><strong>{data.stats.metered}<small> / {data.stats.monitored}</small></strong><p>{data.stats.fresh} z aktualnym połączeniem</p></div><div className="stat"><span>Ustawione progi dzienne</span><strong>{limits}<small> / {data.homes.length}</small></strong><p>{outstanding ? `${outstanding} mieszkań z niepełnymi pomiarami` : 'Status monitorowania mieszkań'}</p></div></div>
      {!data.stats.complete && <Notice tone="warning"><strong>{data.stats.kwh === null ? 'Czekamy na pierwsze pomiary zużycia.' : 'Ta suma obejmuje tylko dostępne pomiary.'}</strong> Urządzenia bez licznika, przerwy w odczytach i czas sprzed uruchomienia monitoringu nie są liczone jako zero.</Notice>}
      <div className="panel"><SectionTitle title="Historia zużycia" subtitle="Suma energii z urządzeń włączonych do monitorowania"><Range days={days} setDays={setDays} /></SectionTitle><EnergyChart points={data.history} /></div>
      <SectionTitle title="Twoje mieszkania" subtitle="Przejdź do mieszkania, aby zobaczyć urządzenia i ustawić własny próg."><a className="text-link" href="#homes">Wszystkie mieszkania <ChevronRight size={16} /></a></SectionTitle>
      <div className="home-grid">{data.homes.map(h => <HomeCard key={h.id} home={h} />)}</div>
    </>}
  </>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ authenticated: boolean }>('/auth').then(r => setAuthenticated(r.authenticated)).catch(() => setAuthenticated(false));
    const expired = () => setAuthenticated(false);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  if (authenticated === null) return <Loading />;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <Shell onLogout={() => setAuthenticated(false)} />;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const [route, setRoute] = useState(location.hash.slice(1)), [menu, setMenu] = useState(false);
  const [days, setDays] = useState(14), [syncing, setSyncing] = useState(false), [message, setMessage] = useState('');
  const overview = useApi<Overview>(`/overview?days=${days}`), settings = useApi<SettingsView>('/settings');
  useEffect(() => { const change = () => { setRoute(location.hash.slice(1)); setMenu(false); setMessage(''); window.scrollTo(0, 0); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const nav = [{ path: '', label: 'Przegląd', icon: LayoutDashboard }, { path: 'homes', label: 'Mieszkania', icon: Building2 }, { path: 'accounts', label: 'Połączone konta', icon: Link2 }, { path: 'alerts', label: 'Powiadomienia', icon: Bell }, { path: 'settings', label: 'Ustawienia', icon: Settings }];
  const active = route.startsWith('home/') || route.startsWith('device/') ? 'homes' : route;
  const title = nav.find(n => n.path === active)?.label ?? 'Przegląd';
  async function sync() {
    setSyncing(true); setMessage('');
    try { await api('/sync', 'POST', {}); setMessage('Synchronizacja rozpoczęta. Dane odświeżą się automatycznie.'); }
    catch (e) { setMessage((e as Error).message); }
    finally { setSyncing(false); }
  }
  return <div className="app-shell">
    {menu && <button className="menu-backdrop" aria-label="Zamknij menu" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'open' : ''}`}><Brand /><button className="mobile-close icon-button" aria-label="Zamknij menu" onClick={() => setMenu(false)}><X /></button><div className="nav-label">MONITOROWANIE</div><nav aria-label="Menu główne">{nav.map(n => <a key={n.path} href={`#${n.path}`} className={active === n.path ? 'active' : ''} aria-current={active === n.path ? 'page' : undefined}><n.icon size={19} />{n.label}{n.path === 'homes' && !!overview.data?.homes.length && <span className="nav-count">{overview.data.homes.length}</span>}</a>)}</nav><div className="sidebar-note"><ShieldCheck size={18} /><div><strong>Tylko monitorowanie</strong><p>Aplikacja nie zmienia ustawień urządzeń.</p></div></div><div className="owner"><span className="avatar">W</span><div><strong>Właściciel</strong><small>Prywatny panel</small></div><button title="Wyloguj" aria-label="Wyloguj" className="icon-button" onClick={async () => { try { await api('/auth/logout', 'POST', {}); onLogout(); } catch (e) { setMessage((e as Error).message); } }}><LogOut size={18} /></button></div></aside>
    <div className="main-shell"><div className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Otwórz menu" onClick={() => setMenu(true)}><Menu size={21} /></button><span>Panel właściciela</span><ChevronRight size={14} /><strong>{title}</strong></div><button className="button secondary compact" onClick={sync} disabled={syncing || settings.data?.syncing}><RefreshCw size={15} className={syncing || settings.data?.syncing ? 'spin' : ''} />{syncing || settings.data?.syncing ? 'Synchronizacja…' : 'Odśwież dane'}</button></div>
    <main className="content" id="main-content">{message && <Notice>{message}</Notice>}{overview.error && <Notice tone="error">{overview.error}</Notice>}
      {route === '' && (overview.data ? <Dashboard data={overview.data} days={days} setDays={setDays} /> : <Loading />)}
      {route === 'homes' && <><PageTitle title="Mieszkania" subtitle="Każdy dom Tuya ma własne zużycie, historię i reguły alertów." />{overview.data?.homes.length ? <div className="home-grid">{overview.data.homes.map(h => <HomeCard key={h.id} home={h} />)}</div> : <Empty title="Nie ma jeszcze mieszkań">Połącz konto, a jego domy pojawią się tutaj.<a className="text-link" href="#accounts">Przejdź do kont <ChevronRight size={16} /></a></Empty>}</>}
      {route.startsWith('home/') && <HomePage id={route.slice(5)} />}
      {route.startsWith('device/') && <DevicePage id={route.slice(7)} />}
      {route === 'accounts' && <AccountsPage />}
      {route === 'alerts' && <NotificationsPage />}
      {route === 'settings' && <SettingsPage />}
      {route !== '' && !['homes','accounts','alerts','settings'].includes(route) && !route.startsWith('home/') && !route.startsWith('device/') && <Empty title="Nie znaleziono strony"><a href="#">Wróć do przeglądu</a></Empty>}
    </main><footer className="app-footer"><span>Tuya Energy Monitor</span><span>Europe/Warsaw · Odczyt co 5 minut</span></footer></div>
  </div>;
}
