import type { Language } from './i18n.js';
import type { NotificationContent, NotificationView } from './types.js';

// Historical notifications without a translation retain their original wording.
export function localizeNotification(
  notification: Pick<NotificationView, 'title' | 'body' | 'translations'>,
  language: Language,
): NotificationContent {
  return language === 'pl' && notification.translations?.pl
    ? notification.translations.pl
    : { title: notification.title, body: notification.body };
}
