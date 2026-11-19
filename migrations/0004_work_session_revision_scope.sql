-- A new non-default Session cannot change the existing Agent directory or roster.
-- Its exact address is immediately available through the authoritative resolver.
DROP TRIGGER sessions_identity_revision_insert;

CREATE TRIGGER sessions_identity_revision_insert
AFTER INSERT ON sessions
WHEN NEW.is_default = 1
BEGIN
  UPDATE organizations SET identity_revision = identity_revision + 1
    WHERE id = (SELECT org_id FROM agents WHERE id = NEW.agent_id);
END;
