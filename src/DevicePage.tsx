import { useRef, useState } from 'react';
import { ArrowLeft, Pencil, Flame, Activity } from 'lucide-react';
import type { DeviceDetail } from '../shared/types';
import { useApi } from './api';
import { useI18n } from './i18n';
import { messages as pageMessages } from './locales/pages';
import { messages as estimationMessages } from './locales/estimation';
import { Badge, EnergyChart, Loading, Notice, PageTitle, Range, SectionTitle } from './components';
import { DeviceClimate } from './Climate';
import { DeviceConfiguration } from './DeviceConfiguration';
import { DeviceDiagnostics } from './DeviceDiagnostics';

const messages = { ...pageMessages, ...estimationMessages };
const stateLabels = { on: 'Heating active', off: 'Idle', unknown: 'Heating state unknown' };

export function DevicePage({ id }: { id: string }) {
  // Scope fetching and pending save callbacks to this device, not just the editor.
  // A late response from a previous page must not replace another device's data.
  return <DevicePageContent key={id} id={id} />;
}

function DevicePageContent({ id }: { id: string }) {
  const { t } = useI18n(messages);
  const [days, setDays] = useState(14);
  const { data, error, refresh, setData } = useApi<DeviceDetail>(`/devices/${id}?days=${days}`);
  const device = data?.id === id ? data : null;
  return (
    <>
      {error && <Notice tone="error">{t(error)}</Notice>}
      {device ? (
        <DeviceDetails
          key={id}
          device={device}
          days={days}
          setDays={setDays}
          onRefresh={refresh}
          onSaved={(updated) => {
            setData(updated);
            refresh();
          }}
        />
      ) : (
        !error && <Loading />
      )}
    </>
  );
}

