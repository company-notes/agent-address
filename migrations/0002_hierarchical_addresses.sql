PRAGMA foreign_keys = ON;

ALTER TABLE addresses ADD COLUMN parent_address_id TEXT REFERENCES addresses(id) ON DELETE CASCADE;
ALTER TABLE addresses ADD COLUMN path TEXT;

UPDATE addresses
SET path = handle
WHERE path IS NULL;

DROP INDEX idx_addresses_org_handle;

CREATE UNIQUE INDEX idx_addresses_org_path
  ON addresses(org_id, path COLLATE NOCASE)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_addresses_parent_id
  ON addresses(parent_address_id);
