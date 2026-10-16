import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
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
    PRAGMA user_version=1;
  `);
  return db;
}

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
