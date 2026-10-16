import { useState, type FormEvent } from 'react';
import { Flame, Save } from 'lucide-react';
import type { DeviceDetail, StatusValue } from '../shared/types';
import { api } from './api';
import { Badge, Notice, SectionTitle, date, number } from './components';

const stateLabel = { on: 'Grzanie aktywne', off: 'Postój', unknown: 'Stan grzania nieznany' };
function parseValues(text: string): StatusValue[] {
  let values: unknown;
  try {
    values = JSON.parse(text);
  } catch {
    throw new Error('Wpisz listę wartości, np. ["heating"] albo [true].');
  }
  if (
    !Array.isArray(values) ||
    !values.every((v) => ['string', 'number', 'boolean'].includes(typeof v))
  )
    throw new Error('Lista może zawierać tekst, liczby lub true / false.');
  return values as StatusValue[];
}

export function EstimationForm({ device, onSaved }: { device: DeviceDetail; onSaved: () => void }) {
  const e = device.estimation;
  const [enabled, setEnabled] = useState(e.enabled);
  const [power, setPower] = useState(e.ratedPowerKw === null ? '' : String(e.ratedPowerKw));
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
        title="Estymacja z czasu grzania"
        subtitle="Dla ogrzewania elektrycznego o stałej mocy"
      >
        <Flame size={22} />
      </SectionTitle>
      <div className="estimation-status">
        <Badge tone={e.state === 'on' ? 'warning' : e.state === 'off' ? 'success' : 'muted'}>
          {stateLabel[e.state]}
        </Badge>
        <span>{e.enabled ? 'Estymacja włączona' : 'Estymacja wyłączona'}</span>
      </div>
      <div className="runtime-grid">
        <div>
          <span>Czas grzania dzisiaj</span>
          <strong>
            {number(device.stats.heatingHours)} <small>h</small>
          </strong>
        </div>
        <div>
          <span>Łącznie zaobserwowano</span>
          <strong>
            {number(e.totalHeatingHours)} <small>h</small>
          </strong>
        </div>
        <div className="formula">
          <span>Szacowane zużycie</span>
          <strong>moc × czas grzania</strong>
          <small>kW × h = kWh</small>
        </div>
      </div>
      {device.energySource === 'measured' ? (
        <Notice>
          Urządzenie ma licznik energii. Jego pomiar ma pierwszeństwo; estymacja nie dodaje zużycia
          dla tego samego urządzenia.
        </Notice>
      ) : e.enabled && e.state === 'unknown' ? (
        <Notice tone="warning">
          Brak aktualnego, rozpoznanego sygnału grzania. Ten okres pozostaje bez danych, nawet gdy
          termostat jest online.
        </Notice>
      ) : null}
      <p className="field-help">
        Samo włączenie termostatu (np. <code>switch</code>) nie potwierdza pracy grzałki. Wybierz
        pole pokazujące faktycznie załączone ogrzewanie i podaj moc obwodu, którym steruje
        termostat.
      </p>
      <form onSubmit={save} onChange={() => setSaved(false)}>
        {error && <Notice tone="error">{error}</Notice>}
        <label className="check-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Włącz estymację dla tego urządzenia
        </label>
        <div className="form-two estimation-fields">
          <label>
            Moc ogrzewania (kW)
            <input
              type="number"
              inputMode="decimal"
              min="0.001"
              max="1000"
              step="any"
              placeholder="np. 1,2"
              required={enabled}
              value={power}
              onChange={(event) => setPower(event.target.value)}
            />
          </label>
          <label>
            Pole aktywnego grzania
            <input
              list={`fields-${device.id}`}
              value={code}
              placeholder="np. work_state"
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
            Użyj wykrytego pola: {e.suggestion.heatingCode}
          </button>
        )}
        <div className="form-two estimation-fields">
          <label>
            Wartości podczas grzania
            <input
              value={on}
              maxLength={4000}
              onChange={(event) => setOn(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            Wartości podczas postoju
            <input
              value={off}
              maxLength={4000}
              onChange={(event) => setOff(event.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <p className="field-help">
          Listy wartości: <code>["heating"]</code> i <code>["standby", "idle"]</code> albo{' '}
          <code>[true]</code> i <code>[false]</code>. Tekst zapisz w cudzysłowie. Pozostałe wartości
          oznaczają brak danych.
        </p>
        <div className="form-footer">
          <span className="saved-message" role="status">
            {saved
              ? 'Konfiguracja estymacji zapisana.'
              : 'Zmiany dotyczą przyszłych odczytów. Historia pozostaje bez zmian.'}
          </span>
          <button className="button primary" disabled={busy}>
            <Save size={16} />
            {busy ? 'Zapisywanie…' : 'Zapisz estymację'}
          </button>
        </div>
      </form>
      <details className="estimation-details">
        <summary>Dostępne pola i ostatnie stany</summary>
        <p className="field-help">
          Ostatni odczyt pól: {date(e.statusUpdatedAt)}. To dane udostępnione przez chmurę, nie
          potwierdzenie nowej transmisji z urządzenia.
        </p>
        {e.statusFields.length ? (
          <div className="diagnostic-scroll">
            <table className="diagnostic-table">
              <thead>
                <tr>
                  <th>Pole</th>
                  <th>Wartość</th>
                  <th>Znane wartości</th>
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
          <p className="field-help">Brak dostępnych pól w ostatnim odczycie.</p>
        )}
        <h3>Ostatnie obserwacje grzania</h3>
        {e.observations.length ? (
          <div className="diagnostic-scroll">
            <table className="diagnostic-table">
              <thead>
                <tr>
                  <th>Czas</th>
                  <th>Stan</th>
                  <th>Pole / wartość</th>
                  <th>Moc / wersja</th>
                </tr>
              </thead>
              <tbody>
                {e.observations.map((row) => (
                  <tr key={row.at}>
                    <td>{date(row.at)}</td>
                    <td>{stateLabel[row.state]}</td>
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
          <p className="field-help">Obserwacje zaczną się zapisywać po włączeniu estymacji.</p>
        )}
      </details>
      <p className="field-help">
        Odczyt co 60 s. Przerwa powyżej 3 min lub nieznany stan przerywają liczenie. Krótkie cykle
        mogą zostać pominięte; szacunek służy wykrywaniu nadmiernego zużycia, nie rozliczeniom.
      </p>
    </section>
  );
}
