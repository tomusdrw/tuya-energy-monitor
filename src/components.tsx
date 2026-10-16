import type { ReactNode } from 'react';
import {
  ArrowRight,
  AlertTriangle,
  ChartNoAxesCombined,
  CheckCircle2,
  Info,
  LoaderCircle,
  Zap,
} from 'lucide-react';
import type { EnergyStats, HistoryPoint, HomeView, NotificationView } from '../shared/types';

export const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('pl-PL', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value);
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const date = (at: number | null | undefined, withTime = true) =>
  at
    ? new Intl.DateTimeFormat('pl-PL', {
        timeZone: 'Europe/Warsaw',
        day: '2-digit',
        month: 'short',
        ...(withTime ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
      }).format(at)
    : 'Jeszcze nie odczytano';
export function Brand() {
  return (
    <a href="#" className="brand">
      <span className="brand-icon">
        <Zap size={24} fill="currentColor" />
      </span>
      <span>
        Tuya<span className="brand-light"> Energy</span>
        <small>MONITOR</small>
      </span>
    </a>
  );
}
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: string }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'error' || tone === 'warning' ? <AlertTriangle size={19} /> : <Info size={19} />}
      <div>{children}</div>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> Wczytuję dane…
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <ChartNoAxesCombined size={30} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SectionTitle({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
export function PageTitle({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </header>
  );
}
export const energyNumber = (stats: Pick<EnergyStats, 'kwh' | 'estimatedKwh'>) =>
  `${stats.estimatedKwh !== null ? '≈ ' : ''}${number(stats.kwh)}`;
export function EnergyBreakdown({ stats }: { stats: EnergyStats }) {
  if (stats.estimatedKwh === null) return null;
  return (
    <div className="energy-breakdown">
      <span>Pomiar: {number(stats.measuredKwh)} kWh</span>
      <span>Estymacja: {number(stats.estimatedKwh)} kWh</span>
    </div>
  );
}
export function Coverage({ stats }: { stats: EnergyStats }) {
  return (
    <span className="coverage">
      <span className={`status-dot ${stats.complete ? 'green' : 'amber'}`} />
      {stats.metered} z pomiarem · {stats.estimated} z estymacją / {stats.monitored} wybranych ·{' '}
      {percent(stats.coverage)} pokrycia czasu
    </span>
  );
}
export function Range({ days, setDays }: { days: number; setDays: (days: number) => void }) {
  return (
    <div className="segmented" aria-label="Zakres historii">
      {[7, 14, 30].map((n) => (
        <button
          key={n}
          className={days === n ? 'selected' : ''}
          aria-pressed={days === n}
          onClick={() => setDays(n)}
        >
          {n} dni
        </button>
      ))}
    </div>
  );
}

export function EnergyChart({ points }: { points: HistoryPoint[] }) {
  if (!points.some((p) => p.kwh !== null))
    return (
      <Empty title="Historia właśnie się zaczyna">
        Wykres pojawi się po pierwszym raporcie przyrostowym albo dwóch poprawnych odczytach
        licznika lub skonfigurowanego stanu grzania. Nie pobieramy wcześniejszej historii z
        aplikacji Tuya.
      </Empty>
    );
  const max = Math.max(1, ...points.map((p) => p.kwh ?? 0));
  const width = 720,
    height = 220,
    pad = 45,
    chartHeight = 155,
    slot = (width - pad - 15) / points.length;
  return (
    <div className="energy-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Dzienne zużycie energii w kilowatogodzinach"
      >
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1={pad}
              x2={width - 15}
              y1={175 - v * chartHeight}
              y2={175 - v * chartHeight}
              className="chart-grid"
            />
            <text x={pad - 10} y={179 - v * chartHeight} textAnchor="end" className="chart-label">
              {number(max * v, 1)}
            </text>
          </g>
        ))}
        <text x={10} y={12} className="chart-label">
          kWh
        </text>
        {points.map((p, i) => {
          const h = Math.max(p.kwh === null ? 2 : 3, ((p.kwh ?? 0) / max) * chartHeight);
          return (
            <g key={p.day}>
              <title>
                {p.day}: {p.kwh === null ? 'brak danych' : `${energyNumber(p)} kWh`}; pomiar:{' '}
                {number(p.measuredKwh)} kWh; estymacja: {number(p.estimatedKwh)} kWh; pokrycie{' '}
                {percent(p.coverage)}
              </title>
              {p.kwh === null ? (
                <rect
                  x={pad + i * slot + slot * 0.2}
                  y={173}
                  width={slot * 0.6}
                  height={2}
                  rx={2}
                  className="bar-missing"
                />
              ) : (
                <>
                  {p.measuredKwh !== null && (
                    <rect
                      x={pad + i * slot + slot * 0.2}
                      y={175 - Math.max(2, ((p.measuredKwh ?? 0) / max) * chartHeight)}
                      width={slot * 0.6}
                      height={Math.max(2, ((p.measuredKwh ?? 0) / max) * chartHeight)}
                      rx={2}
                      className={p.coverage >= 0.95 ? 'bar' : 'bar-partial'}
                    />
                  )}
                  {p.estimatedKwh !== null && (
                    <rect
                      x={pad + i * slot + slot * 0.2}
                      y={175 - h}
                      width={slot * 0.6}
                      height={Math.max(2, ((p.estimatedKwh ?? 0) / max) * chartHeight)}
                      rx={2}
                      className={p.coverage >= 0.95 ? 'bar-estimated' : 'bar-estimated partial'}
                    />
                  )}
                </>
              )}
              {(points.length <= 14 || i % 3 === 0 || i === points.length - 1) && (
                <text
                  x={pad + i * slot + slot / 2}
                  y={202}
                  textAnchor="middle"
                  className="chart-label"
                >
                  {p.day.slice(8)}.{p.day.slice(5, 7)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-blue" />
          Pomiar energii
        </span>
        <span>
          <i className="legend-purple" />
          Czas grzania × moc
        </span>
        <span>
          <i className="legend-gray" />
          Brak danych
        </span>
        <span>Jaśniejszy słupek = częściowe dane</span>
      </div>
    </div>
  );
}

export function HomeCard({ home }: { home: HomeView }) {
  const limit = home.rules.dailyLimit,
    exceeded = limit !== null && home.stats.kwh !== null && home.stats.kwh >= limit;
  return (
    <a className="home-card" href={`#home/${home.id}`}>
      <div className="home-card-top">
        <span className="home-icon">
          <Zap size={19} />
        </span>
        <Badge tone={exceeded ? 'danger' : home.stats.complete ? 'success' : 'warning'}>
          {exceeded
            ? 'Przekroczony próg'
            : home.stats.kwh === null
              ? 'Brak pomiaru'
              : home.stats.complete
                ? 'Aktualne dane'
                : 'Częściowe dane'}
        </Badge>
      </div>
      <h3>{home.name}</h3>
      <p className="subtle">
        {home.accountLabel} · {home.deviceCount} urządzeń
      </p>
      <div className="home-value">
        {energyNumber(home.stats)}{' '}
        <span>
          kWh <small>dzisiaj</small>
        </span>
      </div>
      <EnergyBreakdown stats={home.stats} />
      <div className={`meter ${exceeded ? 'exceeded' : ''}`}>
        <span
          style={{
            width: `${limit && home.stats.kwh !== null ? Math.min(100, (home.stats.kwh / limit) * 100) : 0}%`,
          }}
        />
      </div>
      <div className="meter-caption">
        <span>
          {limit !== null
            ? `Próg: ${number(limit, 1)} kWh / dzień`
            : 'Nie ustawiono progu dziennego'}
        </span>
        <ArrowRight size={17} />
      </div>
      <div className="card-bottom">
        <Coverage stats={home.stats} />
      </div>
    </a>
  );
}

export function AlertList({ items }: { items: NotificationView[] }) {
  if (!items.length)
    return (
      <Empty title="Tutaj pojawią się powiadomienia">
        Ustaw próg w mieszkaniu. Wykrywanie anomalii zacznie działać po zebraniu co najmniej 7
        porównywalnych dni.
      </Empty>
    );
  const labels: Record<string, string> = {
    pending: 'Oczekuje',
    sent: 'Wysłano',
    retry: 'Ponowna próba',
    uncertain: 'Sprawdź dostarczenie',
    failed: 'Błąd wysyłki',
    expired: 'Przeterminowane',
  };
  return (
    <div className="alert-list">
      {items.map((item) => (
        <article className="alert-item" key={item.id}>
          <span className={`alert-icon ${item.kind === 'weekly' ? 'blue' : ''}`}>
            {item.kind === 'weekly' ? <CheckCircle2 size={21} /> : <AlertTriangle size={21} />}
          </span>
          <div className="alert-content">
            <div className="alert-heading">
              <h3>
                {item.homeId ? <a href={`#home/${item.homeId}`}>{item.title}</a> : item.title}
              </h3>
              <Badge tone={item.status === 'sent' ? 'success' : 'warning'}>
                {labels[item.status] ?? item.status}
              </Badge>
            </div>
            <time>{date(item.createdAt)}</time>
            <details>
              <summary>Szczegóły powiadomienia</summary>
              <p className="pre-line">{item.body}</p>
              {item.error && <p className="error-text">{item.error}</p>}
            </details>
          </div>
        </article>
      ))}
    </div>
  );
}
