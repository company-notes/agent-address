import { AccountService } from './Accounts';
import { APIError, RequestData } from './HTTP';
import { OrganizationRow, RegistryService } from './RegistryService';
import { RuntimeLeaseService } from './RuntimeLeaseService';
import { TokenService } from './Tokens';

export type NewAgentInput = {
  agentName?: string;
  sessionName?: string;
  agentDisplayName?: string;
  sessionDisplayName?: string;
  runtimeLabel?: string;
};

export type NewSessionInput = {
  sessionName?: string;
  sessionDisplayName?: string;
  runtimeLabel?: string;
};

export type AgentRow = {
  id: string;
  orgId: string;
  handle: string;
  displayName: string | null;
  createdAt: string;
  defaultSessionID: string | null;
  defaultSessionHandle: string | null;
};

type SessionRow = {
  id: string;
  agentId: string;
  agentHandle: string;
  agentDisplayName: string | null;
  sessionHandle: string;
  sessionDisplayName: string | null;
  isDefault: number;
  createdAt: string;
};

export type PublicSession = {
  id: string;
  agentId: string;
  agentHandle: string;
  agentDisplayName: string | null;
  handle: string;
  displayName: string | null;
  canonical: string;
  isDefault: boolean;
  createdAt: string;
};

export type ClaimedIdentity = {
  session: PublicSession;
  runtimeToken: string;
  resumeToken: string;
  leaseExpiresAt: string;
};

export type ResumedIdentity = {
  session: PublicSession;
  runtimeToken: string;
  leaseExpiresAt: string;
};

// Domain model for Organization -> Agent -> Session.
// Knows nothing about HTTP routes, OAuth, MCP or product-specific runtime types.
export class IdentityService {
  private static readonly AGENT_SELECT = `
    SELECT a.id, a.org_id AS orgId, a.handle, a.display_name AS displayName,
           a.created_at AS createdAt,
           s.id AS defaultSessionID, s.handle AS defaultSessionHandle
      FROM agent_identities a
      LEFT JOIN agent_sessions s ON s.agent_id = a.id
           AND s.is_default = 1 AND s.archived_at IS NULL
  `;

  private static readonly SESSION_SELECT = `
    SELECT s.id, s.agent_id AS agentId, a.handle AS agentHandle,
           a.display_name AS agentDisplayName, s.handle AS sessionHandle,
           s.display_name AS sessionDisplayName, s.is_default AS isDefault,
           s.created_at AS createdAt
      FROM agent_sessions s
      JOIN agent_identities a ON a.id = s.agent_id
  `;

  constructor(
    private readonly db: D1Database,
    private readonly accounts: AccountService,
    private readonly leases: RuntimeLeaseService,
  ) {}

  private static newHandle(prefix: string): string {
    return prefix + '-' + crypto.randomUUID().slice(0, 8);
  }

  private static handle(value: string | undefined, prefix: string): string {
    return RequestData.normalizeHandle(value ?? this.newHandle(prefix));
  }

  private static publicSession(orgSlug: string, row: SessionRow): PublicSession {
    return {
      id: row.id,
      agentId: row.agentId,
      agentHandle: row.agentHandle,
      agentDisplayName: row.agentDisplayName,
      handle: row.sessionHandle,
      displayName: row.sessionDisplayName,
      canonical: `${orgSlug}/${row.agentHandle}/${row.sessionHandle}`,
      isDefault: row.isDefault === 1,
      createdAt: row.createdAt,
    };
  }

  private async organization(accountID: string): Promise<OrganizationRow> {
    const account = await this.accounts.getAccount(accountID);

    return this.accounts.requireOrganization(account);
  }

  private async requireAgent(orgID: string, agentID: string): Promise<AgentRow> {
    const agent = await this.db.prepare(
      `${IdentityService.AGENT_SELECT}
       WHERE a.org_id = ? AND a.id = ? AND a.archived_at IS NULL`,
    ).bind(orgID, agentID).first<AgentRow>();

    if (!agent) {
      throw new APIError(404, 'agent_not_found', 'Agent not found in your Organization.');
    }

    return agent;
  }

