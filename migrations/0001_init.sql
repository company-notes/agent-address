PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE addresses (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  handle TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_addresses_org_handle
  ON addresses(org_id, handle COLLATE NOCASE);

CREATE INDEX idx_addresses_org_id
  ON addresses(org_id);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('org', 'address')),
  org_id TEXT NOT NULL,
  address_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (address_id) REFERENCES addresses(id) ON DELETE CASCADE,
  CHECK (
    (kind = 'org' AND address_id IS NULL)
    OR
    (kind = 'address' AND address_id IS NOT NULL)
  )
);

CREATE INDEX idx_credentials_org_id ON credentials(org_id);
CREATE INDEX idx_credentials_address_id ON credentials(address_id);
