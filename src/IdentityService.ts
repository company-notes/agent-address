import { ApplicationError } from './ApplicationError';
import { IdentityNames } from './IdentityNames';
import { OrganizationRow, OrganizationService } from './Organizations';
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
  runtimeLabel: string | null;
  leaseExpiresAt: string | null;
};

export type AgentChanges = {
  agentName?: string;
  agentDisplayName?: string | null;
};

export type SessionChanges = {
  sessionName?: string;
  sessionDisplayName?: string | null;
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
  runtime: { label: string | null; expiresAt: string } | null;
};

export type RegisteredIdentity = {
  session: PublicSession;
  resumeToken: string;
};

export type ClaimedIdentity = RegisteredIdentity & {
  runtimeToken: string;
  leaseExpiresAt: string;
};

export type ResumedIdentity = {
  session: PublicSession;
  runtimeToken: string;
  leaseExpiresAt: string;
  renewed?: true;
};

type PreparedIdentity = RegisteredIdentity & {
  statements: D1PreparedStatement[];
};

export class IdentityService {
  private static readonly AGENT_SELECT = `
    SELECT a.id, a.org_id AS orgId, a.handle, a.display_name AS displayName,
           a.created_at AS createdAt,
           s.id AS defaultSessionID, s.handle AS defaultSessionHandle
      FROM agents a
      LEFT JOIN sessions s ON s.agent_id = a.id
           AND s.is_default = 1 AND s.archived_at IS NULL
  `;

  private static readonly SESSION_SELECT = `
    SELECT s.id, s.agent_id AS agentId, a.handle AS agentHandle,
           a.display_name AS agentDisplayName, s.handle AS sessionHandle,
           s.display_name AS sessionDisplayName, s.is_default AS isDefault,
           s.created_at AS createdAt,
           l.runtime_label AS runtimeLabel, l.expires_at AS leaseExpiresAt
      FROM sessions s
      JOIN agents a ON a.id = s.agent_id
      LEFT JOIN session_runtime_leases l ON l.session_id = s.id
  `;

  constructor(
    private readonly db: D1Database,
    private readonly organizations: OrganizationService,
    private readonly leases: RuntimeLeaseService,
  ) {}

  private static newHandle(prefix: string): string {
    return prefix + '-' + crypto.randomUUID().slice(0, 8);
  }