  private async requireSession(orgID: string, sessionID: string): Promise<SessionRow> {
    const session = await this.db.prepare(
      `${IdentityService.SESSION_SELECT}
       WHERE a.org_id = ? AND s.id = ?
         AND a.archived_at IS NULL AND s.archived_at IS NULL`,
    ).bind(orgID, sessionID).first<SessionRow>();

    if (!session) {
      throw new APIError(404, 'session_not_found', 'Session not found in your Organization.');
    }

    return session;
  }

  private static duplicateName(error: unknown): never {
    if (RegistryService.isUniqueViolation(error)) {
      console.debug('Agent or Session handle already exists:', error);

      throw new APIError(409, 'identity_name_taken', 'That Agent or Session name is already in use.');
    }

    throw error;
  }

  async createAgent(accountID: string, input: NewAgentInput): Promise<ClaimedIdentity> {
    const org = await this.organization(accountID);
    const agentID = crypto.randomUUID();
    const sessionID = crypto.randomUUID();
    const agentHandle = IdentityService.handle(input.agentName, 'agent');
    const sessionHandle = IdentityService.handle(input.sessionName, 'session');
    const createdAt = new Date().toISOString();
    const resumeToken = TokenService.randomToken('resume');
    const resumeHash = await TokenService.sha256Hex(resumeToken);
    const lease = await this.leases.prepareInitialLease(sessionID, input.runtimeLabel ?? null);

    const agentInsert = this.db.prepare(
      `INSERT INTO agent_identities (id, org_id, handle, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(agentID, org.id, agentHandle, input.agentDisplayName ?? null, createdAt);

    const sessionInsert = this.db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_id, handle, display_name, is_default, resume_token_hash, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(sessionID, agentID, sessionHandle, input.sessionDisplayName ?? null, resumeHash, createdAt);

    try {
      await this.db.batch([agentInsert, sessionInsert, lease.statement]);
    } catch (error) {
      IdentityService.duplicateName(error);
    }

    const row: SessionRow = {
      id: sessionID,
      agentId: agentID,
      agentHandle,
      agentDisplayName: input.agentDisplayName ?? null,
      sessionHandle,
      sessionDisplayName: input.sessionDisplayName ?? null,
      isDefault: 1,
      createdAt,
    };

    return {
      session: IdentityService.publicSession(org.slug, row),
      runtimeToken: lease.runtimeToken,
      resumeToken,
      leaseExpiresAt: lease.expiresAt,
    };
  }

  async createSession(
    accountID: string,
    agentID: string,
    input: NewSessionInput,
  ): Promise<ClaimedIdentity> {
    const org = await this.organization(accountID);
    const agent = await this.requireAgent(org.id, agentID);
    const sessionID = crypto.randomUUID();
    const sessionHandle = IdentityService.handle(input.sessionName, 'session');
    const resumeToken = TokenService.randomToken('resume');
    const resumeHash = await TokenService.sha256Hex(resumeToken);
    const createdAt = new Date().toISOString();
    const lease = await this.leases.prepareInitialLease(sessionID, input.runtimeLabel ?? null);

    const sessionInsert = this.db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_id, handle, display_name, is_default, resume_token_hash, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).bind(sessionID, agent.id, sessionHandle, input.sessionDisplayName ?? null, resumeHash, createdAt);

    try {
      await this.db.batch([sessionInsert, lease.statement]);
    } catch (error) {
      IdentityService.duplicateName(error);
    }

    return {
      session: IdentityService.publicSession(org.slug, {
        id: sessionID,
        agentId: agent.id,
        agentHandle: agent.handle,
        agentDisplayName: agent.displayName,
        sessionHandle,
        sessionDisplayName: input.sessionDisplayName ?? null,
        isDefault: 0,
        createdAt,
      }),
      runtimeToken: lease.runtimeToken,
      resumeToken,
      leaseExpiresAt: lease.expiresAt,
    };
  }

  async listAgents(accountID: string): Promise<AgentRow[]> {
    const org = await this.organization(accountID);
    const response = await this.db.prepare(
      `${IdentityService.AGENT_SELECT}
       WHERE a.org_id = ? AND a.archived_at IS NULL
       ORDER BY a.handle COLLATE NOCASE`,
    ).bind(org.id).all<AgentRow>();

    return response.results;
  }

  async listSessions(accountID: string, agentID: string): Promise<PublicSession[]> {
    const org = await this.organization(accountID);
    await this.requireAgent(org.id, agentID);

    const response = await this.db.prepare(
      `${IdentityService.SESSION_SELECT}
       WHERE a.org_id = ? AND a.id = ? AND s.archived_at IS NULL
       ORDER BY s.is_default DESC, s.handle COLLATE NOCASE`,
    ).bind(org.id, agentID).all<SessionRow>();

    return response.results.map((session) => IdentityService.publicSession(org.slug, session));
  }

  async getSession(accountID: string, sessionID: string): Promise<PublicSession> {
    const org = await this.organization(accountID);
    const session = await this.requireSession(org.id, sessionID);

    return IdentityService.publicSession(org.slug, session);
  }

  async resolve(accountID: string, address: string): Promise<PublicSession> {
    const org = await this.organization(accountID);
    const segments = RequestData.normalizePath(address).split('/');

    if (segments.length !== 2 && segments.length !== 3) {
      throw new APIError(400, 'invalid_address', 'Use organization/agent or organization/agent/session.');
    }

    if (segments[0] !== org.slug) {
      throw new APIError(403, 'wrong_organization', 'Address belongs to another Organization.');
    }

    const sessionCondition = segments.length === 3
      ? 's.handle = ? COLLATE NOCASE'
      : 's.is_default = 1';

    const statement = this.db.prepare(
      `${IdentityService.SESSION_SELECT}
       WHERE a.org_id = ? AND a.handle = ? COLLATE NOCASE
         AND ${sessionCondition} AND a.archived_at IS NULL AND s.archived_at IS NULL`,
    );

    const row = segments.length === 3
      ? await statement.bind(org.id, segments[1], segments[2]).first<SessionRow>()
      : await statement.bind(org.id, segments[1]).first<SessionRow>();

    if (!row) {
      throw new APIError(404, 'session_not_found', 'Agent or Session address not found.');
    }

    return IdentityService.publicSession(org.slug, row);
  }

  async resume(
    accountID: string,
    sessionID: string,
    resumeToken: string,
    runtimeLabel: string | null,
  ): Promise<ResumedIdentity> {
    const org = await this.organization(accountID);
    const session = await this.requireSession(org.id, sessionID);
    const tokenHash = await TokenService.sha256Hex(resumeToken);
    const valid = await this.db.prepare(
      'SELECT id FROM agent_sessions WHERE id = ? AND resume_token_hash = ? AND archived_at IS NULL',
    ).bind(sessionID, tokenHash).first<{ id: string }>();

    if (!valid) {
      throw new APIError(403, 'invalid_resume_token', 'Resume credential does not match the Session.');
    }

    const lease = await this.leases.resume(sessionID, runtimeLabel);

    return {
      session: IdentityService.publicSession(org.slug, session),
      runtimeToken: lease.runtimeToken,
      leaseExpiresAt: lease.expiresAt,
    };
  }

  async renew(accountID: string, sessionID: string, runtimeToken: string): Promise<{ expiresAt: string }> {
    const org = await this.organization(accountID);
    await this.requireSession(org.id, sessionID);

    return this.leases.renew(sessionID, runtimeToken);
  }

  async release(accountID: string, sessionID: string, runtimeToken: string): Promise<PublicSession> {
    const org = await this.organization(accountID);
    const session = await this.requireSession(org.id, sessionID);
    await this.leases.release(sessionID, runtimeToken);

    return IdentityService.publicSession(org.slug, session);
  }
}
