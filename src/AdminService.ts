import { AccountService, PasswordHasher } from './Accounts';
import { ApplicationError } from './ApplicationError';
import { OrganizationService } from './Organizations';

export type AdminAccountRow = {
  id: string;
  email: string;
  orgId: string | null;
  organizationSlug: string | null;
  createdAt: string;
  agentCount: number;
  sessionCount: number;
};

export type AdminAccountList = {
  items: AdminAccountRow[];
  total: number;
};

type AdminAgentRow = {
  id: string;
  handle: string;
  displayName: string | null;
  createdAt: string;
};

type AdminSessionRow = {
  id: string;
  agentId: string;
  agentHandle: string;
  handle: string;
  displayName: string | null;
  isDefault: number;
  createdAt: string;
};

type AuditEvent = {
  id: string;
  actorEmail: string;
  eventPath: string;
  createdAt: string;
};

export class AdminService {
  private static readonly ACCOUNT_SELECT = `
    SELECT a.id, a.email, a.org_id AS orgId, o.slug AS organizationSlug,
           a.created_at AS createdAt,
           (SELECT COUNT(*) FROM agents g
             WHERE g.org_id = a.org_id AND g.archived_at IS NULL) AS agentCount,
           (SELECT COUNT(*) FROM sessions s JOIN agents g ON g.id = s.agent_id
             WHERE g.org_id = a.org_id AND g.archived_at IS NULL AND s.archived_at IS NULL) AS sessionCount
      FROM accounts a
      LEFT JOIN organizations o ON o.id = a.org_id`;

  constructor(
    private readonly db: D1Database,
    private readonly accounts: AccountService,
    private readonly organizations: OrganizationService,
  ) {}

  async listAccounts(search: string, offset: number, limit: number): Promise<AdminAccountList> {
    const keyword = search.trim().toLowerCase();
    const condition = `WHERE instr(lower(a.email), ?) > 0
      OR instr(lower(coalesce(o.slug, '')), ?) > 0`;

    const [count, items] = await Promise.all([
      this.db.prepare(
        `SELECT COUNT(*) AS count FROM accounts a
         LEFT JOIN organizations o ON o.id = a.org_id ${condition}`,
      ).bind(keyword, keyword).first<{ count: number }>(),
      this.db.prepare(
        `${AdminService.ACCOUNT_SELECT} ${condition}
         ORDER BY a.created_at DESC, a.id LIMIT ? OFFSET ?`,
      ).bind(keyword, keyword, limit, offset).all<AdminAccountRow>(),
    ]);

    return { items: items.results, total: count!.count };
  }

  async getAccount(accountID: string) {
    const account = await this.db.prepare(
      `${AdminService.ACCOUNT_SELECT} WHERE a.id = ?`,
    ).bind(accountID).first<AdminAccountRow>();

    if (!account) {
      throw new ApplicationError(404, 'account_not_found', 'Account not found.');
    }

    const audits = this.db.prepare(
      `SELECT id, actor_email AS actorEmail,
              event_path AS eventPath, created_at AS createdAt
         FROM admin_audit WHERE target_account_id = ?
         ORDER BY created_at DESC LIMIT 50`,
    ).bind(accountID).all<AuditEvent>();

    if (!account.orgId) {
      return {
        ...account,
        organization: null,
        agents: [],
        sessions: [],
        auditEvents: (await audits).results,
      };
    }

    const [organization, agents, sessions, auditEvents] = await Promise.all([
      this.organizations.getByID(account.orgId),
      this.db.prepare(
        `SELECT id, handle, display_name AS displayName, created_at AS createdAt
           FROM agents WHERE org_id = ? AND archived_at IS NULL
           ORDER BY handle COLLATE NOCASE`,
      ).bind(account.orgId).all<AdminAgentRow>(),
      this.db.prepare(
        `SELECT s.id, s.agent_id AS agentId, a.handle AS agentHandle,
                s.handle, s.display_name AS displayName,
                s.is_default AS isDefault, s.created_at AS createdAt
           FROM sessions s JOIN agents a ON a.id = s.agent_id
          WHERE a.org_id = ? AND a.archived_at IS NULL AND s.archived_at IS NULL
          ORDER BY a.handle COLLATE NOCASE, s.handle COLLATE NOCASE`,
      ).bind(account.orgId).all<AdminSessionRow>(),
      audits,
    ]);

    return {
      ...account,
      organization,
      agents: agents.results,
      sessions: sessions.results.map((session) => ({
        ...session,
        canonical: `${organization.slug}/${session.agentHandle}/${session.handle}`,
        isDefault: session.isDefault === 1,
      })),
      auditEvents: auditEvents.results,
    };
  }

  async resetPassword(accountID: string, password: string, actorEmail: string) {
    await this.accounts.getAccount(accountID);

    const { salt, hash } = await PasswordHasher.createCredentials(password);
    const now = new Date().toISOString();

    // Password change and audit insertion commit as a single D1 transaction.
    const [changed] = await this.db.batch([
      this.db.prepare(
        `UPDATE accounts
            SET password_hash = ?, password_salt = ?, auth_version = auth_version + 1
          WHERE id = ?`,
      ).bind(hash, salt, accountID),
      this.db.prepare(
        `INSERT INTO admin_audit
          (id, actor_email, target_account_id, event_path, created_at)
          VALUES (?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), actorEmail, accountID, '/accounts/password/update', now),
    ]);

    if (changed.meta.changes !== 1) {
      throw new ApplicationError(404, 'account_not_found', 'Account no longer exists.');
    }

    return { id: accountID, passwordChanged: true };
  }
}
