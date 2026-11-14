import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { HomeLocation as Location } from '../shared/types';
import { api } from './api';
import { Notice } from './components';
import { useI18n } from './i18n';
import { messages } from './locales/weather';

type Props = {
  homeId: string;
  location: Location | null;
  onSaved: (location: Location | null) => void;
};

export function HomeLocation(props: Props) {
  return <LocationPanel key={props.homeId} {...props} />;
}
function LocationPanel({ homeId, location, onSaved }: Props) {
  const { t } = useI18n(messages);
  const [editing, setEditing] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  function close() {
    setEditing(false);
    requestAnimationFrame(() => opener.current?.focus());
  }
  return (
    <section className="home-location" aria-label={t('Apartment location')}>
      <h3>{t('Apartment location')}</h3>
      {editing ? (
        <LocationForm
          homeId={homeId}
          location={location}
          onCancel={close}
          onSaved={(value) => {
            onSaved(value);
            close();
          }}
        />
      ) : (
        <>
          <p>
            {location?.label ??
              t(
                'No location selected. Add an address to see outdoor temperatures and the forecast.',
              )}
          </p>
          <button
            ref={opener}
            type="button"
            className="button secondary compact"
            onClick={() => setEditing(true)}
          >
            {t('Edit location')}
          </button>
        </>
      )}
    </section>
  );
}

function LocationForm({ homeId, location, onSaved, onCancel }: Props & { onCancel: () => void }) {
  const { t } = useI18n(messages);
  const [query, setQuery] = useState(location?.label ?? '');
  const [selected, setSelected] = useState<Location | null | undefined>(location);
  const [results, setResults] = useState<Location[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const searchRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      searchRequest.current?.abort();
      saveRequest.current?.abort();
    },
    [],
  );
  async function search() {
    if (query.trim().length < 3 || saving.current) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setResults(null);
    setError('');
    try {
      const found = await api<Location[]>(
        `/locations/search?q=${encodeURIComponent(query.trim())}`,
        'GET',
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) setResults(found);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current || selected === undefined || searching) return;
    saving.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    saveRequest.current = controller;
    try {
      const result = await api<{ location: Location | null }>(
        `/homes/${homeId}/location`,
        'PUT',
        { location: selected },
        controller.signal,
      );
      if (!controller.signal.aborted) onSaved(result.location);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      saving.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <form onSubmit={save} aria-label={t('Apartment location')} aria-busy={busy}>
      {error && <Notice tone="error">{t(error)}</Notice>}
      <fieldset disabled={busy}>
        <label>
          {t('Address')}
          <input
            autoFocus
            name="address"
            value={query}
            maxLength={200}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void search();
              }
            }}
            onChange={(event) => {
              searchRequest.current?.abort();
              setSearching(false);
              setQuery(event.target.value);
              setResults(null);
              setSelected(undefined);
            }}
          />
        </label>
        <p className="field-help">
          {t(
            'Search by street and city. The search is sent to Photon; only coordinates are sent to the weather service.',
          )}
        </p>
        <button
          type="button"
          className="button secondary compact"
          disabled={searching || query.trim().length < 3}
          onClick={() => void search()}
        >
          {t(searching ? 'Searching…' : 'Search address')}
        </button>
        {results && (
          <div className="location-results" aria-live="polite">
            {!results.length && (
              <p>{t('No addresses found. Try adding the city or postal code.')}</p>
            )}
            {results.map((result, i) => (
              <button
                key={i}
                type="button"
                className="button secondary"
                aria-pressed={
                  selected?.label === result.label &&
                  selected?.latitude === result.latitude &&
                  selected?.longitude === result.longitude
                }
                onClick={() => setSelected(result)}
              >
                {result.label}
              </button>
            ))}
          </div>
        )}
        <p aria-live="polite">
          {selected
            ? t('Selected location: {address}', { address: selected.label })
            : selected === null
              ? t('Outdoor weather will be disabled after saving.')
              : t('Choose an address from the results.')}
        </p>
        {location && (
          <button
            type="button"
            className="button secondary compact"
            onClick={() => {
              searchRequest.current?.abort();
              setSearching(false);
              setSelected(null);
              setResults(null);
            }}
          >
            {t('Remove location')}
          </button>
        )}
        <div className="rules-actions">
          <button type="button" className="button secondary" onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || searching || selected === undefined}
          >
            {t(busy ? 'Saving…' : 'Save location')}
          </button>
        </div>
        <p className="field-help">
          <a href="https://photon.komoot.io/">Photon</a> · ©{' '}
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
        </p>
      </fieldset>
    </form>
  );
}
