CREATE TABLE IF NOT EXISTS trial_window_limits (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  max_windows INTEGER NOT NULL CHECK(max_windows >= 10)
);
INSERT OR IGNORE INTO trial_window_limits(project_id,max_windows)
SELECT p.id, MAX(10, COALESCE((SELECT SUM(json_array_length(l.value,'$.windows')) FROM json_each(s.body,'$.lanes') l),0))
FROM projects p LEFT JOIN snapshots s ON s.project_id=p.id;
CREATE TABLE IF NOT EXISTS sync_issues (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  attempted_at INTEGER NOT NULL,
  window_count INTEGER NOT NULL,
  window_limit INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_entitlements (
  owner_id TEXT PRIMARY KEY,
  unlimited INTEGER NOT NULL DEFAULT 0 CHECK(unlimited IN (0,1))
);
