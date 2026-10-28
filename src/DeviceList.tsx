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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function update(ignored: boolean) {
    if (busy) return;
    const previousFocus = document.activeElement;
    setBusy(true);
    setError('');
    try {
      await api(`/devices/${d.id}`, 'PUT', { ignored });
      onSaved({ id: d.id, ignored, previousFocus });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
              ) : d.included ? (
                <> · {t('Included in heating total')}</>
              ) : (
                <> · {t('Excluded from apartment total')}</>
              )}
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
      <div className="device-list-actions">
        <button
          className="device-ignore-button"
          type="button"
          aria-label={t(d.ignored ? 'Restore {name} to the device list' : 'Ignore {name}', {
            name: d.name,
          })}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void update(!d.ignored)}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : d.ignored ? (
            <RotateCcw size={16} aria-hidden="true" />
          ) : (
            <EyeOff size={16} aria-hidden="true" />
          )}
          {busy ? t('Saving…') : d.ignored ? t('Restore') : t('Ignore')}
        </button>
      </div>
      {error && (
        <div className="device-list-error">
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
          `[data-device-id="${CSS.escape(moved.id)}"] a.device-row`,
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
