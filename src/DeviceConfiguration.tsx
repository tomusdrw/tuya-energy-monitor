import { useState, type FormEvent } from 'react';
import { RefreshCw, Save } from 'lucide-react';
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
import { messages as estimationMessages } from './locales/estimation';
import { messages as pageMessages } from './locales/pages';
const messages = { ...pageMessages, ...estimationMessages };

const fieldLabels: Record<string, string> = {
  work_state: 'Heating activity',
  heating_state: 'Heating activity',
  heat_state: 'Heating activity',
  relay_state: 'Heating relay',
  switch: 'Thermostat power',
};

export function DeviceConfiguration({
  device,
  days,
  onSaved,
  onCancel,
  onRefresh,
}: {
  device: DeviceDetail;
  days: number;
  onSaved: (device: DeviceDetail) => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  const { t, number } = useI18n(messages);
  const [included, setIncluded] = useState(device.included);
  const [estimationEdited, setEstimationEdited] = useState(false);
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
    [error, setError] = useState('');
  const fieldLabel = (value: string) =>
    fieldLabels[value] ? `${t(fieldLabels[value])} (${value})` : value;
  function markEstimationEdited() {
    setEstimationEdited(true);
    // Button choices do not emit change events; freeze every part of the draft
    // for both buttons and fields before a probe can supply new defaults.
    setMapping((current) => current ?? mapping);
    setMethod((current) => current ?? method);
    setTemperature((current) => current ?? temperature);
  }
  function chooseField(value: string) {
    const field = e.statusFields.find((candidate) => candidate.code === value);
    setMapping(
      (field && suggestHeatingMapping(field)) ?? {
        heatingCode: value || null,
        onValues: [],
        offValues: [],
      },
    );
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
  }
  async function probe() {
    setProbing(true);
    setProbeError('');
    setProbeDone(false);
    try {
      setProbed(await api<EstimationView>(`/devices/${device.id}/probe`, 'POST', {}));
      setProbeDone(true);
      onRefresh();
    } catch (err) {
      setProbeError((err as Error).message);
    } finally {
      setProbing(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ device: DeviceDetail }>(
        `/devices/${device.id}?days=${days}`,
        'PUT',
        {
          included,
          ...(estimationEdited && device.energySource !== 'power'
            ? {
                estimation: {
                  enabled,
                  ratedPowerKw: power === '' ? null : Number(power),
                  heatingCode: method === 'relay' ? code.trim() || null : null,
                  onValues: method === 'relay' ? mapping.onValues : [],
                  offValues: method === 'relay' ? mapping.offValues : [],
                  temperature: method === 'temperature' ? temperature : null,
                },
              }
            : {}),
        },
      );
      onSaved(result.device);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="panel estimation-panel device-configuration"
      onSubmit={save}
      aria-label={t('Device configuration')}
    >
      <SectionTitle
        title={t('Device configuration')}
        subtitle={t('Changes take effect only after saving.')}
      />
      {error && <Notice tone="error">{t(error)}</Notice>}
      <fieldset disabled={busy || probing}>
        <h3>{t('Monitoring participation')}</h3>
        {device.ignored && (
          <Notice>
            {t('This device is ignored. Enabling monitoring also restores it to the device list.')}
          </Notice>
        )}
        <label className="check-label">
          <input
            autoFocus
            type="checkbox"
            checked={included}
            onChange={(event) => setIncluded(event.target.checked)}
          />
          {t('Include in apartment total and alert rules')}
        </label>
        <p className="field-help">
          {t(
            'A device without readings is marked as a missing part of the total. Changing the selection also recalculates history for the current set of devices.',
          )}
        </p>
      </fieldset>
      {device.energySource === 'power' ? (
        <Notice>
          {t(
            'Energy is calculated automatically from the device’s measured power. No rated power or heating signal configuration is needed.',
          )}
        </Notice>
      ) : (
        <>
          <h3 className="configuration-section-title">{t('Heating runtime estimation')}</h3>
          {device.energySource === 'measured' && (
            <Notice>
              {t(
                'The device provides energy readings. Measurements take precedence; estimation does not add usage for the same device.',
              )}
            </Notice>
          )}
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
          <fieldset disabled={busy || probing} onChange={markEstimationEdited}>
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
                              const field = e.statusFields.find(
                                (f) => f.code === event.target.value,
                              );
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
                      markEstimationEdited();
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
                  markEstimationEdited();
                }}
              >
                {t('Use detected field: {code}', { code: e.suggestion.heatingCode ?? '' })}
              </button>
            )}
            {method === 'relay' && code && !selectedField && (
              <Notice tone="warning">
                {t(
                  'The selected field is absent from the latest reading. Its assignments are kept.',
                )}
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
                name="estimationEnabled"
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
          </fieldset>
        </>
      )}
      <div className="form-footer device-form-footer">
        <p className="field-help">
          {t('Estimation changes apply to future readings. Recorded readings remain unchanged.')}
        </p>
        <div className="button-row">
          <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || probing || (estimationEdited && enabled && !completeMapping)}
          >
            <Save size={16} aria-hidden="true" />
            {busy ? t('Saving…') : t('Save')}
          </button>
        </div>
      </div>
    </form>
  );
}
