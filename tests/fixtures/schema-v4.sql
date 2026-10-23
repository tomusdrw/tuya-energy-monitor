-- Native power schema from main commit 8a4cb33, before the Tuya.ai migration.
CREATE TABLE accounts (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, identity TEXT UNIQUE,
      secret TEXT NOT NULL, last_sync INTEGER, error TEXT
    );
CREATE TABLE homes (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      remote_id TEXT NOT NULL, name TEXT NOT NULL, present INTEGER NOT NULL DEFAULT 1,
      daily_limit REAL, anomaly_enabled INTEGER NOT NULL DEFAULT 1,
      window_days INTEGER NOT NULL DEFAULT 14, increase_percent REAL NOT NULL DEFAULT 50,
      increase_kwh REAL NOT NULL DEFAULT 3,
      UNIQUE(account_id, remote_id)
    );
CREATE TABLE devices (
      id TEXT PRIMARY KEY, home_id TEXT NOT NULL REFERENCES homes(id),
      remote_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
      included INTEGER NOT NULL, online INTEGER NOT NULL, present INTEGER NOT NULL DEFAULT 1,
      last_seen INTEGER, energy_kind TEXT NOT NULL, energy_code TEXT,
      counter_kwh REAL, temperature REAL, power_w REAL
    , estimate_enabled INTEGER NOT NULL DEFAULT 0, rated_power_kw REAL, heating_code TEXT, heating_on_values TEXT NOT NULL DEFAULT '[]', heating_off_values TEXT NOT NULL DEFAULT '[]', estimate_revision INTEGER NOT NULL DEFAULT 0, status_fields TEXT NOT NULL DEFAULT '[]', status_updated_at INTEGER, incremental_since INTEGER, energy_stream_at INTEGER, power_field TEXT, power_updated_at INTEGER);
CREATE TABLE readings (
      device_id TEXT NOT NULL REFERENCES devices(id), at INTEGER NOT NULL,
      counter_kwh REAL, code TEXT, online INTEGER NOT NULL,
      PRIMARY KEY(device_id, at)
    );
CREATE TABLE intervals (
      device_id TEXT NOT NULL REFERENCES devices(id), start INTEGER NOT NULL,
      end INTEGER NOT NULL, kwh REAL NOT NULL CHECK(kwh>=0), source TEXT NOT NULL DEFAULT 'measured', on_ms INTEGER, config_revision INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(device_id, end), CHECK(end>start)
    );
CREATE INDEX intervals_range ON intervals(device_id,end,start);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE notifications (
      id TEXT PRIMARY KEY, home_id TEXT REFERENCES homes(id), kind TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', sent_at INTEGER, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, first_attempt INTEGER, next_attempt INTEGER,
      payload TEXT
    );
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE heating_observations (
        device_id TEXT NOT NULL REFERENCES devices(id), at INTEGER NOT NULL,
        heating INTEGER, raw_value TEXT, code TEXT, online INTEGER NOT NULL,
        source TEXT NOT NULL, config_revision INTEGER NOT NULL, rated_power_kw REAL,
        PRIMARY KEY(device_id, at)
      );
CREATE TABLE energy_reports (
          device_id TEXT NOT NULL REFERENCES devices(id), code TEXT NOT NULL, report_id TEXT NOT NULL,
          at INTEGER NOT NULL, kwh REAL NOT NULL CHECK(kwh>=0), received_at INTEGER NOT NULL,
          PRIMARY KEY(device_id,code,report_id)
        );
CREATE INDEX energy_reports_range ON energy_reports(device_id,at);
CREATE TABLE power_observations (
          device_id TEXT NOT NULL REFERENCES devices(id), at INTEGER NOT NULL,
          power_w REAL CHECK(power_w>=0), field TEXT, source TEXT NOT NULL,
          PRIMARY KEY(device_id,at)
        );
PRAGMA user_version=4;
