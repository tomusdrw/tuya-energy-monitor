import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  LANGUAGE_KEY,
  readLanguage,
  saveLanguage,
  translate,
  formatNumber,
  formatDate,
  formatDay,
  type Language,
  type Messages,
  type MessageParams,
} from '../shared/i18n';
import { localizeSystemMessage } from '../shared/systemMessages';

const LanguageContext = createContext<{
  language: Language;
  setLanguage(language: Language): void;
}>({ language: 'en', setLanguage: () => {} });

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function LanguageProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguage] = useState<Language>(
    () => initialLanguage ?? readLanguage(browserStorage()),
  );
  useEffect(() => {
    document.documentElement.lang = language;
    saveLanguage(language, browserStorage());
  }, [language]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === LANGUAGE_KEY || event.key === null)
        setLanguage(readLanguage(browserStorage()));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n(messages: Messages = {}) {
  const context = useContext(LanguageContext);
  const { language } = context;
  const number = (value: number | null | undefined, digits = 2) =>
    formatNumber(language, value, digits);
  return {
    ...context,
    t: (message: string, params?: MessageParams) =>
      translate(language, localizeSystemMessage(message, language), messages, params),
    number,
    date: (at: number | null | undefined, withTime = true) => formatDate(language, at, withTime),
    day: (value: string) => formatDay(language, value),
    percent: (value: number) => `${Math.round(value * 100)}%`,
    energyNumber: (stats: {
      kwh: number | null;
      estimatedKwh: number | null;
      powerKwh?: number | null;
    }) =>
      `${stats.estimatedKwh !== null || stats.powerKwh != null ? '≈ ' : ''}${number(stats.kwh)}`,
  };
}

export function LanguageSwitcher() {
  const { language, setLanguage } = useI18n();
  return (
    <label className="language-switcher">
      <span>{language === 'pl' ? 'Język' : 'Language'}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value === 'pl' ? 'pl' : 'en')}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="pl" lang="pl">
          Polski
        </option>
      </select>
    </label>
  );
}
