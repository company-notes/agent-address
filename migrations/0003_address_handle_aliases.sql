-- Reserve former address components for the same immutable identity.
-- Existing current names remain governed by their original unique indexes.
CREATE TABLE address_handle_aliases (
  kind TEXT NOT NULL CHECK (kind IN ('organization', 'agent', 'session')),
  scope_id TEXT NOT NULL,
  handle TEXT NOT NULL COLLATE NOCASE,
  identity_id TEXT NOT NULL,
  PRIMARY KEY (kind, scope_id, handle)
);

CREATE TRIGGER organizations_alias_insert
BEFORE INSERT ON organizations
WHEN EXISTS (
  SELECT 1 FROM address_handle_aliases
   WHERE kind = 'organization' AND scope_id = '' AND handle = NEW.slug
     AND identity_id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: organizations.slug');
END;

CREATE TRIGGER organizations_alias_update
BEFORE UPDATE OF slug ON organizations
WHEN EXISTS (
  SELECT 1 FROM address_handle_aliases
   WHERE kind = 'organization' AND scope_id = '' AND handle = NEW.slug
     AND identity_id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: organizations.slug');
END;

CREATE TRIGGER organizations_retain_handle
AFTER UPDATE OF slug ON organizations
WHEN OLD.slug <> NEW.slug COLLATE NOCASE
BEGIN
  INSERT OR IGNORE INTO address_handle_aliases (kind, scope_id, handle, identity_id)
  VALUES ('organization', '', OLD.slug, OLD.id);
END;

CREATE TRIGGER agents_alias_insert
BEFORE INSERT ON agents
WHEN EXISTS (
  SELECT 1 FROM address_handle_aliases
   WHERE kind = 'agent' AND scope_id = NEW.org_id AND handle = NEW.handle
     AND identity_id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: agents.org_id, agents.handle');
END;

CREATE TRIGGER agents_alias_update
BEFORE UPDATE OF handle ON agents
WHEN EXISTS (
  SELECT 1 FROM address_handle_aliases
   WHERE kind = 'agent' AND scope_id = NEW.org_id AND handle = NEW.handle
     AND identity_id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: agents.org_id, agents.handle');
END;

CREATE TRIGGER agents_retain_handle
AFTER UPDATE OF handle ON agents
WHEN OLD.handle <> NEW.handle COLLATE NOCASE
BEGIN
  INSERT OR IGNORE INTO address_handle_aliases (kind, scope_id, handle, identity_id)
  VALUES ('agent', OLD.org_id, OLD.handle, OLD.id);
END;

CREATE TRIGGER sessions_alias_insert
BEFORE INSERT ON sessions
WHEN EXISTS (
  SELECT 1 FROM address_handle_aliases
   WHERE kind = 'session' AND scope_id = NEW.agent_id AND handle = NEW.handle
     AND identity_id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: sessions.agent_id, sessions.handle');
END;

CREATE TRIGGER sessions_alias_update
BEFORE UPDATE OF handle ON sessions
WHEN EXISTS (
  SELECT 1 FROM address_handle_aliases
   WHERE kind = 'session' AND scope_id = NEW.agent_id AND handle = NEW.handle
     AND identity_id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: sessions.agent_id, sessions.handle');
END;

CREATE TRIGGER sessions_retain_handle
AFTER UPDATE OF handle ON sessions
WHEN OLD.handle <> NEW.handle COLLATE NOCASE
BEGIN
  INSERT OR IGNORE INTO address_handle_aliases (kind, scope_id, handle, identity_id)
  VALUES ('session', OLD.agent_id, OLD.handle, OLD.id);
END;

-- Invalidate dependent name/address projections only when identity data changes.
-- The existing Session read used for Runtime renewal returns the same SQL snapshot.
ALTER TABLE organizations ADD COLUMN identity_revision INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER organizations_identity_revision
AFTER UPDATE OF slug ON organizations
WHEN OLD.slug IS NOT NEW.slug
BEGIN
  UPDATE organizations SET identity_revision = identity_revision + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER agents_identity_revision_insert
AFTER INSERT ON agents
BEGIN
  UPDATE organizations SET identity_revision = identity_revision + 1 WHERE id = NEW.org_id;
END;

CREATE TRIGGER agents_identity_revision_update
AFTER UPDATE OF handle, display_name, archived_at ON agents
WHEN OLD.handle IS NOT NEW.handle OR OLD.display_name IS NOT NEW.display_name
  OR OLD.archived_at IS NOT NEW.archived_at
BEGIN
  UPDATE organizations SET identity_revision = identity_revision + 1 WHERE id = NEW.org_id;
END;

CREATE TRIGGER sessions_identity_revision_insert
AFTER INSERT ON sessions
BEGIN
  UPDATE organizations SET identity_revision = identity_revision + 1
    WHERE id = (SELECT org_id FROM agents WHERE id = NEW.agent_id);
END;

CREATE TRIGGER sessions_identity_revision_update
AFTER UPDATE OF handle, is_default, archived_at ON sessions
WHEN OLD.handle IS NOT NEW.handle OR OLD.is_default IS NOT NEW.is_default
  OR OLD.archived_at IS NOT NEW.archived_at
BEGIN
  UPDATE organizations SET identity_revision = identity_revision + 1
    WHERE id = (SELECT org_id FROM agents WHERE id = NEW.agent_id);
END;
