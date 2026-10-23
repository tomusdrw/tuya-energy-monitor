import type { Messages } from '../../shared/i18n';

export const messages: Messages = {
  'Tuya.ai meter': 'Licznik Tuya.ai',
  'kWh meter · QR': 'Licznik kWh · QR',
  'Measurement source: {source} · last reading: {date}':
    'Źródło pomiaru: {source} · ostatni odczyt: {date}',
  'The first reading is a baseline. Usage is calculated from subsequent valid readings; earlier Smart Life history is not imported.':
    'Pierwszy odczyt jest punktem odniesienia. Zużycie obliczamy z kolejnych poprawnych odczytów; nie importujemy wcześniejszej historii Smart Life.',
  'From measured power': 'Z pomiaru mocy',
  'Current power': 'Bieżąca moc',
  'Notification rules': 'Reguły powiadomień',
  'Settings for this apartment only': 'Ustawienia tylko dla tego mieszkania',
  'Daily energy threshold': 'Dzienny próg energii',
  'No threshold': 'Brak progu',
  'An email is sent when the threshold is exceeded, at most once a day. Leave blank to disable this alert.':
    'E-mail po przekroczeniu progu, najwyżej raz dziennie. Puste pole wyłącza ten alert.',
  'Detect unusual usage': 'Wykrywaj nietypowe zużycie',
  'Compares usage at the same time on previous days. Requires at least 7 days with sufficient data.':
    'Porównanie z tą samą porą wcześniejszych dni. Wymaga przynajmniej 7 dni z wystarczającymi danymi.',
  'Anomaly detection conditions': 'Warunki wykrywania anomalii',
  'Comparison window (days)': 'Okno porównania (dni)',
  'Increase over average (%)': 'Wzrost względem średniej (%)',
  'Minimum increase (kWh)': 'Minimalny przyrost (kWh)',
  'Settings saved.': 'Ustawienia zapisane.',
  'Both increase conditions must be met.': 'Oba warunki wzrostu muszą być spełnione.',
  'Saving…': 'Zapisywanie…',
  'Save rules': 'Zapisz reguły',
  Apartments: 'Mieszkania',
  '{account} · Devices: {count}': '{account} · Urządzenia: {count}',
  'Current readings': 'Aktualne pomiary',
  'Incomplete readings': 'Niepełne pomiary',
  'Observed today': 'Zaobserwowane dzisiaj',
  'Daily threshold': 'Dzienny próg',
  'Set a threshold below': 'Ustaw próg poniżej',
  'Individual apartment limit': 'Indywidualny limit mieszkania',
  'Reading coverage': 'Pokrycie pomiarami',
  'Since midnight, for selected devices': 'Od północy, dla wybranych urządzeń',
  'This total is partial. It includes meter readings, consumption calculated from power and enabled estimates. Reading gaps and devices without an energy source remain missing data.':
    'Suma jest częściowa. Obejmuje pomiary liczników, zużycie obliczone z mocy i włączone estymacje. Przerwy w odczytach oraz urządzenia bez źródła energii pozostają brakami danych.',
  'Apartment history': 'Historia mieszkania',
  Devices: 'Urządzenia',
  'Choose which devices count toward the apartment total and alerts. Open a device to see its history.':
    'Wybierz urządzenia uwzględniane w sumie mieszkania i alertach. Kliknij urządzenie, aby zobaczyć jego historię.',
  Included: 'Wliczane',
  Excluded: 'Pomijane',
  Ignored: 'Ignorowane',
  Ignore: 'Ignoruj',
  Restore: 'Przywróć',
  'Ignore {name}': 'Ignoruj {name}',
  'Restore {name} to the device list': 'Przywróć {name} na listę urządzeń',
  'Ignored devices ({count})': 'Ignorowane urządzenia ({count})',
  'All devices are ignored': 'Wszystkie urządzenia są ignorowane',
  'Expand the ignored devices below to restore one to the list.':
    'Rozwiń poniższą listę ignorowanych urządzeń, aby przywrócić wybrane urządzenie.',
  'Ignored devices are excluded from totals and alerts. Restoring a device keeps monitoring off until you enable it.':
    'Ignorowane urządzenia nie są wliczane do sum i alertów. Po przywróceniu monitorowanie pozostaje wyłączone, dopóki go nie włączysz.',
  'This device is ignored. Enabling monitoring also restores it to the device list.':
    'To urządzenie jest ignorowane. Włączenie monitorowania przywróci je także na listę urządzeń.',
  'Include {name} in apartment total and alert rules':
    'Uwzględniaj {name} w sumie mieszkania i regułach alertów',
  'Select a device to view its history and contribution to the total.':
    'Wybierz urządzenie, aby sprawdzić historię i udział w sumie.',
  Device: 'Urządzenie',
  'Energy measurement': 'Pomiar energii',
  Today: 'Dzisiaj',
  'Last reading': 'Ostatni odczyt',
  'Excluded from apartment total': 'Poza sumą mieszkania',
  Online: 'Online',
  'Offline or stale readings': 'Offline lub nieaktualne odczyty',
  'Inactive · offline or stale readings': 'Nieaktywne · offline lub nieaktualne odczyty',
  'Estimate: no signal': 'Estymacja: brak sygnału',
  'Estimated kWh': 'Estymacja kWh',
  'kWh meter': 'Licznik kWh',
  'No energy data': 'Brak energii',
  'No devices': 'Brak urządzeń',
  'Check the account connection and refresh the data.': 'Sprawdź połączenie konta i odśwież dane.',
  '{home} · last cloud reading: {date}': '{home} · ostatni odczyt chmury: {date}',
  '{coverage} time coverage': '{coverage} pokrycia czasu',
  'Meter reading': 'Stan licznika',
  "The device's cumulative meter, not daily usage": 'Łączny licznik urządzenia, nie zużycie dobowe',
  'Current temperature': 'Temperatura bieżąca',
  'No temperature reading': 'Brak odczytu temperatury',
  'Reading provided by the device': 'Odczyt udostępniony przez urządzenie',
  'Device history': 'Historia urządzenia',
  'Monitoring participation': 'Udział w monitorowaniu',
  'Include devices that heat the apartment.':
    'Włącz urządzenia, które odpowiadają za ogrzewanie mieszkania.',
  'Include in apartment total and alert rules': 'Uwzględniaj w sumie mieszkania i regułach alertów',
  'A device without readings is marked as a missing part of the total. Changing the selection also recalculates history for the current set of devices.':
    'Urządzenie bez pomiaru będzie oznaczone jako brakująca część sumy. Zmiana wyboru przelicza również historię dla bieżącego zestawu urządzeń.',
  'Account connected. Apartments and devices will appear after synchronization.':
    'Konto połączone. Pobieramy domy i urządzenia — pojawią się po synchronizacji.',
  'Connected accounts': 'Połączone konta',
  'All your Tuya and Smart Life accounts in one dashboard.':
    'Wszystkie konta Tuya i Smart Life w jednym panelu.',
  'Add account': 'Dodaj konto',
  'Reconnect account': 'Połącz konto ponownie',
  'Add a Tuya / Smart Life account': 'Dodaj konto Tuya / Smart Life',
  Close: 'Zamknij',
  'Account name': 'Nazwa konta',
  'e.g. Apartments': 'np. Mieszkania',
  'User code': 'Kod użytkownika',
  'Find the code in the app: Me → Settings → Account and Security → User Code.':
    'Kod znajdziesz w aplikacji: Ja → Ustawienia → Konto i bezpieczeństwo → Kod użytkownika.',
  'Generating…': 'Generowanie…',
  'Show QR code': 'Wyświetl kod QR',
  'QR code for connecting a Tuya account': 'Kod QR połączenia konta Tuya',
  'Approve the connection on your phone': 'Zatwierdź połączenie w telefonie',
  'Open Tuya or Smart Life with the correct account.':
    'Otwórz Tuya lub Smart Life na właściwym koncie.',
  'Choose + → Scan and scan the code.': 'Wybierz + → Skanuj i zeskanuj kod.',
  'Approve the connection, then check it below.':
    'Zatwierdź połączenie, a następnie sprawdź je poniżej.',
  'The consent screen may show Home Assistant because we use the same sign-in mechanism. The QR code expires after 5 minutes.':
    'Ekran zgody może pokazać nazwę Home Assistant — korzystamy z tego samego mechanizmu logowania. QR wygasa po 5 minutach.',
  'Checking…': 'Sprawdzanie…',
  "I've approved it — check": 'Zatwierdziłem — sprawdź',
  'New QR code': 'Nowy QR',
  'Needs attention': 'Wymaga uwagi',
  Connected: 'Połączone',
  'Stale readings': 'Nieaktualne odczyty',
  'First reading pending': 'Pierwszy odczyt',
  'Apartments: {homes} · Devices: {devices}': 'Mieszkania: {homes} · Urządzenia: {devices}',
  Reconnect: 'Połącz ponownie',
  'No accounts connected yet': 'Jeszcze nie połączono kont',
  'Add an account using its user code and a QR code. You do not need your Tuya account password.':
    'Dodaj konto, używając kodu użytkownika i QR. Nie potrzebujesz hasła do konta Tuya.',
  'Connection credentials are encrypted and stay on your server. The application only reads device data.':
    'Dane połączenia są szyfrowane i pozostają na Twoim serwerze. Aplikacja wyłącznie odczytuje urządzenia.',
  Notifications: 'Powiadomienia',
  'Threshold alerts, unusual usage, and weekly summaries.':
    'Przekroczenia progów, nietypowe zużycie i cotygodniowe podsumowania.',
  'Email delivery is not configured. Events will be recorded here.':
    'Wysyłka e-maili nie jest skonfigurowana. Zdarzenia będą zapisywane tutaj.',
  'View email settings.': 'Zobacz ustawienia wysyłki.',
  Settings: 'Ustawienia',
  'Your instance configuration and how monitoring works.':
    'Konfiguracja Twojej instancji i sposób działania monitorowania.',
  'Email notifications': 'Powiadomienia e-mail',
  'Delivered by Resend': 'Dostarczane przez Resend',
  'Email delivery configured': 'Wysyłka skonfigurowana',
  'Configuration required': 'Wymaga konfiguracji',
  Sender: 'Nadawca',
  Recipient: 'Odbiorca',
  'Not set': 'Nie ustawiono',
  'Weekly summary': 'Podsumowanie tygodnia',
  'Monday, after 08:00': 'Poniedziałek, po 08:00',
  'Set RESEND_API_KEY, EMAIL_FROM (a verified domain), and EMAIL_TO on the server, then restart the application. The key is never sent to the browser.':
    'Ustaw na serwerze RESEND_API_KEY, EMAIL_FROM (zweryfikowana domena) i EMAIL_TO, a następnie uruchom aplikację ponownie. Klucz nie jest przesyłany do przeglądarki.',
  'Threshold and anomaly alerts: at most one notification of each type per apartment per day. The summary is sent even when there were no alerts.':
    'Próg i anomalia: najwyżej jedno powiadomienie każdego rodzaju na mieszkanie dziennie. Podsumowanie wysyłamy także wtedy, gdy nie wystąpiły alerty.',
  'Interface language': 'Język interfejsu',
  'Your language choice is saved in this browser. Emails are always sent in English.':
    'Wybrany język jest zapisywany w tej przeglądarce. E-maile są zawsze wysyłane po angielsku.',
  Monitoring: 'Monitorowanie',
  'Time zone': 'Strefa czasowa',
  'Meters and device list': 'Liczniki i lista urządzeń',
  'Every {minutes} minutes': 'Co {minutes} minut',
  'Heating states': 'Stany grzania',
  'Every {seconds} seconds': 'Co {seconds} sekund',
  'Application URL': 'Adres aplikacji',
  Access: 'Dostęp',
  'One owner · password · no registration': 'Jeden właściciel · hasło · brak rejestracji',
  'How to read the results': 'Jak czytać wyniki',
  'Usage is calculated from meter increases. The first reading establishes a starting point. Short intervals across day boundaries are split proportionally, so daily values are approximate.':
    'Zużycie liczymy z przyrostów licznika. Pierwszy odczyt wyznacza punkt początkowy. Krótkie przedziały na granicy dni dzielimy proporcjonalnie, więc dobowe wartości są przybliżeniem.',
  'A missing energy source, offline device, or meter reset leaves a gap. The gap limit is 15 minutes for meters and 3 minutes for power readings and runtime estimates. Coverage shows how much of the time and selected devices have readings. A dash (—) means no data.':
    'Brak źródła energii, urządzenie offline i reset licznika pozostawiają lukę. Granica przerwy to 15 minut dla liczników i 3 minuty dla pomiarów mocy oraz estymacji z czasu grzania. Pokrycie mówi, dla jakiej części czasu i wybranych urządzeń mamy pomiar. Wartość „—” oznacza brak danych.',
  'A daily alert may concern a partial total; the message will say so. An anomaly requires at least 7 comparable days with at least 95% coverage for each compared device. Changing power or state mapping requires new comparison history.':
    'Alert dzienny może dotyczyć częściowej sumy — wiadomość to zaznaczy. Anomalia wymaga przynajmniej 7 porównywalnych dni z co najmniej 95% pokrycia dla każdego porównywanego urządzenia. Zmiana mocy lub mapowania stanu wymaga nowej historii do porównań.',
  'Set thresholds and device selection separately for each apartment. History from the Tuya mobile app is not imported.':
    'Progi i wybór urządzeń ustawisz osobno w każdym mieszkaniu. Historia z aplikacji mobilnej Tuya nie jest importowana.',
  'Incremental reports': 'Raporty przyrostowe',
  'Reports: disconnected': 'Raporty: brak połączenia',
  'Report reception': 'Odbiór raportów',
  Disconnected: 'Brak połączenia',
  'Last report: {date}': 'Ostatni raport: {date}',
  'Waiting for the first energy report.': 'Czekamy na pierwszy raport energii.',
  'Live while the Tuya connection is active': 'Na żywo, gdy działa połączenie Tuya',
  'We add up energy reports received live. Repeated copies of the same report do not increase usage. Interruptions can leave gaps; earlier reports are not recovered. Point reports do not establish time coverage, so the total remains partial.':
    'Sumujemy raporty energii odebrane na żywo. Powtórzenia tego samego raportu nie zwiększają zużycia. Przerwy w odbiorze mogą powodować braki; nie odtwarzamy wcześniejszych raportów. Raporty punktowe nie potwierdzają pokrycia czasu, dlatego suma pozostaje częściowa.',
  'The current Tuya connection does not provide an energy meter for this device. You can configure estimation below if an active heating signal is available.':
    'Obecne połączenie Tuya nie udostępnia licznika energii tego urządzenia. Możesz skonfigurować estymację poniżej, jeśli dostępny jest sygnał aktywnego grzania.',
  'Incremental reports are counted once using the device report time. Interruptions in reception leave gaps. Point reports do not establish time coverage; the total remains partial even with an active connection.':
    'Raporty przyrostowe sumujemy jednokrotnie według czasu raportu urządzenia. Przerwy w odbiorze pozostawiają braki. Raporty punktowe nie potwierdzają pokrycia czasu; suma pozostaje częściowa również przy aktywnym połączeniu.',
  '≈ marks consumption calculated from sampled power or configured heating power × observed heating time. Native power needs no configuration. Totals show each source separately; they are not intended for billing.':
    '≈ oznacza zużycie obliczone z próbek mocy lub z zadanej mocy ogrzewania × zaobserwowany czas grzania. Natywny pomiar mocy nie wymaga konfiguracji. Suma pokazuje każde źródło osobno; nie służy rozliczeniom.',
};
