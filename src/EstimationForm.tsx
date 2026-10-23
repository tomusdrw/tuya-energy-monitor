import { useState, type FormEvent } from 'react';
import { Flame, RefreshCw, Save } from 'lucide-react';
import type {
  DeviceDetail,
  EstimationView,
  StatusValue,
  TemperatureMapping,
} from '../shared/types';
import { statusChoices, suggestHeatingMapping, type HeatingMapping } from '../shared/estimation';
import { temperatureHeatingState, temperatureValue } from '../shared/temperature';
import { api } from './api';
import { Badge, Notice, SectionTitle } from './components';
import { useI18n } from './i18n';
import { messages } from './locales/estimation';

const stateLabel = { on: 'Heating active', off: 'Idle', unknown: 'Heating state unknown' };
const fieldLabels: Record<string, string> = {
  work_state: 'Heating activity',
  heating_state: 'Heating activity',
  heat_state: 'Heating activity',
  relay_state: 'Heating relay',
  switch: 'Thermostat power',
};

export function EstimationForm({ device, onSaved }: { device: DeviceDetail; onSaved: () => void }) {
  return device.energySource === 'power' ? (
    <PowerMonitoring device={device} />
  ) : (
    <RuntimeEstimationForm device={device} onSaved={onSaved} />
  );
}

function PowerMonitoring({ device }: { device: DeviceDetail }) {
  const { t, date } = useI18n(messages);
  return (
    <section className="panel">
      <SectionTitle title={t('Energy from measured power')} />
      <Notice>
        {t(
          'Energy is calculated automatically from the device’s measured power. No rated power or heating signal configuration is needed.',
        )}
      </Notice>
      <p className="field-help">
        {t(
          'We integrate power readings taken every 60 seconds. Missing or invalid readings and gaps over 3 minutes stop counting. ≈ marks consumption calculated from sampled power; it is not a kWh meter reading.',
        )}
      </p>
      {!device.fresh && (
        <Notice tone="warning">
          {t('No current power reading. This period remains missing data.')}
        </Notice>
      )}
      <details className="estimation-details">
        <summary>{t('Available fields and latest states')}</summary>
        <p className="field-help">
          {t(
            'Last field reading: {date}. This data comes from the cloud and does not confirm a new transmission from the device.',
            { date: date(device.estimation.statusUpdatedAt) },
          )}
        </p>
        {device.estimation.statusFields.map((field) => (
          <p key={field.code}>
            <code>
              {field.code}: {JSON.stringify(field.value)}
            </code>
          </p>
        ))}
      </details>
    </section>
  );
}

