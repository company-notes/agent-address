CREATE TABLE browser_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_browser_sessions_expiry ON browser_sessions(expires_at);
