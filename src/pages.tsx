import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Link2,
  Plus,
  ShieldCheck,
  Thermometer,
  Zap,
  Mail,
  Clock3,
  Settings2,
  Save,
} from 'lucide-react';
import type {
  AccountView,
  DeviceDetail,
  HomeDetail,
  NotificationView,
  Rules,
  SettingsView,
} from '../shared/types';
import { api, useApi } from './api';
import { EstimationForm } from './EstimationForm';
import {
  AlertList,
  Badge,
  Coverage,
  Empty,
  EnergyChart,
  EnergyBreakdown,
  energyNumber,
  Loading,
  Notice,
  PageTitle,
  Range,
  SectionTitle,
  date,
  number,
  percent,
} from './components';

function RulesForm({ home, onSaved }: { home: HomeDetail; onSaved: () => void }) {
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
      <SectionTitle title="Reguły powiadomień" subtitle="Ustawienia tylko dla tego mieszkania">
        <Settings2 size={21} />
      </SectionTitle>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="rules-grid">
        <div>
          <label>
            Dzienny próg energii <span className="field-unit">kWh</span>
            <input
              type="number"
              min="0.1"
              max="100000"
              step="0.1"
              placeholder="Brak progu"
              value={rules.dailyLimit ?? ''}
              onChange={(e) =>
                change({ dailyLimit: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </label>
          <p className="field-help">
            E-mail po przekroczeniu progu, najwyżej raz dziennie. Puste pole wyłącza ten alert.
          </p>
        </div>
        <div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={rules.anomalyEnabled}
              onChange={(e) => change({ anomalyEnabled: e.target.checked })}
            />
            Wykrywaj nietypowe zużycie
          </label>
          <p className="field-help">
            Porównanie z tą samą porą wcześniejszych dni. Wymaga przynajmniej 7 dni z
            wystarczającymi danymi.
          </p>
        </div>
      </div>
      <fieldset disabled={!rules.anomalyEnabled} className="anomaly-fields">
        <legend>Warunki wykrywania anomalii</legend>
        <label>
          Okno porównania (dni)
          <input
            type="number"
            min="7"
            max="90"
            step="1"
            value={rules.windowDays}
            required
            onChange={(e) => change({ windowDays: Number(e.target.value) })}
          />
        </label>
        <label>
          Wzrost względem średniej (%)
          <input
            type="number"
            min="1"
            max="10000"
            value={rules.increasePercent}
            required
            onChange={(e) => change({ increasePercent: Number(e.target.value) })}
          />
        </label>
        <label>
          Minimalny przyrost (kWh)
          <input
            type="number"
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
          {saved ? 'Ustawienia zapisane.' : 'Oba warunki wzrostu muszą być spełnione.'}
        </span>
        <button className="button primary" disabled={busy}>
          <Save size={16} />
          {busy ? 'Zapisywanie…' : 'Zapisz reguły'}
        </button>
      </div>
    </form>
  );
}

export function HomePage({ id }: { id: string }) {
  const [days, setDays] = useState(14),
    { data: home, error, refresh } = useApi<HomeDetail>(`/homes/${id}?days=${days}`);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!home) return <Loading />;
  return (
    <>
      <a className="back-link" href="#homes">
        <ArrowLeft size={16} />
        Mieszkania
      </a>
      <PageTitle title={home.name} subtitle={`${home.accountLabel} · ${home.deviceCount} urządzeń`}>
        <Badge tone={home.stats.complete ? 'success' : 'warning'}>
          {home.stats.complete ? 'Aktualne pomiary' : 'Niepełne pomiary'}
        </Badge>
      </PageTitle>
      <div className="stats-grid three">
        <div className="stat featured">
          <span>Zaobserwowane dzisiaj</span>
          <strong>
            {energyNumber(home.stats)} <small>kWh</small>
          </strong>
          <EnergyBreakdown stats={home.stats} />
          <Coverage stats={home.stats} />
        </div>
        <div className="stat">
          <span>Dzienny próg</span>
          <strong>
            {number(home.rules.dailyLimit, 1)} <small>kWh</small>
          </strong>
          <p>
            {home.rules.dailyLimit === null
              ? 'Ustaw próg poniżej'
              : 'Indywidualny limit mieszkania'}
          </p>
        </div>
        <div className="stat">
          <span>Pokrycie pomiarami</span>
          <strong>{percent(home.stats.coverage)}</strong>
          <p>Od północy, dla wybranych urządzeń</p>
        </div>
      </div>
      {!home.stats.complete && (
        <Notice tone="warning">
          Suma jest częściowa. Obejmuje pomiary liczników i włączone estymacje. Przerwy w odczytach
          oraz urządzenia bez źródła energii pozostają brakami danych.
        </Notice>
      )}
      <div className="panel">
        <SectionTitle title="Historia mieszkania">
          <Range days={days} setDays={setDays} />
        </SectionTitle>
        <EnergyChart points={home.history} />
      </div>
      <div className="panel">
        <SectionTitle
          title="Urządzenia"
          subtitle="Wybierz urządzenie, aby sprawdzić historię i udział w sumie."
        />
        {home.devices.length ? (
          <div className="device-table">
            <div className="device-row table-head">
              <span>Urządzenie</span>
              <span>Pomiar energii</span>
              <span>Dzisiaj</span>
              <span>Ostatni odczyt</span>
              <span />
            </div>
            {home.devices.map((d) => (
              <a className="device-row" href={`#device/${d.id}`} key={d.id}>
                <div className="device-name">
                  <span className={`device-icon ${d.energySource === 'measured' ? 'blue' : ''}`}>
                    {d.category === 'wk' ? <Thermometer size={19} /> : <Zap size={19} />}
                  </span>
                  <div>
                    <strong>{d.name}</strong>
                    <small>
                      {!d.included
                        ? 'Poza sumą mieszkania'
                        : d.fresh
                          ? 'Online'
                          : 'Offline lub nieaktualne odczyty'}
                    </small>
                  </div>
                </div>
                <span>
                  <Badge
                    tone={
                      d.energySource === 'measured'
                        ? 'success'
                        : d.energySource === 'estimated'
                          ? 'blue'
                          : 'warning'
                    }
                  >
                    {d.energySource === 'estimated'
                      ? d.heatingState === 'unknown'
                        ? 'Estymacja: brak sygnału'
                        : 'Estymacja kWh'
                      : d.energyKind === 'cumulative'
                        ? 'Licznik kWh'
                        : d.energyKind === 'incremental'
                          ? d.reportingConnected
                            ? 'Raporty przyrostowe'
                            : 'Raporty: brak połączenia'
                          : 'Brak energii'}
                  </Badge>
                </span>
                <span className="tabular">
                  {energyNumber(d.stats)} <small>kWh</small>
                </span>
                <span className="subtle">{date(d.lastSeen)}</span>
                <ChevronRight size={17} />
              </a>
            ))}
          </div>
        ) : (
          <Empty title="Brak urządzeń">Sprawdź połączenie konta i odśwież dane.</Empty>
        )}
      </div>
      <RulesForm key={home.id} home={home} onSaved={refresh} />
    </>
  );
}

export function DevicePage({ id }: { id: string }) {
  const [days, setDays] = useState(14),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const { data: device, error, refresh } = useApi<DeviceDetail>(`/devices/${id}?days=${days}`);
  if (error) return <Notice tone="error">{error}</Notice>;
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
        subtitle={`${device.homeName} · ostatni odczyt chmury: ${date(device.lastSeen)}`}
      >
        <Badge tone={device.fresh ? 'success' : 'warning'}>
          {device.fresh ? 'Online' : 'Offline lub nieaktualne odczyty'}
        </Badge>
      </PageTitle>
      {notice && <Notice tone="error">{notice}</Notice>}
      <div className="stats-grid three">
        <div className="stat featured">
          <span>Zaobserwowane dzisiaj</span>
          <strong>
            {energyNumber(device.stats)} <small>kWh</small>
          </strong>
          <EnergyBreakdown stats={device.stats} />
          <p>{percent(device.stats.coverage)} pokrycia czasu</p>
        </div>
        <div className="stat">
          <span>{device.energyKind === 'incremental' ? 'Odbiór raportów' : 'Stan licznika'}</span>
          {device.energyKind === 'incremental' ? (
            <>
              <strong>{device.reportingConnected ? 'Połączono' : 'Brak połączenia'}</strong>
              <p>Ostatni raport: {date(device.lastEnergyReport)}</p>
            </>
          ) : (
            <>
              <strong>
                {number(device.counterKwh)} <small>kWh</small>
              </strong>
              <p>Łączny licznik urządzenia, nie zużycie dobowe</p>
            </>
          )}
        </div>
        <div className="stat">
          <span>Temperatura bieżąca</span>
          <strong>
            {number(device.temperature, 1)} <small>°C</small>
          </strong>
          <p>
            {device.temperature === null
              ? 'Brak odczytu temperatury'
              : 'Odczyt udostępniony przez urządzenie'}
          </p>
        </div>
      </div>
      {device.energyKind === 'incremental' && (
        <Notice tone={device.reportingConnected ? undefined : 'warning'}>
          Sumujemy raporty energii odebrane na żywo. Powtórzenia tego samego raportu nie zwiększają
          zużycia. Przerwy w odbiorze mogą powodować braki; nie odtwarzamy wcześniejszych raportów.
          Raporty punktowe nie potwierdzają pokrycia czasu, dlatego suma pozostaje częściowa.
          {device.lastEnergyReport === null && ' Czekamy na pierwszy raport energii.'}
        </Notice>
      )}
      {device.energySource === 'missing' && (
        <Notice tone="warning">
          Obecne połączenie Tuya nie udostępnia licznika energii tego urządzenia. Możesz
          skonfigurować estymację poniżej, jeśli dostępny jest sygnał aktywnego grzania.
        </Notice>
      )}
      <EstimationForm key={device.id} device={device} onSaved={refresh} />
      <div className="panel">
        <SectionTitle title="Historia urządzenia">
          <Range days={days} setDays={setDays} />
        </SectionTitle>
        <EnergyChart points={device.history} />
      </div>
      <div className="panel">
        <SectionTitle
          title="Udział w monitorowaniu"
          subtitle="Włącz urządzenia, które odpowiadają za ogrzewanie mieszkania."
        />
        <label className="check-label">
          <input
            type="checkbox"
            checked={device.included}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          Uwzględniaj w sumie mieszkania i regułach alertów
        </label>
        <p className="field-help">
          Urządzenie bez pomiaru będzie oznaczone jako brakująca część sumy. Zmiana wyboru przelicza
          również historię dla bieżącego zestawu urządzeń.
        </p>
      </div>
    </>
  );
}

