PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS devices_owner ON devices(owner_id);
CREATE TABLE IF NOT EXISTS snapshots (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  sequence INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pairings (
  code TEXT PRIMARY KEY,
  poll_hash TEXT NOT NULL,
  device_id TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  owner_id TEXT,
  project_id TEXT REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
