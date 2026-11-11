PRAGMA foreign_keys = ON;

-- Existing OAuth grants have an implicit auth version of zero.
ALTER TABLE accounts ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  event_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (target_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_admin_audit_target_created
  ON admin_audit(target_account_id, created_at DESC);
