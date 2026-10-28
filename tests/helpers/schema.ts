import type { DatabaseSync } from 'node:sqlite';

// Migration tests reconstruct released schemas before reopening through openDatabase.
export function removePushSchema(db: DatabaseSync): void {
  db.exec('DROP INDEX IF EXISTS climate_temperature_devices');
  if (
    db
      .prepare('PRAGMA table_info(devices)')
      .all()
      .some((c) => c.name === 'temperature_included')
  )
    db.exec('ALTER TABLE devices DROP COLUMN temperature_included');
  db.exec(`ALTER TABLE sessions DROP COLUMN receiver_id;
    DROP TABLE push_deliveries; DROP TABLE push_retired_endpoints; DROP TABLE push_receivers;
    DROP TABLE notification_conditions; DROP TABLE availability_state;
    ALTER TABLE accounts DROP COLUMN ai_connectivity_at;
    ALTER TABLE accounts DROP COLUMN ai_connectivity_ok;
    ALTER TABLE accounts DROP COLUMN ai_connectivity_active;`);
}
