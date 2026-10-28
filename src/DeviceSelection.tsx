import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Settings2, X } from 'lucide-react';
import type { DeviceView, HomeDetail } from '../shared/types';
import { api, useApi } from './api';
import { Loading, Notice } from './components';
import { useI18n } from './i18n';
import { selectionMessages } from './locales/selection';

type SelectionMode = 'energy' | 'temperature';
type ListProps = {
  devices: DeviceView[];
  mode: SelectionMode;
  onSaved: () => void;
  onSavingChange?: (saving: boolean) => void;
};

function SelectionRow({
  device,
  mode,
  onSaved,
  onSavingChange,
}: Omit<ListProps, 'devices'> & { device: DeviceView }) {
  const { t, number, energyNumber } = useI18n(selectionMessages);
  const selected = mode === 'energy' ? device.included : device.temperatureIncluded;
  const [included, setIncluded] = useState(selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const errorId = useId();
  useEffect(() => setIncluded(selected), [selected]);

  async function update(value: boolean) {
    if (saving.current) return;
    saving.current = true;
    onSavingChange?.(true);
    setBusy(true);
    setError('');
    try {
      await api(
        `/devices/${device.id}`,
        'PUT',
        mode === 'energy' ? { included: value } : { temperatureIncluded: value },
      );
      setIncluded(value);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
      onSavingChange?.(false);
    }
  }

  return (
    <div className="selection-row" data-device-id={device.id}>
      <label className="selection-choice">
        <input
          type="checkbox"
          checked={included}
          aria-disabled={busy}
          aria-busy={busy}
          aria-label={t(
            mode === 'energy'
              ? 'Include {name} in heating total'
              : 'Include {name} in temperature average',
            { name: device.name },
          )}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => void update(event.target.checked)}
        />
        <span>
          <strong>{device.name}</strong>
          <small aria-live="polite">
            {busy ? (
              <>
                <LoaderCircle size={12} className="spin" aria-hidden="true" /> {t('Saving…')}
              </>
            ) : (
              t(
                mode === 'energy'
                  ? included
                    ? 'Included in heating total'
                    : 'Excluded from heating total'
                  : included
                    ? 'Included in average'
                    : 'Excluded from average',
              )
            )}
          </small>
          {mode === 'energy' && device.ignored && !included && (
            <small>{t('Selecting this device also restores it to the device list.')}</small>
          )}
        </span>
      </label>
      <span className="selection-reading tabular">
        {mode === 'temperature'
          ? device.temperature === null
            ? t('No current reading')
            : `${number(device.temperature, 1)} °C`
          : device.stats.kwh === null
            ? t('No energy data')
            : `${energyNumber(device.stats)} kWh`}
      </span>
      {error && (
        <div className="selection-error" id={errorId}>
          <Notice tone="error">{t(error)}</Notice>
        </div>
      )}
    </div>
  );
}

export function DeviceSelectionList({ devices, mode, onSaved, onSavingChange }: ListProps) {
  const { t } = useI18n(selectionMessages);
  const candidates = mode === 'temperature' ? devices.filter((d) => d.hasTemperature) : devices;
  return candidates.length ? (
    <div className="selection-list">
      {candidates.map((device) => (
        <SelectionRow
          key={device.id}
          device={device}
          mode={mode}
          onSaved={onSaved}
          onSavingChange={onSavingChange}
        />
      ))}
    </div>
  ) : (
    <p className="field-help">
      {t(mode === 'temperature' ? 'No temperature sensors' : 'No devices')}
    </p>
  );
}

type Props = { homeId: string; mode: SelectionMode; onSaved: () => void };

function SelectionDialog({
  homeId,
  mode,
  onSaved,
  onClose,
  open,
  onSavingChange,
}: Props & {
  onClose: () => void;
  open: boolean;
  onSavingChange: (saving: boolean) => void;
}) {
  const { t } = useI18n(selectionMessages);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const helpId = useId();
  const { data, error, refresh } = useApi<HomeDetail>(`/homes/${homeId}?days=1`);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return createPortal(
    <dialog
      ref={dialog}
      className="device-selection-dialog"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onClose={onClose}
    >
      <div className="selection-heading">
        <h2 id={titleId}>{t(mode === 'energy' ? 'Heating devices' : 'Temperature sensors')}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Close')}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </div>
      <p className="field-help" id={helpId}>
        {t(
          mode === 'energy'
            ? 'Choose devices for the apartment energy total, history and alerts. Changes are saved immediately.'
            : 'Choose sensors for the average, minimum, maximum and temperature history. Changes are saved immediately.',
        )}
      </p>
      {error && (
        <Notice tone="error">
          {t(error)}{' '}
          <button className="button secondary compact" onClick={refresh}>
            {t('Retry')}
          </button>
        </Notice>
      )}
      {!data && !error && <Loading />}
      {data && (
        <DeviceSelectionList
          devices={data.devices}
          mode={mode}
          onSavingChange={onSavingChange}
          onSaved={() => {
            refresh();
            onSaved();
          }}
        />
      )}
      <p className="selection-footer">
        {t(
          'Individual device readings remain available. History is recalculated for the current selection.',
        )}
      </p>
    </dialog>,
    document.body,
  );
}

export function DeviceSelection({ homeId, mode, onSaved }: Props) {
  const { t } = useI18n(selectionMessages);
  const [open, setOpen] = useState(false);
  const [pendingSaves, setPendingSaves] = useState(0);
  return (
    <>
      <button
        type="button"
        className="button secondary compact selection-trigger"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Settings2 size={15} aria-hidden="true" />
        {t(mode === 'energy' ? 'Choose devices' : 'Choose sensors')}
      </button>
      {/* Keep in-flight saves and row locks alive when the dialog is closed and reopened. */}
      {(open || pendingSaves > 0) && (
        <SelectionDialog
          homeId={homeId}
          mode={mode}
          onSaved={onSaved}
          open={open}
          onSavingChange={(saving) => setPendingSaves((count) => count + (saving ? 1 : -1))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function DeviceSelectionShortcuts({
  device,
  onSaved,
}: {
  device: DeviceView;
  onSaved: () => void;
}) {
  const { t } = useI18n(selectionMessages);
  return (
    <div className="panel">
      <h2>{t('Summary participation')}</h2>
      <p className="field-help">
        {t('Manage the apartment selections using the same controls as its summaries.')}
      </p>
      <div className="button-row">
        <DeviceSelection
          key={`${device.homeId}-energy`}
          homeId={device.homeId}
          mode="energy"
          onSaved={onSaved}
        />
        {device.hasTemperature && (
          <DeviceSelection
            key={`${device.homeId}-temperature`}
            homeId={device.homeId}
            mode="temperature"
            onSaved={onSaved}
          />
        )}
      </div>
    </div>
  );
}
