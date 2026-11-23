import { ApplicationError } from './ApplicationError';
import { IdentityNames } from './IdentityNames';

export type OrganizationRow = {
  id: string;
  slug: string;
  displayName: string;
  createdAt: string;
};

export type OrganizationChanges = { slug?: string; displayName?: string };

/** Verified Account and Organization data scoped to a single HTTP request. */
export type OrganizationScope = {
  accountID: string;
  organization: OrganizationRow | null;
};

export class OrganizationService {
  private static readonly SELECT = `SELECT id, slug, display_name AS displayName,
    created_at AS createdAt FROM organizations`;

  constructor(
    private readonly db: D1Database,
    private readonly scope?: OrganizationScope,
  ) {}

  async getByID(id: string): Promise<OrganizationRow> {
    const organization = await this.db.prepare(
      `${OrganizationService.SELECT} WHERE id = ?`,
    ).bind(id).first<OrganizationRow>();

    if (!organization) {
      throw new ApplicationError(404, 'organization_not_found', 'Organization not found.');
    }

    return organization;
  }

  async getForAccount(accountID: string): Promise<OrganizationRow> {
    const organization = this.scope?.accountID === accountID
      ? this.scope.organization
      : await this.db.prepare(
        `${OrganizationService.SELECT}
          WHERE id = (SELECT org_id FROM accounts WHERE id = ?)`,
      ).bind(accountID).first<OrganizationRow>();

    if (!organization) {
      throw new ApplicationError(409, 'no_organization', 'Register your Organization first.');
    }

    return organization;
  }

  async register(accountID: string, requestedSlug: string, displayName: string): Promise<OrganizationRow> {
    const slug = IdentityNames.organizationSlug(requestedSlug);
    displayName = IdentityNames.organizationDisplayName(displayName);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const existing = await this.db.prepare(
      'SELECT org_id AS orgID FROM accounts WHERE id = ?',
    ).bind(accountID).first<{ orgID: string | null }>();

    if (!existing) {
      throw new ApplicationError(401, 'invalid_account', 'Account no longer exists.');
    }

    if (existing.orgID) {
      throw new ApplicationError(409, 'account_has_organization', 'Account already belongs to an Organization.');
    }

    const record = this.db.prepare(
      `INSERT INTO organizations (id, slug, display_name, created_at)
         SELECT ?, ?, ?, ? FROM accounts WHERE id = ? AND org_id IS NULL`,
    ).bind(id, slug, displayName, createdAt, accountID);

    const assignOwner = this.db.prepare(
      'UPDATE accounts SET org_id = ? WHERE id = ? AND org_id IS NULL',
    ).bind(id, accountID);

    try {
      const [, updated] = await this.db.batch([record, assignOwner]);

      if (updated.meta.changes !== 1) {
        throw new ApplicationError(409, 'account_has_organization', 'Account already belongs to an Organization.');
      }
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed: organizations.slug') ||
          String(error).includes('idx_organizations_unique_display_name')) {
        console.debug('Organization handle collision:', error);
        throw new ApplicationError(409, 'organization_name_taken', 'Organization name is already registered.');
      }

      throw error;
    }

    return { id, slug, displayName, createdAt };
  }

  async ownsAlias(organizationID: string, slug: string): Promise<boolean> {
    const alias = await this.db.prepare(
      `SELECT identity_id FROM address_handle_aliases
        WHERE kind = 'organization' AND scope_id = '' AND handle = ? AND identity_id = ?`,
    ).bind(slug, organizationID).first();

    return alias !== null;
  }

  async update(
    accountID: string, changes: OrganizationChanges, audit?: D1PreparedStatement,
  ): Promise<OrganizationRow> {
    const current = await this.getForAccount(accountID);
    const slug = changes.slug === undefined ? current.slug : IdentityNames.organizationSlug(changes.slug);
    const displayName = IdentityNames.organizationDisplayName(changes.displayName ?? current.displayName);

    try {
      await this.db.batch([
        this.db.prepare('UPDATE organizations SET slug = ?, display_name = ? WHERE id = ?')
          .bind(slug, displayName, current.id),
        ...(audit ? [audit] : []),
      ]);
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed: organizations.slug') ||
          String(error).includes('idx_organizations_unique_display_name')) {
        console.debug('Organization handle collision:', error);
        throw new ApplicationError(409, 'organization_name_taken', 'Organization name is already registered.');
      }

      throw error;
    }

    return this.getByID(current.id);
  }
}
