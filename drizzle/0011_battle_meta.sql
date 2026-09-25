-- Retain verified match telemetry for one week and keep only compact aggregate
-- reports longer. Names, wallet addresses, bounty titles, and account IDs are
-- deliberately not copied into the battle payload.
CREATE TABLE IF NOT EXISTS battle_meta_logs (
  id TEXT PRIMARY KEY,
  attempt_id TEXT UNIQUE REFERENCES attempts(id),
  client_battle_id TEXT UNIQUE,
  source TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  settled_at INTEGER,
  engine_hash TEXT NOT NULL,
  arena TEXT NOT NULL,
  seed INTEGER NOT NULL,
  winner INTEGER NOT NULL,
  duration REAL NOT NULL,
  battle_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_battle_meta_retention
  ON battle_meta_logs(captured_at);
CREATE INDEX IF NOT EXISTS idx_battle_meta_report_window
  ON battle_meta_logs(settled_at, source, engine_hash);

CREATE TABLE IF NOT EXISTS battle_meta_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  interval_hours INTEGER NOT NULL,
  battle_count INTEGER NOT NULL,
  engine_hashes TEXT NOT NULL,
  report_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_battle_meta_reports_latest
  ON battle_meta_reports(generated_at DESC);

CREATE TABLE IF NOT EXISTS battle_meta_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  last_report_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT
);

INSERT OR IGNORE INTO battle_meta_state (id,last_report_at,lease_until,lease_token)
VALUES (1,0,0,NULL);
