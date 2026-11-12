import { IdentityAPIClient } from './IdentityAPIClient';
import { ClaimedIdentity, PublicSession, ResumedIdentity } from './IdentityService';

type AccountStatus = {
  account: { email: string };
  organization: { id: string; slug: string } | null;
};

export type IdentitySummary = {
  session: PublicSession;
  leaseExpiresAt: string;
  created: boolean;
};

type SavedRuntime = {
  sessionID: string;
  runtimeToken: string;
  resumeToken: string;
  ownerAccountID: string;
};

export class MCPIdentityLifecycle {
  private static readonly SESSION_KEY = 'sessionID';
  private static readonly RUNTIME_KEY = 'runtimeToken';
  private static readonly RESUME_KEY = 'resumeToken';
  private static readonly OWNER_KEY = 'ownerAccountID';

  constructor(
    private readonly api: IdentityAPIClient,
    private readonly storage: DurableObjectStorage,
    private readonly accountID: string,
  ) {}

  private static publicIdentity(
    session: PublicSession, expiresAt: string, created: boolean,
  ): IdentitySummary {
    return {
      session: {
        ...session,
        runtime: { label: session.runtime?.label ?? null, expiresAt },
      },
      leaseExpiresAt: expiresAt,
      created,
    };
  }

  private async saved(): Promise<SavedRuntime | null> {
    const sessionID = await this.storage.get<string>(MCPIdentityLifecycle.SESSION_KEY);

    if (!sessionID) {
      return null;
    }

    const owner = await this.storage.get<string>(MCPIdentityLifecycle.OWNER_KEY);

    if (owner !== this.accountID) {
      throw new Error('Saved Session belongs to another OAuth Account or is incomplete.');
    }

    const runtimeToken = await this.storage.get<string>(MCPIdentityLifecycle.RUNTIME_KEY);
    const resumeToken = await this.storage.get<string>(MCPIdentityLifecycle.RESUME_KEY);

    if (!resumeToken) {
      throw new Error('Saved Session has no private Resume credential.');
    }

    return { sessionID, runtimeToken: runtimeToken ?? '', resumeToken, ownerAccountID: owner };
  }

  private async remember(
    sessionID: string, runtimeToken: string, resumeToken: string,
  ): Promise<void> {
    await this.storage.put({
      [MCPIdentityLifecycle.SESSION_KEY]: sessionID,
      [MCPIdentityLifecycle.RUNTIME_KEY]: runtimeToken,
      [MCPIdentityLifecycle.RESUME_KEY]: resumeToken,
      [MCPIdentityLifecycle.OWNER_KEY]: this.accountID,
    });
  }

  async claim(input: {
    agentName?: string;
    sessionName?: string;
    agentDisplayName?: string;
    sessionDisplayName?: string;
    runtimeLabel?: string;
  } = {}): Promise<IdentitySummary> {
    if (await this.storage.get<string>(MCPIdentityLifecycle.SESSION_KEY)) {
      throw new Error('This MCP connection already owns an Agent Session.');
    }

    const claimed = await this.api.call<ClaimedIdentity>(
      'POST', '/v2/account/agent-runtime-leases', input,
    );
    await this.remember(claimed.session.id, claimed.runtimeToken, claimed.resumeToken);

    return MCPIdentityLifecycle.publicIdentity(claimed.session, claimed.leaseExpiresAt, true);
  }

  async claimSession(
    agentID: string, input: Record<string, unknown>,
  ): Promise<IdentitySummary> {
    if (await this.storage.get<string>(MCPIdentityLifecycle.SESSION_KEY)) {
      throw new Error('Release and forget this Session before selecting another one.');
    }

    const claimed = await this.api.call<ClaimedIdentity>(
      'POST',
      `/v2/account/agents/${encodeURIComponent(agentID)}/session-runtime-leases`,
      input,
    );
    await this.remember(claimed.session.id, claimed.runtimeToken, claimed.resumeToken);

    return MCPIdentityLifecycle.publicIdentity(claimed.session, claimed.leaseExpiresAt, true);
  }

