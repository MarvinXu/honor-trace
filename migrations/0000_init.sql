CREATE TABLE IF NOT EXISTS location_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  updated_at TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy TEXT,
  battery TEXT,
  address TEXT,
  device_name TEXT,
  account TEXT NOT NULL,
  account_name TEXT NOT NULL,
  network_name TEXT,
  network_type TEXT,
  network_signal TEXT,
  sim_no TEXT,
  carrier TEXT,
  is_charging TEXT,
  is_lock_screen TEXT
);

CREATE INDEX IF NOT EXISTS idx_acct_ts ON location_records(account, timestamp);
