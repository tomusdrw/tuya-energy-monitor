import type { Messages } from '../../shared/i18n';

export const messages: Messages = {
  'Heating active': 'Grzanie aktywne',
  Idle: 'Postój',
  'Heating state unknown': 'Stan grzania nieznany',
  'Enter a list of values, e.g. ["heating"] or [true].':
    'Wpisz listę wartości, np. ["heating"] albo [true].',
  'The list may contain text, numbers, or true / false.':
    'Lista może zawierać tekst, liczby lub true / false.',
  'Heating runtime estimation': 'Estymacja z czasu grzania',
  'For electric heating with a constant power rating': 'Dla ogrzewania elektrycznego o stałej mocy',
  'Estimation enabled': 'Estymacja włączona',
  'Estimation disabled': 'Estymacja wyłączona',
  'Heating time today': 'Czas grzania dzisiaj',
  'Total observed': 'Łącznie zaobserwowano',
  'Estimated usage': 'Szacowane zużycie',
  'power × heating time': 'moc × czas grzania',
  'The device has an energy meter. Its readings take precedence; estimation does not add usage for the same device.':
    'Urządzenie ma licznik energii. Jego pomiar ma pierwszeństwo; estymacja nie dodaje zużycia dla tego samego urządzenia.',
  'No current, recognized heating signal. This period remains missing data even when the thermostat is online.':
    'Brak aktualnego, rozpoznanego sygnału grzania. Ten okres pozostaje bez danych, nawet gdy termostat jest online.',
  'Turning the thermostat on (e.g. switch) does not confirm that the heater is running. Choose a field that indicates active heating and enter the power of the circuit controlled by the thermostat.':
    'Samo włączenie termostatu (np. switch) nie potwierdza pracy grzałki. Wybierz pole pokazujące faktycznie załączone ogrzewanie i podaj moc obwodu, którym steruje termostat.',
  'Enable estimation for this device': 'Włącz estymację dla tego urządzenia',
  'Heating power (kW)': 'Moc ogrzewania (kW)',
  'e.g. 1.2': 'np. 1,2',
  'Active heating field': 'Pole aktywnego grzania',
  'e.g. work_state': 'np. work_state',
  'The default of {power} kW is an assumed power rating. You can change it to the total heating power controlled by this thermostat.':
    'Domyślnie {power} kW — moc założona. Możesz ją zmienić na łączną moc ogrzewania sterowanego przez ten termostat.',
  'Use detected field: {code}': 'Użyj wykrytego pola: {code}',
  'Values while heating': 'Wartości podczas grzania',
  'Values while idle': 'Wartości podczas postoju',
  'Value lists: ["heating"] and ["standby", "idle"], or [true] and [false]. Put text in quotes. All other values mean missing data.':
    'Listy wartości: ["heating"] i ["standby", "idle"] albo [true] i [false]. Tekst zapisz w cudzysłowie. Pozostałe wartości oznaczają brak danych.',
  'Estimation configuration saved.': 'Konfiguracja estymacji zapisana.',
  'Changes apply to future readings. History remains unchanged.':
    'Zmiany dotyczą przyszłych odczytów. Historia pozostaje bez zmian.',
  'Saving…': 'Zapisywanie…',
  'Save estimation': 'Zapisz estymację',
  'Available fields and latest states': 'Dostępne pola i ostatnie stany',
  'Last field reading: {date}. This data comes from the cloud and does not confirm a new transmission from the device.':
    'Ostatni odczyt pól: {date}. To dane udostępnione przez chmurę, nie potwierdzenie nowej transmisji z urządzenia.',
  Field: 'Pole',
  Value: 'Wartość',
  'Known values': 'Znane wartości',
  'No fields available in the latest reading.': 'Brak dostępnych pól w ostatnim odczycie.',
  'Recent heating observations': 'Ostatnie obserwacje grzania',
  Time: 'Czas',
  State: 'Stan',
  'Field / value': 'Pole / wartość',
  'Power / version': 'Moc / wersja',
  'Observations will be recorded after estimation is enabled.':
    'Obserwacje zaczną się zapisywać po włączeniu estymacji.',
  'Readings are taken every 60 seconds. A gap over 3 minutes or an unknown state stops counting. Short cycles may be missed; estimates are for detecting excessive usage, not billing.':
    'Odczyt co 60 s. Przerwa powyżej 3 min lub nieznany stan przerywają liczenie. Krótkie cykle mogą zostać pominięte; szacunek służy wykrywaniu nadmiernego zużycia, nie rozliczeniom.',
};
