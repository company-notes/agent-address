PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  org_id TEXT UNIQUE REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  handle TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE UNIQUE INDEX idx_agents_active_name
  ON agents(org_id, handle COLLATE NOCASE)
  WHERE archived_at IS NULL;

CREATE INDEX idx_agents_org ON agents(org_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  handle TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  resume_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE UNIQUE INDEX idx_sessions_active_name
  ON sessions(agent_id, handle COLLATE NOCASE)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX idx_sessions_one_default
  ON sessions(agent_id) WHERE is_default = 1 AND archived_at IS NULL;

CREATE INDEX idx_sessions_agent ON sessions(agent_id);

CREATE TABLE session_runtime_leases (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  runtime_token_hash TEXT NOT NULL UNIQUE,
  runtime_label TEXT,
  refreshed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  target_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_audit_account_time
  ON admin_audit(target_account_id, created_at DESC);
