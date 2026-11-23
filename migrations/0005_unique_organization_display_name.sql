-- Organization identity is chosen during OAuth sign-up and cannot be reused.
-- Existing production names are checked before applying this migration.
CREATE UNIQUE INDEX idx_organizations_unique_display_name
  ON organizations (lower(trim(display_name)));
