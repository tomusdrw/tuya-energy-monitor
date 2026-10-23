import type { Messages } from '../../shared/i18n';

export const messages: Messages = {
  'Energy from measured power': 'Energia z pomiaru mocy',
  'Energy is calculated automatically from the device’s measured power. No rated power or heating signal configuration is needed.':
    'Energia jest obliczana automatycznie z mocy mierzonej przez urządzenie. Nie trzeba podawać mocy znamionowej ani konfigurować sygnału grzania.',
  'We integrate power readings taken every 60 seconds. Missing or invalid readings and gaps over 3 minutes stop counting. ≈ marks consumption calculated from sampled power; it is not a kWh meter reading.':
    'Obliczamy energię z pomiarów mocy pobieranych co 60 sekund. Brakujące lub nieprawidłowe odczyty i przerwy ponad 3 minuty zatrzymują naliczanie. ≈ oznacza zużycie obliczone z próbek mocy; nie jest to odczyt licznika kWh.',
  'No current power reading. This period remains missing data.':
    'Brak aktualnego pomiaru mocy. Ten okres pozostaje luką w danych.',
  'Heating active': 'Grzanie aktywne',
  Idle: 'Postój',
  'Heating state unknown': 'Stan grzania nieznany',
  'Heating runtime estimation': 'Estymacja z czasu grzania',
  'For electric heating with a constant power rating': 'Dla ogrzewania elektrycznego o stałej mocy',
  'Estimation enabled': 'Estymacja włączona',
  'Estimation disabled': 'Estymacja wyłączona',
  'Heating time today': 'Czas grzania dzisiaj',
  'Total observed': 'Łącznie zaobserwowano',
  'Estimated usage': 'Szacowane zużycie',
  'power × heating time': 'moc × czas grzania',
  'The device provides energy readings. Measurements take precedence; estimation does not add usage for the same device.':
    'Urządzenie udostępnia pomiar energii. Pomiar ma pierwszeństwo; estymacja nie dodaje zużycia dla tego samego urządzenia.',
  'No current, recognized heating signal. This period remains missing data even when the thermostat is online.':
    'Brak aktualnego, rozpoznanego sygnału grzania. Ten okres pozostaje bez danych, nawet gdy termostat jest online.',
  'Turning the thermostat on (e.g. switch) does not confirm that the heater is running. Choose a field that indicates active heating and enter the power of the circuit controlled by the thermostat.':
    'Samo włączenie termostatu (np. switch) nie potwierdza pracy grzałki. Wybierz pole pokazujące faktycznie załączone ogrzewanie i podaj moc obwodu, którym steruje termostat.',
  'Enable estimation for this device': 'Włącz estymację dla tego urządzenia',
  'Heating power (kW)': 'Moc ogrzewania (kW)',
  'e.g. 1.2': 'np. 1,2',
  'Active heating field': 'Pole aktywnego grzania',
  'The default of {power} kW is an assumed power rating. You can change it to the total heating power controlled by this thermostat.':
    'Domyślnie {power} kW — moc założona. Możesz ją zmienić na łączną moc ogrzewania sterowanego przez ten termostat.',
  'Use detected field: {code}': 'Użyj wykrytego pola: {code}',
  'Heating activity': 'Stan grzania',
  'Heating relay': 'Przekaźnik grzania',
  'Thermostat power': 'Włączenie termostatu',
  'Fields detected from the device': 'Pola wykryte w urządzeniu',
  'Reading device fields…': 'Odczytywanie pól urządzenia…',
  'Fields refreshed. Your selections have been kept.': 'Pola odświeżone. Zachowano Twój wybór.',
  'Choose from available fields and states. No field names or JSON to type.':
    'Wybierz dostępne pole i jego stany. Bez wpisywania nazw pól ani JSON-a.',
  'Detecting…': 'Wykrywanie…',
  'Detect again': 'Wykryj ponownie',
  'No recognized heating signal was found.': 'Nie wykryto rozpoznanego sygnału grzania.',
  'If a field reports actual heating, select it and assign its states below. Otherwise this connection cannot provide a runtime estimate.':
    'Jeśli któreś pole pokazuje faktyczne grzanie, wybierz je i przypisz jego stany poniżej. W przeciwnym razie to połączenie nie pozwala szacować zużycia z czasu grzania.',
  'Select a detected field': 'Wybierz wykryte pole',
  'Selected field: {code}': 'Wybrane pole: {code}',
  Suggested: 'Sugerowane',
  'The selected field is absent from the latest reading. Its assignments are kept.':
    'Wybranego pola nie ma w ostatnim odczycie. Zachowano przypisania jego stanów.',
  'Latest state: {value}': 'Ostatni stan: {value}',
  'What does each state mean?': 'Co oznaczają poszczególne stany?',
  Current: 'Aktualny',
  'Meaning of {value}': 'Znaczenie stanu {value}',
  'Unknown / ignore': 'Nieznany / pomiń',
  'Assign at least one heating state and one idle state. Unassigned states remain unknown. If a state is missing, detect again after the device reports it.':
    'Przypisz co najmniej jeden stan grzania i jeden stan postoju. Nieprzypisane stany pozostają nieznane. Jeśli brakuje stanu, ponów wykrywanie, gdy urządzenie go zgłosi.',
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
