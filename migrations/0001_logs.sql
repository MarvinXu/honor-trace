CREATE TABLE IF NOT EXISTS request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  module TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT,
  account TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_ts ON request_logs(timestamp);
