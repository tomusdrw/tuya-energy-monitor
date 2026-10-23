import { translate, type Language, type MessageParams } from '../shared/i18n.js';

const messages = {
  'From power: {power}.': 'Z pomiaru mocy: {power}.',
  'no data': 'brak danych',
  'Measured: {measured}; estimated: {estimated}.': 'Pomiar: {measured}; estymacja: {estimated}.',
  'Home: {name}\nDay: {day}\nObserved usage: {energy}\n{sources}\n':
    'Mieszkanie: {name}\nDzień: {day}\nZaobserwowane zużycie: {energy}\n{sources}\n',
  'Scope: {metered} with measurements, {estimated} estimated / {monitored} selected devices; time coverage {coverage}.\n':
    'Zakres: {metered} z pomiarem, {estimated} estymowanych / {monitored} wybranych urządzeń; pokrycie czasu {coverage}.\n',
  'Partial total. Missing readings do not mean zero usage.\n':
    'Suma częściowa. Brakujące pomiary nie są zerowym zużyciem.\n',
  '\nLargest contributors:\n{contributors}': '\nNajwiększy udział w sumie:\n{contributors}',
  'No readings available.': 'Brak dostępnych odczytów.',
  'Energy threshold: {name}': 'Próg energii: {name}',
  '\n\nDaily threshold exceeded: {limit}.': '\n\nPrzekroczony próg dzienny: {limit}.',
  'Unusual usage: {name}': 'Nietypowe zużycie: {name}',
  '\n\nComparable usage (current configuration): {current}.\nAverage by the same time: {average} ({days} comparable days).\n':
    '\n\nZużycie w porównaniu (bieżąca konfiguracja): {current}.\nŚrednia do tej samej pory: {average} ({days} porównywalnych dni).\n',
  'Conditions: an increase of at least {percent}% and {increase}.':
    'Warunki: wzrost o co najmniej {percent}% i {increase}.',
  '{name} ({account}): {energy}; coverage {coverage}. {sources}\n':
    '{name} ({account}): {energy}; pokrycie {coverage}. {sources}\n',
  '  Previous week: {energy}; coverage {coverage}. {sources}':
    '  Poprzedni tydzień: {energy}; pokrycie {coverage}. {sources}',
  'readings working': 'odczyt działa',
  'readings stale': 'odczyty nieaktualne',
  'Summary for {start} – {end} ({timezone}).\n\n':
    'Podsumowanie okresu {start} – {end} ({timezone}).\n\n',
  'No homes.': 'Brak mieszkań.',
  '{homes}\n\nMonitoring status:\n{accounts}\n': '{homes}\n\nStan monitorowania:\n{accounts}\n',
  'Without measurements or estimation configuration: {count}{names}.\n':
    'Bez pomiaru lub konfiguracji estymacji: {count}{names}.\n',
  'Estimation without a current heating signal: {count}{names}.\n':
    'Estymacja bez aktualnego sygnału grzania: {count}{names}.\n',
  'Offline or stale: {count}{names}.\n\n': 'Offline lub nieaktualne: {count}{names}.\n\n',
  '≈ marks totals containing consumption calculated from sampled power or heating power × observed heating time. Incomplete totals include only available data. We send summaries even when there were no alerts.':
    '≈ oznacza sumę zawierającą zużycie obliczone z próbek mocy lub z mocy ogrzewania × zaobserwowany czas grzania. Niepełne sumy obejmują wyłącznie dostępne dane. Podsumowanie wysyłamy również wtedy, gdy nie było alertów.',
  'Energy: weekly summary {start}': 'Energia: podsumowanie tygodnia {start}',
};

export const notificationText = (language: Language, message: string, params?: MessageParams) =>
  translate(language, message, messages, params);