export function AccountsPage() {
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
      setMessage('Konto połączone. Pobieramy domy i urządzenia — pojawią się po synchronizacji.');
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
        title="Połączone konta"
        subtitle="Wszystkie konta Tuya i Smart Life w jednym panelu."
      >
        <button className="button primary" onClick={() => open()}>
          <Plus size={18} />
          Dodaj konto
        </button>
      </PageTitle>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {form && (
        <section className="panel connect-panel">
          <SectionTitle
            title={accountId ? 'Połącz konto ponownie' : 'Dodaj konto Tuya / Smart Life'}
          >
            <button
              className="button secondary compact"
              disabled={busy}
              onClick={() => setForm(false)}
            >
              Zamknij
            </button>
          </SectionTitle>
          {failure && <Notice tone="error">{failure}</Notice>}
          {!flow ? (
            <form onSubmit={start}>
              <div className="form-two">
                <label>
                  Nazwa konta
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="np. Mieszkania"
                    required
                    maxLength={80}
                  />
                </label>
                <label>
                  Kod użytkownika
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
                Kod znajdziesz w aplikacji: Ja → Ustawienia → Konto i bezpieczeństwo → Kod
                użytkownika.
              </p>
              <button className="button primary" disabled={busy}>
                {busy ? 'Generowanie…' : 'Wyświetl kod QR'}
              </button>
            </form>
          ) : (
            <div className="qr-layout">
              <img src={flow.image} alt="Kod QR połączenia konta Tuya" width={260} height={260} />
              <div>
                <h3>Zatwierdź połączenie w telefonie</h3>
                <ol>
                  <li>Otwórz Tuya lub Smart Life na właściwym koncie.</li>
                  <li>Wybierz + → Skanuj i zeskanuj kod.</li>
                  <li>Zatwierdź połączenie, a następnie sprawdź je poniżej.</li>
                </ol>
                <p className="field-help">
                  Ekran zgody może pokazać nazwę Home Assistant — korzystamy z tego samego
                  mechanizmu logowania. QR wygasa po 5 minutach.
                </p>
                <div className="button-row">
                  <button className="button primary" disabled={busy} onClick={confirm}>
                    {busy ? 'Sprawdzanie…' : 'Zatwierdziłem — sprawdź'}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setFlow(null)}
                  >
                    Nowy QR
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
                    ? 'Wymaga uwagi'
                    : a.healthy
                      ? 'Połączone'
                      : a.lastSync
                        ? 'Nieaktualne odczyty'
                        : 'Pierwszy odczyt'}
                </Badge>
              </div>
              <h2>{a.label}</h2>
              <p>
                {a.homeCount} domów · {a.deviceCount} urządzeń
              </p>
              <div className="account-sync">
                <Clock3 size={15} />
                {date(a.lastSync)}
              </div>
              {a.error && <Notice tone="error">{a.error}</Notice>}
              <button className="button secondary full" onClick={() => open(a)}>
                Połącz ponownie
              </button>
            </article>
          ))}
        </div>
      ) : (
        !form && (
          <div className="panel">
            <Empty title="Jeszcze nie połączono kont">
              Dodaj konto, używając kodu użytkownika i QR. Nie potrzebujesz hasła do konta Tuya.
            </Empty>
          </div>
        )
      )}
      <div className="inline-note">
        <ShieldCheck size={18} />
        <p>
          Dane połączenia są szyfrowane i pozostają na Twoim serwerze. Aplikacja wyłącznie odczytuje
          urządzenia.
        </p>
      </div>
    </>
  );
}