  private static handle(value: string | undefined, prefix: string): string {
    return IdentityNames.handle(value ?? this.newHandle(prefix));
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
      runtime: row.leaseExpiresAt && row.leaseExpiresAt > new Date().toISOString()
        ? { label: row.runtimeLabel, expiresAt: row.leaseExpiresAt }
        : null,
    };
  }

  private static duplicateName(error: unknown): never {
    if (String(error).includes('UNIQUE constraint failed')) {
      console.debug('Agent or Session handle collision:', error);

      throw new ApplicationError(409, 'identity_name_taken', 'That Agent or Session name is already in use.');
    }

    throw error;
  }

  private organization(accountID: string): Promise<OrganizationRow> {
    return this.organizations.getForAccount(accountID);
  }

  private async requireAgent(orgID: string, agentID: string): Promise<AgentRow> {
    const agent = await this.db.prepare(
      `${IdentityService.AGENT_SELECT}
       WHERE a.org_id = ? AND a.id = ? AND a.archived_at IS NULL`,
    ).bind(orgID, agentID).first<AgentRow>();

    if (!agent) {
      throw new ApplicationError(404, 'agent_not_found', 'Agent not found in your Organization.');
    }

    return agent;
  }

  private static requireSessionRow(session: SessionRow | null | undefined): SessionRow {
    if (!session) {
      throw new ApplicationError(404, 'session_not_found', 'Session not found in your Organization.');
    }

    return session;
  }

  private sessionStatement(orgID: string, sessionID: string): D1PreparedStatement {
    return this.db.prepare(
      `${IdentityService.SESSION_SELECT}
       WHERE a.org_id = ? AND s.id = ?
         AND a.archived_at IS NULL AND s.archived_at IS NULL`,
    ).bind(orgID, sessionID);
  }

  private async requireSession(orgID: string, sessionID: string): Promise<SessionRow> {
    return IdentityService.requireSessionRow(
      await this.sessionStatement(orgID, sessionID).first<SessionRow>(),
    );
  }

  private async prepareAgent(accountID: string, input: NewAgentInput): Promise<PreparedIdentity> {
    const org = await this.organization(accountID);
    const agentID = crypto.randomUUID();
    const sessionID = crypto.randomUUID();
    const agentHandle = IdentityService.handle(input.agentName, 'agent');
    const sessionHandle = IdentityNames.handle(input.sessionName ?? 'main');
    const createdAt = new Date().toISOString();

    const resumeToken = TokenService.randomToken('resume');
    const resumeHash = await TokenService.sha256Hex(resumeToken);

    const insertAgent = this.db.prepare(
      `INSERT INTO agents (id, org_id, handle, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(agentID, org.id, agentHandle, input.agentDisplayName ?? null, createdAt);

    const insertSession = this.db.prepare(
      `INSERT INTO sessions
         (id, agent_id, handle, display_name, is_default, resume_token_hash, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(sessionID, agentID, sessionHandle, input.sessionDisplayName ?? null, resumeHash, createdAt);

    const row: SessionRow = {
      id: sessionID,
      agentId: agentID,
      agentHandle,
      agentDisplayName: input.agentDisplayName ?? null,
      sessionHandle,
      sessionDisplayName: input.sessionDisplayName ?? null,
      isDefault: 1,
      createdAt,
      runtimeLabel: null,
      leaseExpiresAt: null,
    };

    return {
      session: IdentityService.publicSession(org.slug, row),
      resumeToken,
      statements: [insertAgent, insertSession],
    };
  }

  private async prepareSession(
    accountID: string,
    agentID: string,
    input: NewSessionInput,
  ): Promise<PreparedIdentity> {
    const org = await this.organization(accountID);
    const agent = await this.requireAgent(org.id, agentID);
    const sessionID = crypto.randomUUID();
    const handle = IdentityService.handle(input.sessionName, 'session');

    const resumeToken = TokenService.randomToken('resume');
    const resumeHash = await TokenService.sha256Hex(resumeToken);

    const createdAt = new Date().toISOString();

    const statement = this.db.prepare(
      `INSERT INTO sessions
         (id, agent_id, handle, display_name, is_default, resume_token_hash, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).bind(sessionID, agentID, handle, input.sessionDisplayName ?? null, resumeHash, createdAt);

    const row: SessionRow = {
      id: sessionID,
      agentId: agent.id,
      agentHandle: agent.handle,
      agentDisplayName: agent.displayName,
      sessionHandle: handle,
      sessionDisplayName: input.sessionDisplayName ?? null,
      isDefault: 0,
      createdAt,
      runtimeLabel: null,
      leaseExpiresAt: null,
    };

    return {
      session: IdentityService.publicSession(org.slug, row),
      resumeToken,
      statements: [statement],
    };
  }

  private async register(prepared: PreparedIdentity): Promise<RegisteredIdentity> {
    try {
      await this.db.batch(prepared.statements);
    } catch (error) {
      IdentityService.duplicateName(error);
    }

    return { session: prepared.session, resumeToken: prepared.resumeToken };
  }

  private async claim(prepared: PreparedIdentity, runtimeLabel: string | null): Promise<ClaimedIdentity> {
    const lease = await this.leases.prepareInitialLease(prepared.session.id, runtimeLabel);

    try {
      await this.db.batch([...prepared.statements, lease.statement]);
    } catch (error) {
      IdentityService.duplicateName(error);
    }

    return {
      session: {
        ...prepared.session,
        runtime: { label: runtimeLabel, expiresAt: lease.expiresAt },
      },
      resumeToken: prepared.resumeToken,
      runtimeToken: lease.runtimeToken,
      leaseExpiresAt: lease.expiresAt,
    };
  }

  /**
   * Organization-owned Bot enrollment is idempotent by immutable registration ID.
   * The regular self-managed claim/Resume routes still own Runtime capabilities.
   */
  async registerOfficeAgent(
    accountID: string, registrationID: string, input: NewAgentInput,
  ): Promise<{ session: PublicSession }> {
    const org = await this.organization(accountID);
    const agentHandle = IdentityNames.handle(input.agentName!);
    const sessionHandle = IdentityNames.handle(input.sessionName ?? 'main');

    const existing = await this.db.prepare(
      `SELECT agent_id AS agentID, session_id AS sessionID,
              agent_handle AS agentHandle, agent_display_name AS agentDisplayName,
              session_handle AS sessionHandle
         FROM agent_registration_requests
        WHERE org_id = ? AND registration_id = ?`,
    ).bind(org.id, registrationID).first<{
      agentID: string; sessionID: string; agentHandle: string;
      agentDisplayName: string; sessionHandle: string;
    }>();

    if (existing) {
      if (existing.agentHandle !== agentHandle ||
          existing.agentDisplayName !== input.agentDisplayName ||
          existing.sessionHandle !== sessionHandle) {
        throw new ApplicationError(409, 'agent_registration_conflict',
          'An office registration ID already belongs to another identity.');
      }

      const agent = await this.requireAgent(org.id, existing.agentID);
      const session = await this.requireSession(org.id, existing.sessionID);

      if (agent.handle !== agentHandle || agent.displayName !== input.agentDisplayName ||
          session.agentId !== agent.id || session.sessionHandle !== sessionHandle ||
          session.isDefault !== 1) {
        throw new ApplicationError(409, 'agent_registration_conflict',
          'The registered office identity no longer matches its original assignment.');
      }

      return { session: IdentityService.publicSession(org.slug, session) };
    }

    const prepared = await this.prepareAgent(accountID, input);
    const agentID = prepared.session.agentId;
    const sessionID = prepared.session.id;

    try {
      await this.db.batch([
        ...prepared.statements,
        this.db.prepare(
          `INSERT INTO agent_registration_requests
             (org_id, registration_id, agent_id, session_id, agent_handle,
              agent_display_name, session_handle, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(org.id, registrationID, agentID, sessionID, agentHandle,
          input.agentDisplayName!, sessionHandle, new Date().toISOString()),
      ]);
    } catch (error) {
      const winner = await this.db.prepare(
        'SELECT agent_id AS agentID FROM agent_registration_requests WHERE org_id = ? AND registration_id = ?',
      ).bind(org.id, registrationID).first<{ agentID: string }>();

      if (winner) {
        return this.registerOfficeAgent(accountID, registrationID, input);
      }

      IdentityService.duplicateName(error);
    }

    return { session: prepared.session };
  }

  async registerAgent(accountID: string, input: NewAgentInput): Promise<RegisteredIdentity> {
    return this.register(await this.prepareAgent(accountID, input));
  }

  async claimAgent(accountID: string, input: NewAgentInput): Promise<ClaimedIdentity> {
    return this.claim(await this.prepareAgent(accountID, input), input.runtimeLabel ?? null);
  }

  async registerSession(
    accountID: string,
    agentID: string,
    input: NewSessionInput,
  ): Promise<RegisteredIdentity> {
    return this.register(await this.prepareSession(accountID, agentID, input));
  }

  async claimSession(
    accountID: string,
    agentID: string,
    input: NewSessionInput,
  ): Promise<ClaimedIdentity> {
    return this.claim(await this.prepareSession(accountID, agentID, input), input.runtimeLabel ?? null);
  }

  async listAgents(accountID: string): Promise<AgentRow[]> {
    const org = await this.organization(accountID);
    const result = await this.db.prepare(
      `${IdentityService.AGENT_SELECT}
       WHERE a.org_id = ? AND a.archived_at IS NULL
       ORDER BY a.handle COLLATE NOCASE`,
    ).bind(org.id).all<AgentRow>();

    return result.results;
  }

  async listSessions(accountID: string, agentID: string): Promise<PublicSession[]> {
    const org = await this.organization(accountID);
    await this.requireAgent(org.id, agentID);

    const result = await this.db.prepare(
      `${IdentityService.SESSION_SELECT}
       WHERE a.org_id = ? AND a.id = ? AND s.archived_at IS NULL
       ORDER BY s.is_default DESC, s.handle COLLATE NOCASE`,
    ).bind(org.id, agentID).all<SessionRow>();

    return result.results.map((session) => IdentityService.publicSession(org.slug, session));
  }

  async getSession(accountID: string, sessionID: string): Promise<PublicSession> {
    const org = await this.organization(accountID);
    const session = await this.requireSession(org.id, sessionID);

    return IdentityService.publicSession(org.slug, session);
  }

  async resolve(accountID: string, address: string): Promise<PublicSession> {
    const org = await this.organization(accountID);
    const segments = IdentityNames.path(address).split('/');

    if (segments.length !== 2 && segments.length !== 3) {
      throw new ApplicationError(400, 'invalid_address', 'Use organization/agent or organization/agent/session.');
    }

    if (segments[0] !== org.slug) {
      throw new ApplicationError(403, 'wrong_organization', 'Address belongs to another Organization.');
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
      throw new ApplicationError(404, 'session_not_found', 'Agent or Session address not found.');
    }

    return IdentityService.publicSession(org.slug, row);
  }

  async resume(
    accountID: string,
    sessionID: string,
    resumeToken: string,
    runtimeLabel: string | null,
    runtimeToken?: string,
  ): Promise<ResumedIdentity> {
    const org = await this.organization(accountID);
    const tokenHash = await TokenService.sha256Hex(resumeToken);
    const lease = await this.leases.prepareResume(org.id, sessionID, runtimeLabel, tokenHash);
    const renewal = runtimeToken
      ? await this.leases.prepareRenewal(org.id, sessionID, runtimeToken)
      : null;

    // A live matching Runtime wins before idle acquisition; both decisions use
    // the same transaction, including the current Resume credential and scope.
    const [read, valid, acquiredOrRenewed, acquired] = await this.db.batch<SessionRow>([
      this.sessionStatement(org.id, sessionID),
      this.db.prepare(
        'SELECT id FROM sessions WHERE id = ? AND resume_token_hash = ? AND archived_at IS NULL',
      ).bind(sessionID, tokenHash),
      ...(renewal ? [renewal.statement] : []),
      lease.statement,
    ]);
    const session = IdentityService.requireSessionRow(read.results[0]);

    if (renewal && runtimeToken && acquiredOrRenewed.meta.changes === 1) {
      return {
        session: IdentityService.publicSession(org.slug, {
          ...session, leaseExpiresAt: renewal.expiresAt,
        }),
        runtimeToken,
        leaseExpiresAt: renewal.expiresAt,
        renewed: true,
      };
    }

    if (!valid.results.length) {
      throw new ApplicationError(403, 'invalid_resume_token', 'Resume credential does not match the Session.');
    }

    this.leases.requireResumed(acquired ?? acquiredOrRenewed);

    return {
      session: IdentityService.publicSession(org.slug, session),
      runtimeToken: lease.runtimeToken,
      leaseExpiresAt: lease.expiresAt,
    };
  }

  /** Recover an idle Session explicitly selected by its Organization owner. */
  async recoverByOwner(
    accountID: string, sessionID: string, runtimeLabel: string | null,
  ): Promise<ClaimedIdentity> {
    const org = await this.organization(accountID);
    const session = await this.requireSession(org.id, sessionID);
    const lease = await this.leases.resume(org.id, sessionID, runtimeLabel);

    let resumeToken: string;
    try {
      ({ resumeToken } = await this.rotateResumeToken(accountID, sessionID));
    } catch (error) {
      await this.leases.release(sessionID, lease.runtimeToken);
      throw error;
    }

    return {
      session: {
        ...IdentityService.publicSession(org.slug, session),
        runtime: { label: runtimeLabel, expiresAt: lease.expiresAt },
      },
      runtimeToken: lease.runtimeToken,
      resumeToken,
      leaseExpiresAt: lease.expiresAt,
    };
  }

  async renewWithIdentity(accountID: string, sessionID: string, runtimeToken: string) {
    const org = await this.organization(accountID);
    const lease = await this.leases.prepareRenewal(org.id, sessionID, runtimeToken);

    const [read, renewed] = await this.db.batch<SessionRow>([
      this.sessionStatement(org.id, sessionID), lease.statement,
    ]);
    const session = IdentityService.requireSessionRow(read.results[0]);
    this.leases.requireRenewed(renewed);

    return {
      expiresAt: lease.expiresAt,
      organization: { id: org.id, slug: org.slug },
      session: IdentityService.publicSession(org.slug, {
        ...session, leaseExpiresAt: lease.expiresAt,
      }),
    };
  }

  async renew(accountID: string, sessionID: string, runtimeToken: string): Promise<{ expiresAt: string }> {
    const { expiresAt } = await this.renewWithIdentity(accountID, sessionID, runtimeToken);

    return { expiresAt };
  }

  async release(accountID: string, sessionID: string, runtimeToken: string): Promise<PublicSession> {
    const org = await this.organization(accountID);
    const session = await this.requireSession(org.id, sessionID);
    await this.leases.release(sessionID, runtimeToken);

    return IdentityService.publicSession(org.slug, session);
  }

  async updateAgent(accountID: string, agentID: string, changes: AgentChanges): Promise<AgentRow> {
    const org = await this.organization(accountID);
    const original = await this.requireAgent(org.id, agentID);
    const handle = changes.agentName === undefined
      ? original.handle
      : IdentityNames.handle(changes.agentName);
    const displayName = changes.agentDisplayName === undefined
      ? original.displayName
      : changes.agentDisplayName;

    try {
      await this.db.prepare(
        'UPDATE agents SET handle = ?, display_name = ? WHERE id = ? AND org_id = ? AND archived_at IS NULL',
      ).bind(handle, displayName, agentID, org.id).run();
    } catch (error) {
      IdentityService.duplicateName(error);
    }

    return this.requireAgent(org.id, agentID);
  }

  async updateSession(accountID: string, sessionID: string, changes: SessionChanges): Promise<PublicSession> {
    const org = await this.organization(accountID);
    const original = await this.requireSession(org.id, sessionID);
    const handle = changes.sessionName === undefined
      ? original.sessionHandle
      : IdentityNames.handle(changes.sessionName);
    const displayName = changes.sessionDisplayName === undefined
      ? original.sessionDisplayName
      : changes.sessionDisplayName;

    try {
      await this.db.prepare(
        'UPDATE sessions SET handle = ?, display_name = ? WHERE id = ? AND archived_at IS NULL',
      ).bind(handle, displayName, sessionID).run();
    } catch (error) {
      IdentityService.duplicateName(error);
    }

    return this.getSession(accountID, sessionID);
  }

  async setDefaultSession(accountID: string, sessionID: string): Promise<PublicSession> {
    const org = await this.organization(accountID);
    const target = await this.requireSession(org.id, sessionID);

    // D1 batch makes both changes atomic; avoid violating the unique default-session index.
    await this.db.batch([
      this.db.prepare(
        'UPDATE sessions SET is_default = 0 WHERE agent_id = ? AND is_default = 1 AND archived_at IS NULL',
      ).bind(target.agentId),
      this.db.prepare(
        'UPDATE sessions SET is_default = 1 WHERE id = ? AND agent_id = ? AND archived_at IS NULL',
      ).bind(sessionID, target.agentId),
    ]);

    return this.getSession(accountID, sessionID);
  }

  async archiveSession(accountID: string, sessionID: string): Promise<{ id: string; archived: true }> {
    const org = await this.organization(accountID);
    const session = await this.requireSession(org.id, sessionID);

    if (session.isDefault === 1) {
      throw new ApplicationError(
        409,
        'default_session_required',
        'Choose another Default Session before archiving this one, or archive the Agent.',
      );
    }

    const now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare('DELETE FROM session_runtime_leases WHERE session_id = ?').bind(sessionID),
      this.db.prepare(
        'UPDATE sessions SET archived_at = ? WHERE id = ? AND archived_at IS NULL',
      ).bind(now, sessionID),
    ]);

    return { id: sessionID, archived: true };
  }

  async archiveAgent(accountID: string, agentID: string): Promise<{ id: string; archived: true }> {
    const org = await this.organization(accountID);
    await this.requireAgent(org.id, agentID);

    const now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare(
        'DELETE FROM session_runtime_leases WHERE session_id IN (SELECT id FROM sessions WHERE agent_id = ?)',
      ).bind(agentID),
      this.db.prepare(
        'UPDATE sessions SET archived_at = ? WHERE agent_id = ? AND archived_at IS NULL',
      ).bind(now, agentID),
      this.db.prepare(
        'UPDATE agents SET archived_at = ? WHERE id = ? AND org_id = ? AND archived_at IS NULL',
      ).bind(now, agentID, org.id),
    ]);

    return { id: agentID, archived: true };
  }

  async rotateResumeToken(accountID: string, sessionID: string): Promise<{ resumeToken: string }> {
    const org = await this.organization(accountID);
    await this.requireSession(org.id, sessionID);

    const resumeToken = TokenService.randomToken('resume');
    const tokenHash = await TokenService.sha256Hex(resumeToken);
    await this.db.prepare(
      'UPDATE sessions SET resume_token_hash = ? WHERE id = ? AND archived_at IS NULL',
    ).bind(tokenHash, sessionID).run();

    return { resumeToken };
  }

}
