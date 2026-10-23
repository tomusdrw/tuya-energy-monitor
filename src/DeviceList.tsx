import { useEffect, useRef, useState } from 'react';
import { ChevronRight, EyeOff, LoaderCircle, RotateCcw, Thermometer, Zap } from 'lucide-react';
import type { DeviceView } from '../shared/types';
import { api } from './api';
import { Badge, Empty, Notice } from './components';
import { useI18n } from './i18n';
import { messages } from './locales/pages';
import { DeviceClimate } from './Climate';

type MovedDevice = { id: string; ignored: boolean; previousFocus: Element | null };
type OnSaved = (moved?: MovedDevice) => void;

function DeviceRow({ device: d, onSaved }: { device: DeviceView; onSaved: OnSaved }) {
  const { t, date, energyNumber } = useI18n(messages);
  const [included, setIncluded] = useState(d.included),
    [busy, setBusy] = useState<'monitoring' | 'ignore' | null>(null),
    [error, setError] = useState('');
  useEffect(() => setIncluded(d.included), [d.included]);
  async function update(patch: { included?: boolean; ignored?: boolean }) {
    if (busy) return;
    const previousFocus = document.activeElement;
    setBusy(patch.ignored === undefined ? 'monitoring' : 'ignore');
    setError('');
    try {
      await api(`/devices/${d.id}`, 'PUT', patch);
      if (patch.ignored) setIncluded(false);
      else if (patch.included !== undefined) setIncluded(patch.included);
      onSaved(
        patch.ignored === undefined
          ? undefined
          : { id: d.id, ignored: patch.ignored, previousFocus },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="device-list-row" data-device-id={d.id}>
      <a className={`device-row${d.fresh ? '' : ' inactive'}`} href={`#device/${d.id}`}>
        <div className="device-name">
          <span className={`device-icon ${d.energySource === 'measured' ? 'blue' : ''}`}>
            {d.category === 'wk' ? <Thermometer size={19} /> : <Zap size={19} />}
          </span>
          <div>
            <strong>{d.name}</strong>
            <small>
              {d.fresh ? t('Online') : t('Inactive · offline or stale readings')}
              {d.ignored ? (
                <> · {t('Ignored')}</>
              ) : !included ? (
                <> · {t('Excluded from apartment total')}</>
              ) : null}
            </small>
            <DeviceClimate device={d} />
          </div>
        </div>
        <span className="device-source">
          <Badge
            tone={
              d.energySource === 'measured'
                ? 'success'
                : d.energySource === 'estimated' || d.energySource === 'power'
                  ? 'blue'
                  : 'warning'
            }
          >
            {d.energySource === 'power'
              ? t('From measured power')
              : d.energySource === 'estimated'
                ? d.heatingState === 'unknown'
                  ? t('Estimate: no signal')
                  : t('Estimated kWh')
                : d.energyKind === 'cumulative'
                  ? d.measurementProvider === 'tuya_ai'
                    ? t('Tuya.ai meter')
                    : t('kWh meter · QR')
                  : d.energyKind === 'incremental'
                    ? d.reportingConnected
                      ? t('Incremental reports')
                      : t('Reports: disconnected')
                    : t('No energy data')}
          </Badge>
        </span>
        <span className="device-energy tabular">
          <span className="mobile-field-label">{t('Today')}</span>
          <span>
            {energyNumber(d.stats)} <small>kWh</small>
          </span>
        </span>
        <span className="device-reading subtle">
          <span className="mobile-field-label">{t('Last reading')}</span>
          {date(d.measurementProvider === 'tuya_ai' ? d.measurementAt : d.lastSeen)}
        </span>
        <ChevronRight size={17} />
      </a>
      <div className="device-monitoring-actions">
        {!d.ignored && (
          <button
            className="monitoring-toggle"
            type="button"
            role="switch"
            aria-checked={included}
            aria-label={t('Include {name} in apartment total and alert rules', { name: d.name })}
            aria-busy={busy === 'monitoring'}
            disabled={busy !== null}
            onClick={() => void update({ included: !included })}
          >
            {busy === 'monitoring' ? (
              <LoaderCircle size={18} className="spin" aria-hidden="true" />
            ) : (
              <span className="monitoring-switch" aria-hidden="true" />
            )}
            <span>
              {busy === 'monitoring' ? t('Saving…') : included ? t('Included') : t('Excluded')}
            </span>
          </button>
        )}
        <button
          className="device-ignore-button"
          type="button"
          aria-label={t(d.ignored ? 'Restore {name} to the device list' : 'Ignore {name}', {
            name: d.name,
          })}
          disabled={busy !== null}
          aria-busy={busy === 'ignore'}
          onClick={() => void update({ ignored: !d.ignored })}
        >
          {busy === 'ignore' ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : d.ignored ? (
            <RotateCcw size={16} aria-hidden="true" />
          ) : (
            <EyeOff size={16} aria-hidden="true" />
          )}
          {busy === 'ignore' ? t('Saving…') : d.ignored ? t('Restore') : t('Ignore')}
        </button>
      </div>
      {error && (
        <div className="device-monitoring-error">
          <Notice tone="error">
            {d.name}: {t(error)}
          </Notice>
        </div>
      )}
    </div>
  );
}

function DeviceTable({ devices, onSaved }: { devices: DeviceView[]; onSaved: OnSaved }) {
  const { t } = useI18n(messages);
  return (
    <div className="device-table">
      <div className="device-list-header">
        <div className="device-row table-head">
          <span>{t('Device')}</span>
          <span>{t('Energy measurement')}</span>
          <span>{t('Today')}</span>
          <span>{t('Last reading')}</span>
          <span />
        </div>
        <span className="monitoring-heading">{t('Monitoring')}</span>
      </div>
      {devices.map((d) => (
        <DeviceRow key={d.id} device={d} onSaved={onSaved} />
      ))}
    </div>
  );
}

export function DeviceList({ devices, onSaved }: { devices: DeviceView[]; onSaved: () => void }) {
  const { t, number } = useI18n(messages);
  const list = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<MovedDevice | null>(null);
  useEffect(() => {
    const moved = pendingFocus.current;
    if (!moved || !devices.some((d) => d.id === moved.id && d.ignored === moved.ignored)) return;
    pendingFocus.current = null;
    // Do not interrupt someone who moved to another control while saving.
    if (document.activeElement !== document.body && document.activeElement !== moved.previousFocus)
      return;
    const target = moved.ignored
      ? list.current?.querySelector<HTMLElement>('.ignored-devices > summary')
      : list.current?.querySelector<HTMLElement>(
          `[data-device-id="${CSS.escape(moved.id)}"] [role="switch"]`,
        );
    target?.focus({ preventScroll: true });
  }, [devices]);
  const saved: OnSaved = (moved) => {
    if (moved) pendingFocus.current = moved;
    onSaved();
  };
  const sorted = [...devices].sort((a, b) => Number(b.fresh) - Number(a.fresh));
  const visible = sorted.filter((d) => !d.ignored);
  const ignored = sorted.filter((d) => d.ignored);
  if (!devices.length)
    return (
      <Empty title={t('No devices')}>
        {t('Check the account connection and refresh the data.')}
      </Empty>
    );
  return (
    <div ref={list}>
      {visible.length ? (
        <DeviceTable devices={visible} onSaved={saved} />
      ) : (
        <Empty title={t('All devices are ignored')}>
          {t('Expand the ignored devices below to restore one to the list.')}
        </Empty>
      )}
      {ignored.length > 0 && (
        <details className="ignored-devices">
          <summary>{t('Ignored devices ({count})', { count: number(ignored.length, 0) })}</summary>
          <p className="field-help">
            {t(
              'Ignored devices are excluded from totals and alerts. Restoring a device keeps monitoring off until you enable it.',
            )}
          </p>
          <DeviceTable devices={ignored} onSaved={saved} />
        </details>
      )}
    </div>
  );
}
