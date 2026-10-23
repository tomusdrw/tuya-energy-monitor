import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { localizeNotification } from '../shared/notificationMessages';
import { useI18n } from './i18n';
import { componentMessages } from './locales/components';
import { ClimateCompact } from './Climate';

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
      <i aria-hidden="true" />
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
  const { t } = useI18n(componentMessages);
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> {t('Loading data…')}
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
export function EnergyBreakdown({ stats }: { stats: EnergyStats }) {
  const { t, number } = useI18n(componentMessages);
  if (stats.estimatedKwh === null && stats.powerKwh === null) return null;
  return (
    <div className="energy-breakdown">
      <span>{t('Measured: {energy} kWh', { energy: number(stats.measuredKwh) })}</span>
      {stats.powerKwh !== null && (
        <span>{t('From power: {energy} kWh', { energy: number(stats.powerKwh) })}</span>
      )}
      <span>{t('Estimated: {energy} kWh', { energy: number(stats.estimatedKwh) })}</span>
    </div>
  );
}
export function Coverage({ stats }: { stats: EnergyStats }) {
  const { t, number, percent } = useI18n(componentMessages);
  return (
    <span className="coverage">
      <span className={`status-dot ${stats.complete ? 'green' : 'amber'}`} />
      {stats.powerMetered > 0 && (
        <>{t('{count} from power · ', { count: number(stats.powerMetered, 0) })}</>
      )}
      {t(
        '{metered} measured · {estimated} estimated / {monitored} selected · {coverage} time coverage',
        {
          metered: number(stats.metered, 0),
          estimated: number(stats.estimated, 0),
          monitored: number(stats.monitored, 0),
          coverage: percent(stats.coverage),
        },
      )}
    </span>
  );
}
export function Range({ days, setDays }: { days: number; setDays: (days: number) => void }) {
  const { t } = useI18n(componentMessages);
  return (
    <div className="segmented" role="group" aria-label={t('History range')}>
      {[7, 14, 30].map((n) => (
        <button
          key={n}
          className={days === n ? 'selected' : ''}
          aria-pressed={days === n}
          onClick={() => setDays(n)}
        >
          {t('{days} days', { days: n })}
        </button>
      ))}
    </div>
  );
}

