export type Language = 'en' | 'pl';
export type Messages = Readonly<Record<string, string>>;
export type MessageParams = Readonly<Record<string, string | number>>;
export const LANGUAGE_KEY = 'tuya-energy-language';

export function readLanguage(storage?: { getItem(key: string): string | null }): Language {
  try {
    return storage?.getItem(LANGUAGE_KEY) === 'pl' ? 'pl' : 'en';
  } catch {
    return 'en';
  }
}

export function saveLanguage(
  language: Language,
  storage?: { setItem(key: string, value: string): void },
): void {
  try {
    storage?.setItem(LANGUAGE_KEY, language);
  } catch {
    // The in-memory selection still works when browser storage is unavailable.
  }
}

export function translate(
  language: Language,
  message: string,
  messages: Messages = {},
  params: MessageParams = {},
): string {
  const text = language === 'pl' && Object.hasOwn(messages, message) ? messages[message] : message;
  return text.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : placeholder,
  );
}

export const localeFor = (language: Language) => (language === 'pl' ? 'pl-PL' : 'en-GB');

export function formatNumber(
  language: Language,
  value: number | null | undefined,
  digits = 2,
): string {
  return value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(localeFor(language), {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value);
}

export function formatDate(
  language: Language,
  at: number | null | undefined,
  withTime = true,
): string {
  return at === null || at === undefined
    ? language === 'pl'
      ? 'Jeszcze nie odczytano'
      : 'No readings yet'
    : new Intl.DateTimeFormat(localeFor(language), {
        timeZone: 'Europe/Warsaw',
        day: '2-digit',
        month: 'short',
        ...(withTime ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
      }).format(at);
}

export function formatDay(language: Language, day: string): string {
  return formatDate(language, Date.parse(`${day}T12:00:00Z`), false);
}
