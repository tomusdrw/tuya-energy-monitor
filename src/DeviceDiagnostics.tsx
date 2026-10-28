import type { DeviceDetail } from '../shared/types';
import { useI18n } from './i18n';
import { messages } from './locales/estimation';

const stateLabel = { on: 'Heating active', off: 'Idle', unknown: 'Heating state unknown' };

export function DeviceDiagnostics({ device }: { device: DeviceDetail }) {
  const { t, number, date } = useI18n(messages);
  const e = device.estimation;
  return (
    <details className="device-diagnostics">
      <summary>{t('Technical details')}</summary>
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
  );
}
