import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;
  if (version > 4) {
    db.close();
    throw new Error('Unsupported database version');
  }
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, identity TEXT UNIQUE,
      secret TEXT NOT NULL, last_sync INTEGER, error TEXT
    );
    CREATE TABLE IF NOT EXISTS homes (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      remote_id TEXT NOT NULL, name TEXT NOT NULL, present INTEGER NOT NULL DEFAULT 1,
      daily_limit REAL, anomaly_enabled INTEGER NOT NULL DEFAULT 1,
      window_days INTEGER NOT NULL DEFAULT 14, increase_percent REAL NOT NULL DEFAULT 50,
      increase_kwh REAL NOT NULL DEFAULT 3,
      UNIQUE(account_id, remote_id)
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, home_id TEXT NOT NULL REFERENCES homes(id),
      remote_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
      included INTEGER NOT NULL, online INTEGER NOT NULL, present INTEGER NOT NULL DEFAULT 1,
      last_seen INTEGER, energy_kind TEXT NOT NULL, energy_code TEXT,
      counter_kwh REAL, temperature REAL, power_w REAL
    );
    CREATE TABLE IF NOT EXISTS readings (
      device_id TEXT NOT NULL REFERENCES devices(id), at INTEGER NOT NULL,
      counter_kwh REAL, code TEXT, online INTEGER NOT NULL,
      PRIMARY KEY(device_id, at)
    );
    CREATE TABLE IF NOT EXISTS intervals (
      device_id TEXT NOT NULL REFERENCES devices(id), start INTEGER NOT NULL,
      end INTEGER NOT NULL, kwh REAL NOT NULL CHECK(kwh>=0),
      PRIMARY KEY(device_id, end), CHECK(end>start)
    );
    CREATE INDEX IF NOT EXISTS intervals_range ON intervals(device_id,end,start);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, home_id TEXT REFERENCES homes(id), kind TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', sent_at INTEGER, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, first_attempt INTEGER, next_attempt INTEGER,
      payload TEXT
    );
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (version < 2)
    transaction(db, () => {
      db.exec(`
      ALTER TABLE devices ADD COLUMN estimate_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE devices ADD COLUMN rated_power_kw REAL;
      ALTER TABLE devices ADD COLUMN heating_code TEXT;
      ALTER TABLE devices ADD COLUMN heating_on_values TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE devices ADD COLUMN heating_off_values TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE devices ADD COLUMN estimate_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE devices ADD COLUMN status_fields TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE devices ADD COLUMN status_updated_at INTEGER;
      ALTER TABLE intervals ADD COLUMN source TEXT NOT NULL DEFAULT 'measured';
      ALTER TABLE intervals ADD COLUMN on_ms INTEGER;
      ALTER TABLE intervals ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE heating_observations (
        device_id TEXT NOT NULL REFERENCES devices(id), at INTEGER NOT NULL,
        heating INTEGER, raw_value TEXT, code TEXT, online INTEGER NOT NULL,
        source TEXT NOT NULL, config_revision INTEGER NOT NULL, rated_power_kw REAL,
        PRIMARY KEY(device_id, at)
      );
      PRAGMA user_version=2;
    `);
    });
  if (version < 3)
    transaction(db, () => {
      db.exec(`
        ALTER TABLE devices ADD COLUMN incremental_since INTEGER;
        ALTER TABLE devices ADD COLUMN energy_stream_at INTEGER;
        CREATE TABLE energy_reports (
          device_id TEXT NOT NULL REFERENCES devices(id), code TEXT NOT NULL, report_id TEXT NOT NULL,
          at INTEGER NOT NULL, kwh REAL NOT NULL CHECK(kwh>=0), received_at INTEGER NOT NULL,
          PRIMARY KEY(device_id,code,report_id)
        );
        CREATE INDEX energy_reports_range ON energy_reports(device_id,at);
        PRAGMA user_version=3;
      `);
    });
  if (version < 4)
    transaction(db, () => {
      db.exec(`
        ALTER TABLE devices ADD COLUMN power_field TEXT;
        ALTER TABLE devices ADD COLUMN power_updated_at INTEGER;
        CREATE TABLE power_observations (
          device_id TEXT NOT NULL REFERENCES devices(id), at INTEGER NOT NULL,
          power_w REAL CHECK(power_w>=0), field TEXT, source TEXT NOT NULL,
          PRIMARY KEY(device_id,at)
        );
        PRAGMA user_version=4;
      `);
    });
  return db;
}

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
