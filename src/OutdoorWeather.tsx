import type { ClimateHistoryPoint, HomeLocation, OutdoorWeather as Weather } from '../shared/types';
import { useApi } from './api';
import { ClimateHistory } from './Climate';
import { Notice } from './components';
import { useI18n } from './i18n';
import { messages } from './locales/weather';

type Props = {
  homeId: string;
  location: HomeLocation | null;
  days: number;
  points: ClimateHistoryPoint[];
};
export function OutdoorWeather(props: Props) {
  if (!props.location) return <ClimateHistory points={props.points} />;
  return (
    <WeatherHistory key={JSON.stringify([props.homeId, props.location, props.days])} {...props} />
  );
}
function WeatherHistory({ homeId, location, days, points }: Props) {
  const { t, date } = useI18n(messages);
  const { data, error, refresh } = useApi<Weather>(`/homes/${homeId}/weather?days=${days}`);
  // A concurrent edit in another session may change the server's saved location.
  const matching =
    data?.location?.latitude === location?.latitude &&
    data?.location?.longitude === location?.longitude;
  return (
    <>
      {error ? (
        <Notice tone="error">
          {t(error)}{' '}
          <button type="button" className="button secondary compact" onClick={refresh}>
            {t('Retry weather')}
          </button>
        </Notice>
      ) : (
        !data && (
          <p role="status" className="climate-help">
            {t('Loading outdoor weather…')}
          </p>
        )
      )}
      <ClimateHistory points={points} outdoor={matching && !error ? data?.points : undefined} />
      <p className="climate-help">
        {t(
          'Outdoor temperatures are daily model averages, including archived forecasts for past days. Today and the next three days are forecasts (dashed line), not sensor readings.',
        )}
      </p>
      {matching && data?.updatedAt && (
        <p className="climate-help">
          {t('Outdoor data: {address}. Updated: {date}.', {
            address: location!.label,
            date: date(data.updatedAt),
          })}
        </p>
      )}
      <p className="climate-help">
        <a href="https://open-meteo.com/">{t('Weather data by Open-Meteo')}</a> ·{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
      </p>
    </>
  );
}