export function DeviceDetails({
  device,
  days,
  setDays,
  onSaved,
  onRefresh,
}: {
  device: DeviceDetail;
  days: number;
  setDays: (days: number) => void;
  onSaved: (device: DeviceDetail) => void;
  onRefresh: () => void;
}) {
  const { t, number, date, percent, energyNumber } = useI18n(messages);
  // Mount the editor with a snapshot; polling must never replace an in-progress draft.
  const [draft, setDraft] = useState<DeviceDetail | null>(null);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const source =
    device.energySource === 'power'
      ? t('From measured power')
      : device.energySource === 'estimated'
        ? t('Estimated kWh')
        : device.energySource === 'missing'
          ? t('No energy data')
          : device.measurementProvider === 'tuya_ai'
            ? t('Tuya.ai meter')
            : t('kWh meter · QR');
  const readingAt =
    device.energySource === 'estimated'
      ? device.estimation.lastObservedAt
      : device.energyKind === 'incremental'
        ? device.lastEnergyReport
        : device.measurementProvider === 'tuya_ai'
          ? device.measurementAt
          : device.lastSeen;
  function closeEditor() {
    setDraft(null);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  return (
    <div className="device-details">
      <a href={`#home/${device.homeId}`} className="back-link">
        <ArrowLeft size={16} />
        {device.homeName}
      </a>
      <PageTitle title={device.name} subtitle={draft ? t('Edit monitoring settings') : ''}>
        <div className="device-header-actions">
          <Badge tone={device.fresh ? 'success' : 'warning'}>
            {device.fresh ? t('Online') : t('Offline or stale readings')}
          </Badge>
          {!draft && (
            <button
              ref={editButton}
              className="button secondary compact"
              onClick={() => {
                setSaved(false);
                setDraft(device);
              }}
            >
              <Pencil size={16} aria-hidden="true" />
              {t('Edit')}
            </button>
          )}
        </div>
      </PageTitle>
      {draft ? (
        <DeviceConfiguration
          device={draft}
          days={days}
          onRefresh={onRefresh}
          onCancel={closeEditor}
          onSaved={(updated) => {
            onSaved(updated);
            setSaved(true);
            closeEditor();
          }}
        />
      ) : (
        <>
          {saved && <Notice>{t('Settings saved.')}</Notice>}
          <section className="device-overview panel" aria-label={t('Current device state')}>
            <div className="device-metrics">
              <div className="device-metric device-daily-energy">
                <span>{t('Observed today')}</span>
                <strong>
                  {energyNumber(device.stats)} <small>kWh</small>
                </strong>
                <span className={device.stats.complete ? 'metric-note' : 'metric-note incomplete'}>
                  {device.stats.complete ? t('Current readings') : t('Incomplete readings')} ·{' '}
                  {percent(device.stats.coverage)}
                </span>
              </div>
              <div className="device-metric">
                {device.energySource === 'estimated' ? (
                  <>
                    <span>
                      <Flame size={15} aria-hidden="true" />
                      {t('Heating state')}
                    </span>
                    <strong className={`device-state ${device.heatingState}`}>
                      {t(stateLabels[device.heatingState])}
                    </strong>
                    <span className="metric-note">
                      {t('Heating time today')}: {number(device.stats.heatingHours)} h
                    </span>
                  </>
                ) : device.energySource === 'power' ? (
                  <>
                    <span>{t('Current power')}</span>
                    <strong>
                      {number(device.powerW, 1)} <small>W</small>
                    </strong>
                    <span className="metric-note">{t('Reading provided by the device')}</span>
                  </>
                ) : device.energyKind === 'incremental' ? (
                  <>
                    <span>{t('Report reception')}</span>
                    <strong className="device-state">
                      {device.reportingConnected ? t('Connected') : t('Disconnected')}
                    </strong>
                    <span className="metric-note">
                      {t('Last report: {date}', { date: date(device.lastEnergyReport) })}
                    </span>
                  </>
                ) : device.energySource === 'measured' ? (
                  <>
                    <span>{t('Meter reading')}</span>
                    <strong>
                      {number(device.counterKwh, 3)} <small>kWh</small>
                    </strong>
                    <span className="metric-note">{t('Cumulative reading')}</span>
                  </>
                ) : (
                  <>
                    <span>
                      <Activity size={15} aria-hidden="true" />
                      {t('Energy measurement')}
                    </span>
                    <strong className="device-state">{t('No energy data')}</strong>
                    <span className="metric-note">{t('Configure estimation in Edit.')}</span>
                  </>
                )}
              </div>
              <div className="device-metric">
                <span>{t('Current conditions')}</span>
                <DeviceClimate device={device} detailed />
              </div>
            </div>
            <dl className="device-summary">
              <div>
                <dt>{t('Monitoring participation')}</dt>
                <dd>
                  <Badge tone={device.included ? 'blue' : 'muted'}>
                    {device.ignored
                      ? t('Ignored')
                      : device.included
                        ? t('Included')
                        : t('Excluded')}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt>{t('Energy source')}</dt>
                <dd>{source}</dd>
              </div>
              <div>
                <dt>{t('Last reading')}</dt>
                <dd>{date(readingAt)}</dd>
              </div>
              {device.energySource === 'estimated' && (
                <div>
                  <dt>{t('Estimation method')}</dt>
                  <dd>
                    {t(device.estimation.temperature ? 'Temperature comparison' : 'Heating signal')}{' '}
                    · {number(device.estimation.ratedPowerKw)} kW
                  </dd>
                </div>
              )}
            </dl>
          </section>
          {device.measurementError && <Notice tone="error">{t(device.measurementError)}</Notice>}
          {device.energySource === 'estimated' && device.heatingState === 'unknown' && (
            <Notice tone="warning">
              {t(
                'No current, valid heating data. This period remains missing data even when the thermostat is online.',
              )}
            </Notice>
          )}
          {device.energySource === 'power' && !device.fresh && (
            <Notice tone="warning">
              {t('No current power reading. This period remains missing data.')}
            </Notice>
          )}
          <section className="panel">
            <SectionTitle title={t('Device history')}>
              <Range days={days} setDays={setDays} />
            </SectionTitle>
            <EnergyChart points={device.history} />
          </section>
          <section className="panel device-technical">
            <DeviceDiagnostics device={device} />
            <details className="device-explanation">
              <summary>{t('How this energy is calculated')}</summary>
              <p className="field-help">
                {t(
                  device.energySource === 'power'
                    ? 'We integrate power readings taken every 60 seconds. Missing or invalid readings and gaps over 3 minutes stop counting. ≈ marks consumption calculated from sampled power; it is not a kWh meter reading.'
                    : device.energySource === 'estimated'
                      ? 'Readings are taken every 60 seconds. A gap over 3 minutes or an unknown state stops counting. Short cycles may be missed; estimates are for detecting excessive usage, not billing.'
                      : device.energyKind === 'incremental'
                        ? 'We add up energy reports received live. Repeated copies of the same report do not increase usage. Interruptions can leave gaps; earlier reports are not recovered. Point reports do not establish time coverage, so the total remains partial.'
                        : device.energySource === 'missing'
                          ? 'Configure estimation in Edit.'
                          : 'The first reading is a baseline. Usage is calculated from subsequent valid readings; earlier Smart Life history is not imported.',
                )}
              </p>
              {device.estimation.enabled && (
                <p className="field-help">
                  {t('Total observed')}: {number(device.estimation.totalHeatingHours)} h
                </p>
              )}
            </details>
          </section>
        </>
      )}
    </div>
  );
}