export function NotificationsPage() {
  const { data, error } = useApi<NotificationView[]>('/notifications');
  const settings = useApi<SettingsView>('/settings');
  return (
    <>
      <PageTitle
        title="Powiadomienia"
        subtitle="Przekroczenia progów, nietypowe zużycie i cotygodniowe podsumowania."
      />
      {settings.data && !settings.data.emailConfigured && (
        <Notice tone="warning">
          Wysyłka e-maili nie jest skonfigurowana. Zdarzenia będą zapisywane tutaj.{' '}
          <a href="#settings">Zobacz ustawienia wysyłki.</a>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="panel">{data ? <AlertList items={data} /> : <Loading />}</div>
    </>
  );
}

export function SettingsPage() {
  const { data, error } = useApi<SettingsView>('/settings');
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <>
      <PageTitle
        title="Ustawienia"
        subtitle="Konfiguracja Twojej instancji i sposób działania monitorowania."
      />
      <div className="panel">
        <SectionTitle title="Powiadomienia e-mail" subtitle="Dostarczane przez Resend">
          <Mail size={23} />
        </SectionTitle>
        <Badge tone={data.emailConfigured ? 'success' : 'warning'}>
          {data.emailConfigured ? 'Wysyłka skonfigurowana' : 'Wymaga konfiguracji'}
        </Badge>
        <dl className="settings-list">
          <div>
            <dt>Nadawca</dt>
            <dd>{data.emailFrom || 'Nie ustawiono'}</dd>
          </div>
          <div>
            <dt>Odbiorca</dt>
            <dd>{data.emailTo || 'Nie ustawiono'}</dd>
          </div>
          <div>
            <dt>Podsumowanie tygodnia</dt>
            <dd>Poniedziałek, po 08:00</dd>
          </div>
        </dl>
        {!data.emailConfigured && (
          <Notice>
            Ustaw na serwerze <code>RESEND_API_KEY</code>, <code>EMAIL_FROM</code> (zweryfikowana
            domena) i <code>EMAIL_TO</code>, a następnie uruchom aplikację ponownie. Klucz nie jest
            przesyłany do przeglądarki.
          </Notice>
        )}
        <p className="field-help">
          Próg i anomalia: najwyżej jedno powiadomienie każdego rodzaju na mieszkanie dziennie.
          Podsumowanie wysyłamy także wtedy, gdy nie wystąpiły alerty.
        </p>
      </div>
      <div className="panel">
        <SectionTitle title="Monitorowanie" />
        <dl className="settings-list">
          <div>
            <dt>Strefa czasowa</dt>
            <dd>{data.timezone}</dd>
          </div>
          <div>
            <dt>Liczniki i lista urządzeń</dt>
            <dd>Co {data.pollSeconds / 60} minut</dd>
          </div>
          <div>
            <dt>Stany grzania</dt>
            <dd>Co {data.statusPollSeconds} sekund</dd>
          </div>
          <div>
            <dt>Raporty przyrostowe</dt>
            <dd>Na żywo, gdy działa połączenie Tuya</dd>
          </div>
          <div>
            <dt>Adres aplikacji</dt>
            <dd>{data.origin}</dd>
          </div>
          <div>
            <dt>Dostęp</dt>
            <dd>Jeden właściciel · hasło · brak rejestracji</dd>
          </div>
        </dl>
      </div>
      <div className="panel prose">
        <SectionTitle title="Jak czytać wyniki" />
        <p>
          Zużycie liczymy z przyrostów licznika. Pierwszy odczyt wyznacza punkt początkowy. Krótkie
          przedziały na granicy dni dzielimy proporcjonalnie, więc dobowe wartości są przybliżeniem.
        </p>
        <p>
          Raporty przyrostowe sumujemy jednokrotnie według czasu raportu urządzenia. Przerwy w
          odbiorze pozostawiają braki. Raporty punktowe nie potwierdzają pokrycia czasu; suma
          pozostaje częściowa również przy aktywnym połączeniu.
        </p>
        <p>
          Estymacja (≈) to zadana moc w kW × zaobserwowany czas grzania w godzinach. Włączysz ją w
          szczegółach urządzenia. Suma rozdziela pomiar i szacunek; nie służy rozliczeniom.
        </p>
        <p>
          Brak źródła energii, urządzenie offline i reset licznika pozostawiają lukę. Granica
          przerwy to 15 minut dla liczników i 3 minuty dla estymacji. Pokrycie mówi, dla jakiej
          części czasu i wybranych urządzeń mamy pomiar. Wartość „—” oznacza brak danych.
        </p>
        <p>
          Alert dzienny może dotyczyć częściowej sumy — wiadomość to zaznaczy. Anomalia wymaga
          przynajmniej 7 porównywalnych dni z co najmniej 95% pokrycia dla każdego porównywanego
          urządzenia. Zmiana mocy lub mapowania stanu wymaga nowej historii do porównań.
        </p>
        <p>
          Progi i wybór urządzeń ustawisz osobno w każdym mieszkaniu. Historia z aplikacji mobilnej
          Tuya nie jest importowana.
        </p>
      </div>
    </>
  );
}
