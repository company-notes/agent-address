-- Account-authorized, retry-safe registration of office-managed identities.
-- A single D1 transaction creates Agent, Default Session and request ownership.
-- Runtime and Resume tokens are never exposed by this management endpoint.
CREATE TABLE agent_registration_requests (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  registration_id TEXT NOT NULL,
  agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  agent_handle TEXT NOT NULL,
  agent_display_name TEXT NOT NULL,
  session_handle TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, registration_id)
);

CREATE INDEX idx_agent_registration_requests_agent
  ON agent_registration_requests(org_id, agent_id);
