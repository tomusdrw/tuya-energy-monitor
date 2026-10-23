import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { HomeView } from '../shared/types';
import { useI18n } from './i18n';
import { messages } from './locales/pages';

export function HomeSwitcher({
  id,
  homes,
}: {
  id: string;
  homes: Pick<HomeView, 'id' | 'name' | 'accountLabel'>[];
}) {
  const { t, number } = useI18n(messages);
  const index = homes.findIndex((home) => home.id === id);
  if (homes.length < 2 || index < 0) return null;
  const label = (home: (typeof homes)[number]) =>
    homes.some((other) => other.id !== home.id && other.name === home.name)
      ? `${home.name} · ${home.accountLabel}`
      : home.name;
  const previous = homes[index - 1],
    next = homes[index + 1];
  const previousLabel = previous
    ? `${t('Previous apartment')}: ${label(previous)}`
    : t('Previous apartment');
  const nextLabel = next ? `${t('Next apartment')}: ${label(next)}` : t('Next apartment');
  return (
    <div className="home-switcher">
      <div className="home-switcher-select">
        <select
          aria-label={t('Switch apartment')}
          value={id}
          onChange={(event) => {
            window.location.hash = `home/${event.target.value}`;
          }}
        >
          {homes.map((home) => (
            <option key={home.id} value={home.id}>
              {label(home)}
            </option>
          ))}
        </select>
        <ChevronDown size={20} aria-hidden="true" />
      </div>
      <nav className="home-switcher-navigation" aria-label={t('Switch apartment')}>
        <button
          type="button"
          className="button secondary home-switcher-arrow"
          disabled={!previous}
          aria-label={previousLabel}
          title={previousLabel}
          onClick={() => {
            if (previous) window.location.hash = `home/${previous.id}`;
          }}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="home-switcher-position" aria-live="polite">
          {t('{current} of {total}', {
            current: number(index + 1, 0),
            total: number(homes.length, 0),
          })}
        </span>
        <button
          type="button"
          className="button secondary home-switcher-arrow"
          disabled={!next}
          aria-label={nextLabel}
          title={nextLabel}
          onClick={() => {
            if (next) window.location.hash = `home/${next.id}`;
          }}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
