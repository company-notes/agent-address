import { ApplicationError } from './ApplicationError';
import { IdentityNames } from './IdentityNames';

export type OrganizationRow = {
  id: string;
  slug: string;
  displayName: string;
  createdAt: string;
};

export class OrganizationService {
  private static readonly SELECT = `SELECT id, slug, display_name AS displayName,
    created_at AS createdAt FROM organizations`;

  constructor(private readonly db: D1Database) {}

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
    const organization = await this.db.prepare(
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
      'INSERT INTO organizations (id, slug, display_name, created_at) VALUES (?, ?, ?, ?)',
    ).bind(id, slug, displayName, createdAt);

    const assignOwner = this.db.prepare(
      'UPDATE accounts SET org_id = ? WHERE id = ? AND org_id IS NULL',
    ).bind(id, accountID);

    try {
      const [, updated] = await this.db.batch([record, assignOwner]);

      if (updated.meta.changes !== 1) {
        throw new ApplicationError(409, 'account_has_organization', 'Account already belongs to an Organization.');
      }
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed: organizations.slug')) {
        console.debug('Organization handle collision:', error);
        throw new ApplicationError(409, 'organization_name_taken', 'Organization name is already registered.');
      }

      throw error;
    }

    return { id, slug, displayName, createdAt };
  }
}
