import { AccountService, PasswordHasher } from './Accounts';
import { APIError, JSONRecord } from './HTTP';
import { RegistryService } from './RegistryService';

export type AdminAccountRow = {
  id: string;
  email: string;
  orgId: string | null;
  organizationSlug: string | null;
  createdAt: string;
  hostCount: number;
  workCount: number;
};

export type AdminAccountList = {
  items: AdminAccountRow[];
  total: number;
};

type AdminAuditRow = {
  id: string;
  actorEmail: string;
  eventPath: string;
  createdAt: string;
};

export class AdminService {
  private static readonly SUMMARY_SELECT = `SELECT a.id, a.email, a.org_id AS orgId,
           o.slug AS organizationSlug, a.created_at AS createdAt,
           (SELECT COUNT(*) FROM addresses d WHERE d.org_id = a.org_id
              AND d.parent_address_id IS NULL AND d.revoked_at IS NULL) AS hostCount,
           (SELECT COUNT(*) FROM addresses d WHERE d.org_id = a.org_id
              AND d.parent_address_id IS NOT NULL AND d.revoked_at IS NULL) AS workCount
          FROM accounts a LEFT JOIN organizations o ON o.id = a.org_id`;

  constructor(
    private readonly db: D1Database,
    private readonly accounts: AccountService,
    private readonly registry: RegistryService,
  ) {}

  private async credentialMetadata(orgId: string) {
    const response = await this.db.prepare(`SELECT id, kind, address_id AS addressId,
          created_at AS createdAt, revoked_at AS revokedAt
          FROM credentials WHERE org_id = ? ORDER BY created_at DESC LIMIT 200`)
      .bind(orgId)
      .all();

    return response.results;
  }

  private async enrollmentMetadata(orgId: string) {
    const response = await this.db.prepare(`SELECT id, host_handle AS hostHandle,
          expires_at AS expiresAt, used_at AS usedAt, created_at AS createdAt
          FROM enrollments WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(orgId)
      .all();

    return response.results;
  }

  private async auditHistory(accountId: string): Promise<AdminAuditRow[]> {
    const response = await this.db.prepare(`SELECT id, actor_email AS actorEmail,
          event_path AS eventPath, created_at AS createdAt
          FROM admin_audit WHERE target_account_id = ?
          ORDER BY created_at DESC LIMIT 50`)
      .bind(accountId)
      .all<AdminAuditRow>();

    return response.results;
  }

  async listAccounts(search: string, offset: number, limit: number): Promise<AdminAccountList> {
    const keyword = search.trim().toLowerCase();
    const condition = 'WHERE instr(lower(a.email), ?) > 0 OR instr(lower(coalesce(o.slug, \'\')), ?) > 0';

    const [countRow, records] = await Promise.all([
      this.db.prepare(`SELECT COUNT(*) AS count FROM accounts a
        LEFT JOIN organizations o ON o.id = a.org_id ${condition}`)
        .bind(keyword, keyword)
        .first<{ count: number }>(),
      this.db.prepare(`${AdminService.SUMMARY_SELECT} ${condition}
        ORDER BY a.created_at DESC, a.id LIMIT ? OFFSET ?`)
        .bind(keyword, keyword, limit, offset)
        .all<AdminAccountRow>(),
    ]);

    return { items: records.results, total: countRow!.count };
  }

  async getAccount(id: string): Promise<JSONRecord> {
    const account = await this.db.prepare(`${AdminService.SUMMARY_SELECT} WHERE a.id = ?`)
      .bind(id)
      .first<AdminAccountRow>();

    if (!account) {
      throw new APIError(404, 'account_not_found', 'Account not found.');
    }

    const auditEvents = await this.auditHistory(id);
    if (!account.orgId) {
      return {
        ...account,
        organization: null,
        addresses: [],
        credentials: [],
        enrollments: [],
        auditEvents,
      };
    }

    const [organization, addresses, credentials, enrollments] = await Promise.all([
      this.registry.getOrganizationById(account.orgId),
      this.registry.listAddresses(account.orgId),
      this.credentialMetadata(account.orgId),
      this.enrollmentMetadata(account.orgId),
    ]);

    return {
      ...account,
      organization: RegistryService.publicOrganization(organization),
      addresses: addresses.map((address) => RegistryService.publicAddress(organization.slug, address)),
      credentials,
      enrollments,
      auditEvents,
    };
  }

  async resetPassword(accountId: string, password: string, actorEmail: string): Promise<JSONRecord> {
    await this.accounts.getAccount(accountId);

    const { salt, hash } = await PasswordHasher.createCredentials(password);
    const createdAt = RegistryService.nowISO();

    // D1 batch commits the credential update and its audit event together.
    const [changed] = await this.db.batch([
      this.db.prepare(`UPDATE accounts SET password_hash = ?, password_salt = ?,
             auth_version = auth_version + 1 WHERE id = ?`)
        .bind(hash, salt, accountId),
      this.db.prepare(`INSERT INTO admin_audit
             (id, actor_email, target_account_id, event_path, created_at)
             VALUES (?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), actorEmail, accountId, '/accounts/password/update', createdAt),
    ]);

    if (changed.meta.changes !== 1) {
      throw new APIError(404, 'account_not_found', 'Account no longer exists.');
    }

    return { id: accountId, passwordChanged: true };
  }
}
