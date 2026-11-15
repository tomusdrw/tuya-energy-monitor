import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, LoaderCircle, MapPin, Search, Trash2, X } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const editOpener = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!expanded || editing) return;
    function dismissOutside(event: Event) {
      if (!container.current?.contains(event.target as Node)) setExpanded(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setExpanded(false);
      opener.current?.focus();
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', escape);
    };
  }, [expanded, editing]);

  function edit() {
    setExpanded(false);
    setEditing(true);
  }
  function close(showLocation = location !== null) {
    setExpanded(showLocation);
    setEditing(false);
    requestAnimationFrame(() => {
      const target = location ? (editOpener.current ?? opener.current) : opener.current;
      target?.focus();
    });
  }
  return (
    <div className="home-location" ref={container}>
      {location ? (
        <>
          <button
            ref={opener}
            type="button"
            className="icon-button location-trigger"
            aria-label={t('Apartment location')}
            title={t('Apartment location')}
            aria-expanded={expanded}
            aria-controls={expanded ? popoverId : undefined}
            onClick={() => setExpanded(!expanded)}
          >
            <MapPin size={18} aria-hidden="true" />
          </button>
          {expanded && (
            <section id={popoverId} className="location-popover" aria-labelledby={titleId}>
              <h3 id={titleId}>{t('Apartment location')}</h3>
              <p className="location-address">{location.label}</p>
              <p className="location-caption">
                {t('Used for outdoor temperatures and the forecast.')}
              </p>
              <button
                ref={editOpener}
                type="button"
                className="button secondary compact"
                aria-haspopup="dialog"
                onClick={edit}
              >
                {t('Edit location')}
              </button>
            </section>
          )}
        </>
      ) : (
        <button
          ref={opener}
          type="button"
          className="button secondary compact"
          aria-haspopup="dialog"
          onClick={edit}
        >
          <MapPin size={16} aria-hidden="true" />
          {t('Set location')}
        </button>
      )}
      {editing && (
        <LocationForm
          homeId={homeId}
          location={location}
          onCancel={() => close()}
          onSaved={(value) => {
            onSaved(value);
            close(value !== null);
          }}
        />
      )}
    </div>
  );
}

function LocationForm({ homeId, location, onSaved, onCancel }: Props & { onCancel: () => void }) {
  const { t } = useI18n(messages);
  const [query, setQuery] = useState(location?.label ?? '');
  const [selected, setSelected] = useState<Location | null | undefined>(location ?? undefined);
  const [initialLocation] = useState(location);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const helpId = useId();
  const searchHelpId = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
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
  return createPortal(
    <dialog
      ref={dialog}
      className="device-selection-dialog location-dialog"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving.current) onCancel();
      }}
    >
      <div className="selection-heading">
        <div className="location-dialog-title">
          <span className="location-dialog-icon">
            <MapPin size={22} aria-hidden="true" />
          </span>
          <h2 id={titleId}>{t('Apartment location')}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Close')}
          disabled={busy}
          onClick={onCancel}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="location-dialog-help" id={helpId}>
        {t('Choose an address to compare indoor temperatures with the weather outside.')}
      </p>
      <form onSubmit={save} aria-label={t('Apartment location')} aria-busy={busy}>
        {error && <Notice tone="error">{t(error)}</Notice>}
        <fieldset disabled={busy}>
          <label className="location-search-label">
            {t('Address')}
            <input
              autoFocus
              name="address"
              value={query}
              placeholder={t('Street and city')}
              aria-describedby={searchHelpId}
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
          <div className="location-search-actions">
            <p id={searchHelpId}>{t('Enter at least 3 characters, then search.')}</p>
            <button
              type="button"
              className="button secondary compact"
              disabled={searching || query.trim().length < 3}
              onClick={() => void search()}
            >
              {searching ? (
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
              ) : (
                <Search size={16} aria-hidden="true" />
              )}
              {t(searching ? 'Searching…' : 'Search address')}
            </button>
          </div>
          <div className="location-results" aria-live="polite" aria-busy={searching}>
            {results &&
              (!results.length ? (
                <p className="location-empty">
                  {t('No addresses found. Try adding the city or postal code.')}
                </p>
              ) : (
                <>
                  <h3>{t('Search results')}</h3>
                  <ul>
                    {results.map((result, i) => {
                      const isSelected =
                        selected?.label === result.label &&
                        selected?.latitude === result.latitude &&
                        selected?.longitude === result.longitude;
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            className="location-result"
                            aria-pressed={isSelected}
                            onClick={() => setSelected(result)}
                          >
                            <MapPin size={17} aria-hidden="true" />
                            <span>{result.label}</span>
                            {isSelected && <Check size={18} aria-hidden="true" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ))}
          </div>
          <div
            className={`location-selection${selected === null ? ' removing' : ''}`}
            aria-live="polite"
          >
            <MapPin size={18} aria-hidden="true" />
            <p>
              {selected
                ? t('Selected location: {address}', { address: selected.label })
                : selected === null
                  ? t('Outdoor weather will be disabled after saving.')
                  : t('Choose an address from the results.')}
            </p>
          </div>
          <p className="location-privacy">
            {t(
              'Search by street and city. The search is sent to Photon; only coordinates are sent to the weather service.',
            )}{' '}
            <a href="https://photon.komoot.io/">Photon</a> · ©{' '}
            <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
          </p>
          <div className="location-form-footer">
            {initialLocation && (
              <button
                type="button"
                className="button location-remove compact"
                disabled={selected === null}
                onClick={() => {
                  searchRequest.current?.abort();
                  setSearching(false);
                  setSelected(null);
                  setResults(null);
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
                {t('Remove location')}
              </button>
            )}
            <div className="location-save-actions">
              <button type="button" className="button secondary" onClick={onCancel}>
                {t('Cancel')}
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={busy || searching || selected === undefined}
              >
                {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
                {t(busy ? 'Saving…' : 'Save location')}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
    </dialog>,
    document.body,
  );
}
