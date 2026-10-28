import { useEffect, useRef, useState } from 'react';
import { Droplets, Thermometer } from 'lucide-react';
import type {
  ClimateHistoryPoint,
  ClimateMetric,
  ClimateSummary,
  DeviceView,
} from '../shared/types';
import { useI18n } from './i18n';
import { messages } from './locales/climate';
import { DeviceSelection } from './DeviceSelection';
import { InteractiveChart } from './InteractiveChart';

const metrics = ['temperature', 'humidity'] as const;
const unit = (key: (typeof metrics)[number]) => (key === 'temperature' ? '°C' : '%');

export function ClimateCompact({ climate }: { climate: ClimateSummary }) {
  const { t, number } = useI18n(messages);
  return (
    <div className="climate-compact">
      {metrics.map((key) => (
        <span key={key}>
          {key === 'temperature' ? (
            <Thermometer size={16} aria-hidden="true" />
          ) : (
            <Droplets size={16} aria-hidden="true" />
          )}
          <span>
            {t(key === 'temperature' ? 'Temperature' : 'Humidity')}:{' '}
            <strong>
              {number(climate[key].average, 1)} {unit(key)}
            </strong>
          </span>
        </span>
      ))}
    </div>
  );
}

export function DeviceClimate({
  device,
  detailed = false,
}: {
  device: DeviceView;
  detailed?: boolean;
}) {
  const { t, number, date } = useI18n(messages);
  if (!detailed && !device.hasTemperature && device.humidity === null) return null;
  return (
    <div className={detailed ? 'device-climate-detail' : 'device-climate'}>
      <span>
        {t('Current temperature')}: <strong>{number(device.temperature, 1)} °C</strong>
        {device.hasTemperature && !device.temperatureIncluded && (
          <span className="temperature-excluded">{t('Excluded from average')}</span>
        )}
      </span>
      <span>
        {t('Current humidity')}: <strong>{number(device.humidity, 1)} %</strong>
      </span>
      <small>{t('Climate read: {date}', { date: date(device.climateObservedAt) })}</small>
    </div>
  );
}

