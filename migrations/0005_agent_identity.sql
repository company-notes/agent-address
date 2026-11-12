PRAGMA foreign_keys = ON;

-- New identity model is deliberately separate from legacy addresses/credentials.
-- Existing Host/Work data stays untouched until an explicit migration is designed.
CREATE TABLE agent_identities (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  handle TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_active_agents_org_handle
  ON agent_identities(org_id, handle COLLATE NOCASE)
  WHERE archived_at IS NULL;

CREATE INDEX idx_agents_org ON agent_identities(org_id);

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  handle TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  resume_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (agent_id) REFERENCES agent_identities(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_active_sessions_agent_handle
  ON agent_sessions(agent_id, handle COLLATE NOCASE)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX idx_active_default_session
  ON agent_sessions(agent_id)
  WHERE is_default = 1 AND archived_at IS NULL;

CREATE INDEX idx_sessions_agent ON agent_sessions(agent_id);

-- One live runtime lease per session, independently of the Agent address.
-- A lease must be renewed; resume can acquire it only after expiry or release.
CREATE TABLE session_runtime_leases (
  session_id TEXT PRIMARY KEY,
  runtime_token_hash TEXT NOT NULL UNIQUE,
  runtime_label TEXT,
  refreshed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);