function RuntimeEstimationForm({ device, onSaved }: { device: DeviceDetail; onSaved: () => void }) {
  const { t, number, date } = useI18n(messages);
  const [probed, setProbed] = useState<EstimationView | null>(null);
  const e =
    probed && (probed.statusUpdatedAt ?? 0) > (device.estimation.statusUpdatedAt ?? 0)
      ? probed
      : device.estimation;
  const [enabled, setEnabled] = useState(e.enabled);
  const defaultPower = device.category === 'wk' ? 1.25 : '';
  const [power, setPower] = useState(String(e.ratedPowerKw ?? defaultPower));
  const [editedMethod, setMethod] = useState<'relay' | 'temperature' | null>(null);
  const method =
    editedMethod ??
    (e.temperature || (!e.heatingCode && !e.suggestion && e.temperatureSuggestion)
      ? 'temperature'
      : 'relay');
  const [editedTemperature, setTemperature] = useState<TemperatureMapping | null>(null);
  const temperature = editedTemperature ?? e.temperature ?? e.temperatureSuggestion;
  const detectedTemperature = e.temperatureSuggestion;
  const matchesDetectedTemperature =
    temperature &&
    detectedTemperature &&
    temperature.switchCode === detectedTemperature.switchCode &&
    (['current', 'target'] as const).every(
      (role) =>
        temperature[role].code === detectedTemperature[role].code &&
        temperature[role].scale === detectedTemperature[role].scale &&
        temperature[role].unit === detectedTemperature[role].unit,
    );
  // An untouched form follows discovery; user edits remain stable across refreshes.
  const [editedMapping, setMapping] = useState<HeatingMapping | null>(null);
  const mapping = editedMapping ??
    (e.heatingCode ? e : e.suggestion) ?? {
      heatingCode: null,
      onValues: [],
      offValues: [],
    };
  const code = mapping.heatingCode ?? '';
  const selectedField = e.statusFields.find((field) => field.code === code);
  const choices = [
    ...new Set([
      ...(selectedField ? statusChoices(selectedField) : []),
      ...mapping.onValues,
      ...mapping.offValues,
    ]),
  ];
  const completeMapping =
    method === 'temperature'
      ? Boolean(temperature && temperature.current.code !== temperature.target.code)
      : Boolean(code && mapping.onValues.length && mapping.offValues.length);
  const currentTemperatureState = temperature
    ? temperatureHeatingState(e.statusFields, temperature)
    : null;
  const [probing, setProbing] = useState(false),
    [probeError, setProbeError] = useState(''),
    [probeDone, setProbeDone] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const fieldLabel = (value: string) =>
    fieldLabels[value] ? `${t(fieldLabels[value])} (${value})` : value;
  function chooseField(value: string) {
    const field = e.statusFields.find((candidate) => candidate.code === value);
    setMapping(
      (field && suggestHeatingMapping(field)) ?? {
        heatingCode: value || null,
        onValues: [],
        offValues: [],
      },
    );
    setSaved(false);
  }
  function assign(value: StatusValue, state: string) {
    setMapping({
      heatingCode: code,
      onValues: [
        ...mapping.onValues.filter((v) => v !== value),
        ...(state === 'on' ? [value] : []),
      ],
      offValues: [
        ...mapping.offValues.filter((v) => v !== value),
        ...(state === 'off' ? [value] : []),
      ],
    });
    setSaved(false);
  }
  async function probe() {
    setProbing(true);
    setProbeError('');
    setProbeDone(false);
    try {
      setProbed(await api<EstimationView>(`/devices/${device.id}/probe`, 'POST', {}));
      setProbeDone(true);
      onSaved();
    } catch (err) {
      setProbeError((err as Error).message);
    } finally {
      setProbing(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setMapping((current) => current ?? mapping);
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api(`/devices/${device.id}/estimation`, 'PUT', {
        enabled,
        ratedPowerKw: power === '' ? null : Number(power),
        heatingCode: method === 'relay' ? code.trim() || null : null,
        onValues: method === 'relay' ? mapping.onValues : [],
        offValues: method === 'relay' ? mapping.offValues : [],
        temperature: method === 'temperature' ? temperature : null,
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
        {e.temperature && <Badge tone="muted">{t('Temperature comparison')}</Badge>}
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
            'No current, valid heating data. This period remains missing data even when the thermostat is online.',
          )}
        </Notice>
      ) : null}
      <div className="discovery-toolbar">
        <div aria-live="polite">
          <strong>{t('Fields detected from the device')}</strong>
          <p className="field-help">
            {probing
              ? t('Reading device fields…')
              : probeDone
                ? t('Fields refreshed. Your selections have been kept.')
                : t('Choose from available fields and states. No field names or JSON to type.')}
          </p>
        </div>
        <button
          type="button"
          className="button secondary compact"
          disabled={probing || busy}
          onClick={() => void probe()}
        >
          <RefreshCw size={16} />
          {probing ? t('Detecting…') : t('Detect again')}
        </button>
      </div>
      {probeError && <Notice tone="error">{t(probeError)}</Notice>}
      {method === 'relay' && !e.suggestion && !e.heatingCode && (
        <Notice tone="warning">
          {t('No recognized heating signal was found.')}{' '}
          {t(
            'Select a field that reports heating, or choose temperature comparison when current and target temperatures are available.',
          )}
        </Notice>
      )}
      {method === 'relay' && (
        <p className="field-help">
          {t(
            'Turning the thermostat on (e.g. switch) does not confirm that the heater is running. Choose a field that indicates active heating and enter the power of the circuit controlled by the thermostat.',
          )}
        </p>
      )}
      <form
        onSubmit={save}
        onChange={() => {
          setSaved(false);
          setMapping((current) => current ?? mapping);
          setMethod((current) => current ?? method);
          setTemperature((current) => current ?? temperature);
        }}
      >
        {error && <Notice tone="error">{t(error)}</Notice>}
        <fieldset disabled={busy}>
          <div className="form-two estimation-fields">
            <label>
              {t('Estimation method')}
              <select
                name="estimationMethod"
                value={method}
                onChange={(event) => setMethod(event.target.value as 'relay' | 'temperature')}
              >
                <option value="relay">{t('Heating signal')}</option>
                <option value="temperature">{t('Temperature comparison')}</option>
              </select>
            </label>
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
            {method === 'relay' && (
              <label>
                {t('Active heating field')}
                <select
                  name="heatingCode"
                  value={code}
                  required={enabled}
                  onChange={(event) => chooseField(event.target.value)}
                >
                  <option value="">{t('Select a detected field')}</option>
                  {code && !selectedField && (
                    <option value={code}>{t('Selected field: {code}', { code })}</option>
                  )}
                  {e.statusFields.map((field) => (
                    <option key={field.code} value={field.code}>
                      {suggestHeatingMapping(field) ? `${t('Suggested')} · ` : ''}
                      {fieldLabel(field.code)} — {JSON.stringify(field.value)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {method === 'temperature' && (
            <>
              <p className="field-help">
                {t(
                  'Heating is estimated when the current temperature is below the target; at or above the target it is idle. An off thermostat is idle. Missing readings remain unknown. Thermostat hysteresis and heating schedules can make actual heating differ.',
                )}
              </p>
              {temperature ? (
                <div className="form-two estimation-fields">
                  {(['current', 'target'] as const).map((role) => {
                    const definition = temperature[role];
                    return (
                      <label key={role}>
                        {t(role === 'current' ? 'Current temperature' : 'Target temperature')}
                        <select
                          name={`${role}Temperature`}
                          value={definition.code}
                          onChange={(event) => {
                            const field = e.statusFields.find((f) => f.code === event.target.value);
                            if (field?.temperature)
                              setTemperature({
                                ...temperature,
                                [role]: { code: field.code, ...field.temperature },
                              });
                          }}
                        >
                          {!e.statusFields.some(
                            (f) => f.code === definition.code && f.temperature,
                          ) && <option value={definition.code}>{definition.code}</option>}
                          {e.statusFields
                            .filter((f) => f.temperature)
                            .map((field) => (
                              <option key={field.code} value={field.code}>
                                {field.code}
                              </option>
                            ))}
                        </select>
                        <span className="field-help">
                          {number(temperatureValue(e.statusFields, definition))} °C
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <Notice tone="warning">
                  {t(
                    'No current and target temperature fields with known units and scales were found. Detect again to refresh the device data.',
                  )}
                </Notice>
              )}
              {detectedTemperature && !matchesDetectedTemperature && (
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => {
                    setTemperature(e.temperatureSuggestion);
                    setSaved(false);
                  }}
                >
                  {t('Use detected temperatures')}
                </button>
              )}
            </>
          )}
          {device.category === 'wk' && (
            <p className="field-help">
              {t(
                'The default of {power} kW is an assumed power rating. You can change it to the total heating power controlled by this thermostat.',
                { power: number(1.25) },
              )}
            </p>
          )}
          {method === 'relay' && e.suggestion && code !== e.suggestion.heatingCode && (
            <button
              type="button"
              className="button secondary compact"
              onClick={() => {
                setMapping(e.suggestion!);
                setSaved(false);
              }}
            >
              {t('Use detected field: {code}', { code: e.suggestion.heatingCode ?? '' })}
            </button>
          )}
          {method === 'relay' && code && !selectedField && (
            <Notice tone="warning">
              {t('The selected field is absent from the latest reading. Its assignments are kept.')}
            </Notice>
          )}
          {method === 'relay' && selectedField && (
            <p className="field-help">
              {t('Latest state: {value}', { value: JSON.stringify(selectedField.value) })}
            </p>
          )}
          {method === 'relay' && choices.length > 0 && (
            <fieldset className="state-choices">
              <legend>{t('What does each state mean?')}</legend>
              {choices.map((value, index) => (
                <label className="state-choice" key={JSON.stringify(value)}>
                  <span>
                    <code>{JSON.stringify(value)}</code>
                    {selectedField?.value === value && <Badge tone="muted">{t('Current')}</Badge>}
                  </span>
                  <select
                    name={`state-${index}`}
                    aria-label={t('Meaning of {value}', { value: JSON.stringify(value) })}
                    value={
                      mapping.onValues.includes(value)
                        ? 'on'
                        : mapping.offValues.includes(value)
                          ? 'off'
                          : 'unknown'
                    }
                    onChange={(event) => assign(value, event.target.value)}
                  >
                    <option value="unknown">{t('Unknown / ignore')}</option>
                    <option value="on">{t('Heating active')}</option>
                    <option value="off">{t('Idle')}</option>
                  </select>
                </label>
              ))}
            </fieldset>
          )}
          {method === 'relay' && (
            <p className="field-help">
              {t(
                'Assign at least one heating state and one idle state. Unassigned states remain unknown. If a state is missing, detect again after the device reports it.',
              )}
            </p>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              disabled={
                !enabled &&
                (!completeMapping ||
                  (method === 'temperature' ? currentTemperatureState === null : !selectedField))
              }
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            {t('Enable estimation for this device')}
          </label>
          <div className="form-footer">
            <span className="saved-message" role="status">
              {saved
                ? t('Estimation configuration saved.')
                : t('Changes apply to future readings. History remains unchanged.')}
            </span>
            <button
              className="button primary"
              disabled={busy || probing || (enabled && !completeMapping)}
            >
              <Save size={16} />
              {busy ? t('Saving…') : t('Save estimation')}
            </button>
          </div>
        </fieldset>
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
