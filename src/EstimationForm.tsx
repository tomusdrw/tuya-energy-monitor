import { useState, type FormEvent } from 'react';
import { Flame, Save } from 'lucide-react';
import type { DeviceDetail, StatusValue } from '../shared/types';
import { api } from './api';
import { Badge, Notice, SectionTitle } from './components';
import { useI18n } from './i18n';
import { messages } from './locales/estimation';

const stateLabel = { on: 'Heating active', off: 'Idle', unknown: 'Heating state unknown' };
function parseValues(text: string): StatusValue[] {
  let values: unknown;
  try {
    values = JSON.parse(text);
  } catch {
    throw new Error('Enter a list of values, e.g. ["heating"] or [true].');
  }
  if (
    !Array.isArray(values) ||
    !values.every((v) => ['string', 'number', 'boolean'].includes(typeof v))
  )
    throw new Error('The list may contain text, numbers, or true / false.');
  return values as StatusValue[];
}

export function EstimationForm({ device, onSaved }: { device: DeviceDetail; onSaved: () => void }) {
  const { t, number, date } = useI18n(messages);
  const e = device.estimation;
  const [enabled, setEnabled] = useState(e.enabled);
  const defaultPower = device.category === 'wk' ? 1.25 : '';
  const [power, setPower] = useState(String(e.ratedPowerKw ?? defaultPower));
  const [code, setCode] = useState(e.heatingCode ?? '');
  const [on, setOn] = useState(JSON.stringify(e.onValues));
  const [off, setOff] = useState(JSON.stringify(e.offValues));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api(`/devices/${device.id}/estimation`, 'PUT', {
        enabled,
        ratedPowerKw: power === '' ? null : Number(power),
        heatingCode: code.trim() || null,
        onValues: parseValues(on),
        offValues: parseValues(off),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel estimation-panel">
      <SectionTitle
        title={t('Heating runtime estimation')}
        subtitle={t('For electric heating with a constant power rating')}
      >
        <Flame size={22} />
      </SectionTitle>
      <div className="estimation-status">
        <Badge tone={e.state === 'on' ? 'warning' : e.state === 'off' ? 'success' : 'muted'}>
          {t(stateLabel[e.state])}
        </Badge>
        <span>{e.enabled ? t('Estimation enabled') : t('Estimation disabled')}</span>
      </div>
      <div className="runtime-grid">
        <div>
          <span>{t('Heating time today')}</span>
          <strong>
            {number(device.stats.heatingHours)} <small>h</small>
          </strong>
        </div>
        <div>
          <span>{t('Total observed')}</span>
          <strong>
            {number(e.totalHeatingHours)} <small>h</small>
          </strong>
        </div>
        <div className="formula">
          <span>{t('Estimated usage')}</span>
          <strong>{t('power × heating time')}</strong>
          <small>kW × h = kWh</small>
        </div>
      </div>
      {device.energySource === 'measured' ? (
        <Notice>
          {t(
            'The device provides energy readings. Measurements take precedence; estimation does not add usage for the same device.',
          )}
        </Notice>
      ) : e.enabled && e.state === 'unknown' ? (
        <Notice tone="warning">
          {t(
            'No current, recognized heating signal. This period remains missing data even when the thermostat is online.',
          )}
        </Notice>
      ) : null}
      <p className="field-help">
        {t(
          'Turning the thermostat on (e.g. switch) does not confirm that the heater is running. Choose a field that indicates active heating and enter the power of the circuit controlled by the thermostat.',
        )}
      </p>
      <form onSubmit={save} onChange={() => setSaved(false)}>
        {error && <Notice tone="error">{t(error)}</Notice>}
        <label className="check-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          {t('Enable estimation for this device')}
        </label>
        <div className="form-two estimation-fields">
          <label>
            {t('Heating power (kW)')}
            <input
              type="number"
              inputMode="decimal"
              min="0.001"
              max="1000"
              step="any"
              placeholder={t('e.g. 1.2')}
              required={enabled}
              value={power}
              onChange={(event) => setPower(event.target.value)}
            />
          </label>
          <label>
            {t('Active heating field')}
            <input
              list={`fields-${device.id}`}
              value={code}
              placeholder={t('e.g. work_state')}
              maxLength={100}
              required={enabled}
              onChange={(event) => setCode(event.target.value)}
            />
            <datalist id={`fields-${device.id}`}>
              {e.statusFields.map((field) => (
                <option key={field.code} value={field.code}>
                  {JSON.stringify(field.value)}
                </option>
              ))}
            </datalist>
          </label>
        </div>
        {device.category === 'wk' && (
          <p className="field-help">
            {t(
              'The default of {power} kW is an assumed power rating. You can change it to the total heating power controlled by this thermostat.',
              { power: number(1.25) },
            )}
          </p>
        )}
        {e.suggestion && (
          <button
            type="button"
            className="button secondary compact"
            onClick={() => {
              setCode(e.suggestion!.heatingCode!);
              setOn(JSON.stringify(e.suggestion!.onValues));
              setOff(JSON.stringify(e.suggestion!.offValues));
              setSaved(false);
            }}
          >
            {t('Use detected field: {code}', { code: e.suggestion.heatingCode ?? '' })}
          </button>
        )}
        <div className="form-two estimation-fields">
          <label>
            {t('Values while heating')}
            <input
              value={on}
              maxLength={4000}
              onChange={(event) => setOn(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            {t('Values while idle')}
            <input
              value={off}
              maxLength={4000}
              onChange={(event) => setOff(event.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <p className="field-help">
          {t(
            'Value lists: ["heating"] and ["standby", "idle"], or [true] and [false]. Put text in quotes. All other values mean missing data.',
          )}
        </p>
        <div className="form-footer">
          <span className="saved-message" role="status">
            {saved
              ? t('Estimation configuration saved.')
              : t('Changes apply to future readings. History remains unchanged.')}
          </span>
          <button className="button primary" disabled={busy}>
            <Save size={16} />
            {busy ? t('Saving…') : t('Save estimation')}
          </button>
        </div>
      </form>
      <details className="estimation-details">
        <summary>{t('Available fields and latest states')}</summary>
        <p className="field-help">
          {t(
            'Last field reading: {date}. This data comes from the cloud and does not confirm a new transmission from the device.',
            { date: date(e.statusUpdatedAt) },
          )}
        </p>
        {e.statusFields.length ? (
          <div className="diagnostic-scroll">
            <table className="diagnostic-table">
              <thead>
                <tr>
                  <th>{t('Field')}</th>
                  <th>{t('Value')}</th>
                  <th>{t('Known values')}</th>
                </tr>
              </thead>
              <tbody>
                {e.statusFields.map((field) => (
                  <tr key={field.code}>
                    <td>
                      <code>{field.code}</code>
                    </td>
                    <td>
                      <code>{JSON.stringify(field.value)}</code>
                    </td>
                    <td>{field.values?.map((v) => JSON.stringify(v)).join(', ') ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="field-help">{t('No fields available in the latest reading.')}</p>
        )}
        <h3>{t('Recent heating observations')}</h3>
        {e.observations.length ? (
          <div className="diagnostic-scroll">
            <table className="diagnostic-table">
              <thead>
                <tr>
                  <th>{t('Time')}</th>
                  <th>{t('State')}</th>
                  <th>{t('Field / value')}</th>
                  <th>{t('Power / version')}</th>
                </tr>
              </thead>
              <tbody>
                {e.observations.map((row) => (
                  <tr key={row.at}>
                    <td>{date(row.at)}</td>
                    <td>{t(stateLabel[row.state])}</td>
                    <td>
                      <code>
                        {row.code ?? '—'}: {JSON.stringify(row.rawValue)}
                      </code>
                    </td>
                    <td>
                      {number(row.ratedPowerKw)} kW / {row.revision}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="field-help">
            {t('Observations will be recorded after estimation is enabled.')}
          </p>
        )}
      </details>
      <p className="field-help">
        {t(
          'Readings are taken every 60 seconds. A gap over 3 minutes or an unknown state stops counting. Short cycles may be missed; estimates are for detecting excessive usage, not billing.',
        )}
      </p>
    </section>
  );
}