  private async existing(saved: SavedRuntime): Promise<IdentitySummary> {
    const session = await this.api.call<PublicSession>(
      'GET', `/v2/account/sessions/${encodeURIComponent(saved.sessionID)}`,
    );
    const expiry = session.runtime?.expiresAt;

    if (expiry && Date.parse(expiry) > Date.now()) {
      if (!saved.runtimeToken) {
        throw new Error('Session is held by another Runtime; wait for the Lease to expire.');
      }

      const lease = await this.api.call<{ expiresAt: string }>(
        'PATCH', `/v2/account/sessions/${encodeURIComponent(saved.sessionID)}/runtime-lease`,
        { runtimeToken: saved.runtimeToken },
      );

      return MCPIdentityLifecycle.publicIdentity(session, lease.expiresAt, false);
    }

    const resumed = await this.api.call<ResumedIdentity>(
      'PUT', `/v2/account/sessions/${encodeURIComponent(saved.sessionID)}/runtime-lease`,
      { resumeToken: saved.resumeToken },
    );
    await this.remember(saved.sessionID, resumed.runtimeToken, saved.resumeToken);

    return MCPIdentityLifecycle.publicIdentity(
      resumed.session, resumed.leaseExpiresAt, false,
    );
  }

  async ensure(agentDisplayName?: string): Promise<IdentitySummary> {
    const saved = await this.saved();

    if (saved) {
      return this.existing(saved);
    }

    const status = await this.api.call<AccountStatus>('GET', '/v2/account/status');

    if (!status.organization) {
      await this.api.call('POST', '/v2/account/organization', {
        slug: 'personal-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
        displayName: 'Personal Workspace',
      });
    }

    return this.claim(agentDisplayName ? { agentDisplayName } : {});
  }

  async resume(): Promise<IdentitySummary> {
    const saved = await this.saved();

    if (!saved) {
      throw new Error('No private Session Resume credential for this MCP connection.');
    }

    return this.existing(saved);
  }

  async heartbeat(): Promise<{ expiresAt: string }> {
    const saved = await this.saved();

    if (!saved?.runtimeToken) {
      throw new Error('This MCP connection has no active Session Runtime.');
    }

    return this.api.call<{ expiresAt: string }>(
      'PATCH', `/v2/account/sessions/${encodeURIComponent(saved.sessionID)}/runtime-lease`,
      { runtimeToken: saved.runtimeToken },
    );
  }

  async release(): Promise<{ released: true; canonical: string }> {
    const saved = await this.saved();

    if (!saved?.runtimeToken) {
      throw new Error('This MCP connection has no active Session Runtime.');
    }

    const session = await this.api.call<PublicSession>(
      'DELETE', `/v2/account/sessions/${encodeURIComponent(saved.sessionID)}/runtime-lease`,
      { runtimeToken: saved.runtimeToken },
    );
    await this.storage.delete(MCPIdentityLifecycle.RUNTIME_KEY);

    return { released: true, canonical: session.canonical };
  }

  async forget(): Promise<{ detached: true }> {
    const saved = await this.saved();

    if (!saved) {
      throw new Error('No saved Session to forget.');
    }

    await this.storage.delete([
      MCPIdentityLifecycle.SESSION_KEY,
      MCPIdentityLifecycle.RUNTIME_KEY,
      MCPIdentityLifecycle.RESUME_KEY,
      MCPIdentityLifecycle.OWNER_KEY,
    ]);

    return { detached: true };
  }

  async current(): Promise<PublicSession | null> {
    const saved = await this.saved();

    return saved
      ? this.api.call<PublicSession>(
        'GET', `/v2/account/sessions/${encodeURIComponent(saved.sessionID)}`,
      )
      : null;
  }
}