export function ClimateSummaryCards({
  climate,
  homeId,
  onSelectionSaved,
}: {
  climate: ClimateSummary;
  homeId?: string;
  onSelectionSaved?: () => void;
}) {
  const { t, number, date } = useI18n(messages);
  return (
    <section className="climate-summary" aria-label={t('Home climate')}>
      <h2>{t('Home climate')}</h2>
      <p className="climate-help">
        {t(
          'Temperature uses selected sensors; humidity uses all available sensors. Each sensor has equal weight, independently of energy selection. Offline devices and readings older than 15 minutes are omitted.',
        )}
      </p>
      <div className="climate-grid">
        {metrics.map((key) => {
          const value = climate[key];
          return (
            <div className="stat" key={key}>
              <span>{t(key === 'temperature' ? 'Average temperature' : 'Average humidity')}</span>
              <strong>
                {number(value.average, 1)} <small>{unit(key)}</small>
              </strong>
              {value.average === null ? (
                <p>{t('No current readings')}</p>
              ) : (
                <>
                  <p>
                    {t('Min {min} · Max {max}', {
                      min: `${number(value.minimum, 1)} ${unit(key)}`,
                      max: `${number(value.maximum, 1)} ${unit(key)}`,
                    })}
                  </p>
                  <p>{t('Sensors: {count}', { count: number(value.count, 0) })}</p>
                  <p>{t('Oldest cloud read: {date}', { date: date(value.oldestObservedAt) })}</p>
                </>
              )}
              {key === 'temperature' && homeId && onSelectionSaved && (
                <DeviceSelection
                  key={homeId}
                  homeId={homeId}
                  mode="temperature"
                  onSaved={onSelectionSaved}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MetricChart({
  points,
  metric,
}: {
  points: ClimateHistoryPoint[];
  metric: (typeof metrics)[number];
}) {
  const { t, number, day } = useI18n(messages);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(540);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.min(960, entry.contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const values = points.map((p) => p[metric]).filter((v) => v.average !== null);
  const low = values.length ? Math.floor(Math.min(...values.map((v) => v.minimum!))) - 1 : 0;
  const high = values.length ? Math.ceil(Math.max(...values.map((v) => v.maximum!))) + 1 : 1;
  const x = (i: number) => 48 + ((width - 68) * (i + 0.5)) / points.length;
  const y = (v: number) => 175 - ((v - low) / (high - low)) * 140;
  const step = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor((width - 68) / 60))));
  const label = t(metric === 'temperature' ? 'Daily temperature (°C)' : 'Daily humidity (%)');
  return (
    <div className={`climate-chart ${metric}`} ref={container}>
      <h3>{label}</h3>
      {!values.length ? (
        <p className="climate-help">{t('No readings')}</p>
      ) : (
        <InteractiveChart
          width={width}
          height={210}
          label={label}
          plot={{ left: 48, right: width - 20, top: 35, bottom: 180 }}
          points={points.map((point) => ({
            day: point.day,
            content: <DailyMetric value={point[metric]} metric={metric} />,
          }))}
        >
          {[low, (low + high) / 2, high].map((tick) => (
            <g key={tick}>
              <line x1={44} x2={width - 12} y1={y(tick)} y2={y(tick)} className="chart-grid" />
              <text x={36} y={y(tick) + 4} textAnchor="end" className="chart-label">
                {number(tick, 1)}
              </text>
            </g>
          ))}
          {points.map((point, i) => {
            const value = point[metric];
            return (
              <g key={point.day}>
                {value.average !== null ? (
                  <>
                    <line
                      x1={x(i)}
                      x2={x(i)}
                      y1={y(value.minimum!)}
                      y2={y(value.maximum!)}
                      className="climate-range"
                    />
                    <circle cx={x(i)} cy={y(value.average)} r={4} className="climate-point" />
                  </>
                ) : (
                  <text x={x(i)} y={179} textAnchor="middle" className="chart-label">
                    —
                  </text>
                )}
                {((i % step === 0 && i < points.length - step) || i === points.length - 1) && (
                  <text x={x(i)} y={201} textAnchor="middle" className="chart-label">
                    {day(point.day)}
                  </text>
                )}
              </g>
            );
          })}
        </InteractiveChart>
      )}
    </div>
  );
}

function DailyMetric({
  value,
  metric,
}: {
  value: ClimateMetric;
  metric: (typeof metrics)[number];
}) {
  const { t, number } = useI18n(messages);
  return (
    <div>
      <strong>{t(metric === 'temperature' ? 'Temperature' : 'Humidity')}</strong>
      {value.average === null ? (
        <span>{t('No readings')}</span>
      ) : (
        <>
          <span>
            {t('Average: {value}', { value: `${number(value.average, 1)} ${unit(metric)}` })}
          </span>
          <span>
            {t('Min {min} · Max {max}', {
              min: `${number(value.minimum, 1)} ${unit(metric)}`,
              max: `${number(value.maximum, 1)} ${unit(metric)}`,
            })}
          </span>
          <span>
            {t('Sensors: {count}', { count: number(value.count, 0) })} ·{' '}
            {t('Samples: {count}', { count: number(value.samples, 0) })}
          </span>
        </>
      )}
    </div>
  );
}

export function ClimateHistory({ points }: { points: ClimateHistoryPoint[] }) {
  const { t, day } = useI18n(messages);
  return (
    <>
      <p className="climate-help">
        {t(
          'Temperature history uses the current sensor selection. Daily sensor averages have equal weight. Lines show observed minimum–maximum; dots show the home average. Missing days remain gaps.',
        )}
      </p>
      <div className="climate-grid">
        {metrics.map((metric) => (
          <MetricChart key={metric} metric={metric} points={points} />
        ))}
      </div>
      <p className="climate-help">
        {t(
          'History starts with the first collected readings. Cloud read time is not the sensor measurement time. Sparse readings do not represent a complete day.',
        )}
      </p>
      <details className="history-details">
        <summary>{t('View daily climate readings')}</summary>
        <dl className="climate-daily-values">
          {points.map((point) => (
            <div key={point.day}>
              <dt>{day(point.day)}</dt>
              <dd>
                {metrics.map((metric) => (
                  <DailyMetric key={metric} metric={metric} value={point[metric]} />
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
