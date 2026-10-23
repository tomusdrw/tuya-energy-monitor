import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './db.js';
import { enqueuePush } from './pushDelivery.js';
import type { PushKind } from '../shared/push.js';
import type { Language } from '../shared/i18n.js';
import type { NotificationContent } from '../shared/types.js';

export function emailEnabled(db: DatabaseSync): boolean {
  return (
    db.prepare("SELECT value FROM metadata WHERE key='email_enabled'").get()?.value !== 'false'
  );
}
export function setEmailEnabled(db: DatabaseSync, enabled: boolean): void {
  transaction(db, () => {
    db.prepare(
      "INSERT INTO metadata(key,value) VALUES('email_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(String(enabled));
    if (!enabled)
      db.exec(
        "UPDATE notifications SET status='skipped',error=NULL WHERE status IN ('pending','retry')",
      );
  });
}
export interface NotificationEvent {
  id: string;
  homeId: string | null;
  kind: PushKind;
  now: number;
  content: (language: Language) => NotificationContent;
  members?: { subject: string; episode: string; direction: 'lost' | 'restored' }[];
}
export function enqueueNotification(db: DatabaseSync, event: NotificationEvent): void {
  transaction(db, () => {
    if (db.prepare('SELECT id FROM notifications WHERE id=?').get(event.id)) return;
    const english = event.content('en');
    const status =
      emailEnabled(db) && ['threshold', 'anomaly', 'weekly'].includes(event.kind)
        ? 'pending'
        : 'skipped';
    db.prepare(
      'INSERT INTO notifications(id,home_id,kind,title,body,created_at,status) VALUES(?,?,?,?,?,?,?)',
    ).run(event.id, event.homeId, event.kind, english.title, english.body, event.now, status);
    db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run(
      `notification-pl/${event.id}`,
      JSON.stringify(event.content('pl')),
    );
    for (const member of event.members ?? [])
      db.prepare(
        'INSERT INTO notification_conditions(event_id,subject,episode,direction) VALUES(?,?,?,?)',
      ).run(event.id, member.subject, member.episode, member.direction);
    enqueuePush(db, event);
  });
}