export function EnergyChart({ points }: { points: HistoryPoint[] }) {
  const { t, number, percent, day, energyNumber } = useI18n(componentMessages);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const hasData = points.some((p) => p.kwh !== null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.min(960, entry.contentRect.width)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasData]);
  if (!hasData)
    return (
      <Empty title={t('Your history starts here')}>
        {t(
          'The chart will appear after the first incremental report or two valid meter, power or configured heating-state readings. We do not import earlier history from the Tuya app.',
        )}
      </Empty>
    );
  const max = Math.max(1, ...points.map((p) => p.kwh ?? 0));
  const height = 220,
    pad = 45,
    chartHeight = 155,
    slot = (width - pad - 15) / points.length,
    labelStep = Math.ceil(points.length / Math.max(1, Math.floor((width - pad) / 65)));
  return (
    <div className="energy-chart" ref={container}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('Daily energy usage in kilowatt-hours')}
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
                {t(
                  '{day}: {total}; measured: {measured} kWh; estimated: {estimated} kWh; coverage: {coverage}',
                  {
                    day: day(p.day),
                    total: p.kwh === null ? t('No data') : `${energyNumber(p)} kWh`,
                    measured: number(p.measuredKwh),
                    estimated: number(p.estimatedKwh),
                    coverage: percent(p.coverage),
                  },
                ) +
                  (p.powerKwh !== null
                    ? `; ${t('From power: {energy} kWh', { energy: number(p.powerKwh) })}`
                    : '')}
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
                  {p.powerKwh !== null && (
                    <rect
                      x={pad + i * slot + slot * 0.2}
                      y={
                        175 - Math.max(2, (((p.measuredKwh ?? 0) + p.powerKwh) / max) * chartHeight)
                      }
                      width={slot * 0.6}
                      height={Math.max(2, (p.powerKwh / max) * chartHeight)}
                      rx={2}
                      className={p.coverage >= 0.95 ? 'bar-power' : 'bar-power partial'}
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
              {((i % labelStep === 0 && i < points.length - labelStep) ||
                i === points.length - 1) && (
                <text
                  x={pad + i * slot + slot / 2}
                  y={202}
                  textAnchor="middle"
                  className="chart-label"
                >
                  {day(p.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-blue" />
          {t('Energy measurement')}
        </span>
        <span>
          <i className="legend-power" />
          {t('Measured power × time')}
        </span>
        <span>
          <i className="legend-purple" />
          {t('Heating time × power')}
        </span>
        <span>
          <i className="legend-gray" />
          {t('No data')}
        </span>
        <span>{t('Lighter bar = partial data')}</span>
      </div>
      <details className="history-details">
        <summary>{t('View daily readings')}</summary>
        <dl className="history-values">
          {points.map((point) => (
            <div key={point.day}>
              <dt>
                <time dateTime={point.day}>{day(point.day)}</time>
              </dt>
              <dd>
                <strong>{point.kwh === null ? t('No data') : `${energyNumber(point)} kWh`}</strong>
                <span>{t('Measured: {energy} kWh', { energy: number(point.measuredKwh) })}</span>
                {point.powerKwh !== null && (
                  <span>{t('From power: {energy} kWh', { energy: number(point.powerKwh) })}</span>
                )}
                {point.estimatedKwh !== null && (
                  <span>
                    {t('Estimated: {energy} kWh', { energy: number(point.estimatedKwh) })}
                  </span>
                )}
                <span>{t('Time coverage: {coverage}', { coverage: percent(point.coverage) })}</span>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export function HomeCard({ home }: { home: HomeView }) {
  const { t, number, energyNumber } = useI18n(componentMessages);
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
            ? t('Limit exceeded')
            : home.stats.kwh === null
              ? t('No reading')
              : home.stats.complete
                ? t('Up to date')
                : t('Partial data')}
        </Badge>
      </div>
      <h3>{home.name}</h3>
      <p className="subtle">
        {home.accountLabel} · {t('Devices: {count}', { count: number(home.deviceCount, 0) })}
      </p>
      <div className="home-value">
        {energyNumber(home.stats)}{' '}
        <span>
          kWh <small>{t('today')}</small>
        </span>
      </div>
      <EnergyBreakdown stats={home.stats} />
      <ClimateCompact climate={home.climate} />
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
            ? t('Limit: {energy} kWh / day', { energy: number(limit, 1) })
            : t('No daily limit set')}
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
  const { t, date, language } = useI18n(componentMessages);
  if (!items.length)
    return (
      <Empty title={t('Notifications will appear here')}>
        {t(
          'Set a limit for an apartment. Anomaly detection starts after at least 7 comparable days have been collected.',
        )}
      </Empty>
    );
  const labels: Record<string, string> = {
    pending: 'Pending',
    sent: 'Sent',
    retry: 'Retrying',
    uncertain: 'Check delivery',
    failed: 'Delivery failed',
    expired: 'Expired',
  };
  return (
    <div className="alert-list">
      {items.map((item) => {
        const content = localizeNotification(item, language);
        return (
          <article className="alert-item" key={item.id}>
            <span className={`alert-icon ${item.kind === 'weekly' ? 'blue' : ''}`}>
              {item.kind === 'weekly' ? <CheckCircle2 size={21} /> : <AlertTriangle size={21} />}
            </span>
            <div className="alert-content">
              <div className="alert-heading">
                <h3>
                  {item.homeId ? (
                    <a href={`#home/${item.homeId}`}>{content.title}</a>
                  ) : (
                    content.title
                  )}
                </h3>
                <Badge tone={item.status === 'sent' ? 'success' : 'warning'}>
                  {t(labels[item.status] ?? item.status)}
                </Badge>
              </div>
              <time>{date(item.createdAt)}</time>
              <details>
                <summary>{t('Notification details')}</summary>
                <p className="pre-line">{content.body}</p>
                {item.error && <p className="error-text">{t(item.error)}</p>}
              </details>
            </div>
          </article>
        );
      })}
    </div>
  );
}
