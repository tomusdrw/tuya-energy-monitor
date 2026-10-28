import type { Messages } from '../../shared/i18n';

export const messages: Messages = {
  'Excluded from average': 'Poza średnią',
  'Temperature uses selected sensors; humidity uses all available sensors. Each sensor has equal weight, independently of energy selection. Offline devices and readings older than 15 minutes are omitted.':
    'Temperatura uwzględnia wybrane czujniki, a wilgotność wszystkie dostępne. Każdy czujnik ma równą wagę, niezależnie od wyboru do zużycia energii. Pomijamy urządzenia offline i odczyty starsze niż 15 minut.',
  'Temperature history uses the current sensor selection. Daily sensor averages have equal weight. Lines show observed minimum–maximum; dots show the home average. Missing days remain gaps.':
    'Historia temperatury uwzględnia aktualny wybór czujników. Dzienne średnie czujników mają równą wagę. Linie pokazują zaobserwowane minimum–maksimum, a punkty średnią dla domu. Dni bez danych pozostają lukami.',
  'Home climate': 'Warunki w domu',
  Temperature: 'Temperatura',
  Humidity: 'Wilgotność',
  'Average temperature': 'Średnia temperatura',
  'Average humidity': 'Średnia wilgotność',
  'Current temperature': 'Aktualna temperatura',
  'Current humidity': 'Aktualna wilgotność',
  'No current readings': 'Brak aktualnych odczytów',
  'No readings': 'Brak odczytów',
  'Sensors: {count}': 'Czujniki: {count}',
  'Samples: {count}': 'Pomiary: {count}',
  'Min {min} · Max {max}': 'Min. {min} · Maks. {max}',
  'Oldest cloud read: {date}': 'Najstarszy odczyt z chmury: {date}',
  'Climate read: {date}': 'Odczyt warunków: {date}',
  'Equal-weight averages from all available sensors, including devices excluded or ignored for energy. Offline devices and readings older than 15 minutes are omitted.':
    'Średnie z równą wagą wszystkich dostępnych czujników, także urządzeń wyłączonych lub ignorowanych w pomiarze energii. Pomijamy urządzenia offline i odczyty starsze niż 15 minut.',
  'Daily temperature (°C)': 'Dzienna temperatura (°C)',
  'Daily humidity (%)': 'Dzienna wilgotność (%)',
  'Daily sensor averages have equal weight. Lines show observed minimum–maximum; dots show the home average. Missing days remain gaps.':
    'Dzienne średnie czujników mają równą wagę. Linie pokazują zaobserwowane minimum–maksimum, a punkty średnią dla domu. Dni bez danych pozostają lukami.',
  'History starts with the first collected readings. Cloud read time is not the sensor measurement time. Sparse readings do not represent a complete day.':
    'Historia zaczyna się od pierwszych zebranych odczytów. Czas odczytu z chmury nie jest czasem pomiaru czujnika. Nieliczne pomiary nie reprezentują pełnego dnia.',
  'View daily climate readings': 'Zobacz dzienne odczyty warunków',
  'Average: {value}': 'Średnia: {value}',
};
