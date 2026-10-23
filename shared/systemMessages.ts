import { translate, type Language } from './i18n.js';

// Canonical English messages and their exact legacy Polish equivalents.
export const systemMessages: Record<string, string> = {
  'Check the Tuya.ai key and its region.': 'Sprawdź klucz Tuya.ai i jego region.',
  'Tuya.ai access was rejected. Check the key permissions.':
    'Odrzucono dostęp Tuya.ai. Sprawdź uprawnienia klucza.',
  'Tuya.ai rate limit reached. The next scheduled reading will retry.':
    'Osiągnięto limit zapytań Tuya.ai. Ponowimy próbę przy kolejnym zaplanowanym odczycie.',
  'Tuya.ai returned an invalid device response.':
    'Tuya.ai zwróciło nieprawidłową odpowiedź urządzenia.',
  'Could not read Tuya.ai. The next scheduled reading will retry.':
    'Nie udało się odczytać Tuya.ai. Ponowimy próbę przy kolejnym zaplanowanym odczycie.',
  'Tuya.ai did not provide a valid energy counter.':
    'Tuya.ai nie udostępniło poprawnego licznika energii.',
  'Tuya.ai configuration changed. Try again.':
    'Konfiguracja Tuya.ai została zmieniona. Spróbuj ponownie.',
  'The key does not grant access to any known devices on this account. Synchronize QR and check the selected account.':
    'Klucz nie daje dostępu do żadnego znanego urządzenia tego konta. Zsynchronizuj QR i sprawdź wybrane konto.',
  'Requests must come from the application address (APP_ORIGIN).':
    'Żądanie musi pochodzić z adresu aplikacji (APP_ORIGIN).',
  'Sign in to continue.': 'Zaloguj się, aby kontynuować.',
  'Check the form values.': 'Sprawdź wartości w formularzu.',
  'Too many attempts. Try again in a minute.': 'Zbyt wiele prób. Spróbuj ponownie za minutę.',
  'Invalid request.': 'Nieprawidłowe żądanie.',
  'The operation failed. Try again.': 'Operacja nie powiodła się. Spróbuj ponownie.',
  'Incorrect password.': 'Nieprawidłowe hasło.',
  'Home not found.': 'Nie znaleziono mieszkania.',
  'Device not found.': 'Nie znaleziono urządzenia.',
  'Could not refresh device fields. Try again after synchronization.':
    'Nie udało się odświeżyć pól urządzenia. Spróbuj ponownie po synchronizacji.',
  'Complete the connection in progress or wait 5 minutes.':
    'Dokończ rozpoczęte połączenie lub poczekaj 5 minut.',
  'Account not found.': 'Nie znaleziono konta.',
  'Could not generate the QR code. Check the user code and try again.':
    'Nie udało się wygenerować QR. Sprawdź kod użytkownika i spróbuj ponownie.',
  'The QR code expired. Generate a new one.': 'Kod QR wygasł. Wygeneruj nowy.',
  'Connection confirmation is in progress.': 'Trwa potwierdzanie połączenia.',
  'Scan the QR code and approve the connection in the app. If the code expired, generate a new one.':
    'Zeskanuj QR i zatwierdź połączenie w aplikacji. Jeśli kod wygasł, wygeneruj nowy.',
  'This is a different Tuya account. Sign in to the correct account or add it as a new account.':
    'To inne konto Tuya. Zaloguj właściwe konto lub dodaj je jako nowe.',
  'Could not confirm the connection. Try again.':
    'Nie udało się potwierdzić połączenia. Spróbuj ponownie.',
  'Page not found.': 'Nie znaleziono strony.',
  'Could not read the account. Sync again; if the problem persists, reconnect the account.':
    'Nie udało się odczytać konta. Ponów synchronizację; jeśli problem trwa, połącz konto ponownie.',
  'Enter the power, field, and heating and idle values.':
    'Podaj moc, pole oraz wartości grzania i postoju.',
  'Heating and idle values must not overlap.': 'Wartości grzania i postoju muszą być rozłączne.',
  'The safe retry window expired. Check delivery in Resend.':
    'Okno bezpiecznego ponawiania wygasło. Sprawdź dostarczenie w Resend.',
  'The message is older than 24 hours. Outdated delivery was skipped.':
    'Wiadomość jest starsza niż 24 godziny. Pominięto nieaktualną wysyłkę.',
  'Resend rejected the message (HTTP {status}). Check the sender and API key configuration.':
    'Resend odrzucił wiadomość (HTTP {status}). Sprawdź konfigurację nadawcy i klucza.',
  'Delivery was not confirmed. We will retry with the same identifier.':
    'Nie potwierdzono wysyłki. Ponowimy ją z tym samym identyfikatorem.',
  'Could not connect to the application.': 'Nie udało się połączyć z aplikacją.',
};

const canonicalMessages = new Map(
  Object.entries(systemMessages).map(([english, polish]) => [polish, english]),
);

export function localizeSystemMessage(message: string, language: Language): string {
  const canonical = canonicalMessages.get(message) ?? message;
  if (Object.hasOwn(systemMessages, canonical))
    return translate(language, canonical, systemMessages);
  const rejection =
    /^(?:Resend rejected the message \(HTTP (\d{3})\)\. Check the sender and API key configuration\.|Resend odrzucił wiadomość \(HTTP (\d{3})\)\. Sprawdź konfigurację nadawcy i klucza\.)$/.exec(
      message,
    );
  if (rejection)
    return translate(
      language,
      'Resend rejected the message (HTTP {status}). Check the sender and API key configuration.',
      systemMessages,
      { status: rejection[1] ?? rejection[2] },
    );
  return message;
}
