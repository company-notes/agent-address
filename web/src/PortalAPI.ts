import { PortalOAuth } from './PortalOAuth';

export type Organization = {
  id: string;
  slug: string;
  displayName: string;
};

export type AccountStatus = {
  account: { email: string };
  organization: Organization | null;
};

export type Agent = {
  id: string;
  handle: string;
  displayName: string | null;
  defaultSessionID: string | null;
  defaultSessionHandle: string | null;
};

export type Session = {
  id: string;
  agentId: string;
  canonical: string;
  handle: string;
  displayName: string | null;
  isDefault: boolean;
  runtime: { label: string | null; expiresAt: string } | null;
};

export type IdentityRegistration = {
  session: Session;
  resumeToken: string;
};

export type AgentChanges = {
  agentName?: string;
  agentDisplayName?: string | null;
};

export type SessionChanges = {
  sessionName?: string;
  sessionDisplayName?: string | null;
};

type APIResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// The Portal uses the account's OAuth grant, not a second login or admin privilege.
export class PortalAPI {
  private static async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = PortalOAuth.getToken();
    if (!token) {
      throw new Error('Sign in before managing your Organization.');
    }

    const response = await fetch('/v2/account' + path, {
      method,
      cache: 'no-store',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json() as APIResult<T>;

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return result.data;
  }

  static status(): Promise<AccountStatus> {
    return this.request('GET', '/status');
  }

  static registerOrganization(slug: string, displayName: string): Promise<Organization> {
    return this.request('POST', '/organization', { slug, displayName });
  }

  static updateOrganization(fields: { slug: string; displayName: string }): Promise<Organization> {
    return this.request('PATCH', '/organization', fields);
  }

  static agents(): Promise<Agent[]> {
    return this.request('GET', '/agents');
  }

  static createAgent(
    agentName: string,
    sessionName: string,
    agentDisplayName: string,
    sessionDisplayName: string,
  ): Promise<IdentityRegistration> {
    return this.request('POST', '/agents', {
      ...(agentName ? { agentName } : {}),
      ...(sessionName ? { sessionName } : {}),
      ...(agentDisplayName ? { agentDisplayName } : {}),
      ...(sessionDisplayName ? { sessionDisplayName } : {}),
    });
  }

  static updateAgent(agentID: string, changes: AgentChanges): Promise<Agent> {
    return this.request('PATCH', '/agents/' + encodeURIComponent(agentID), changes);
  }

  static archiveAgent(agentID: string): Promise<{ id: string; archived: true }> {
    return this.request('DELETE', '/agents/' + encodeURIComponent(agentID));
  }

  static sessions(agentID: string): Promise<Session[]> {
    return this.request('GET', '/agents/' + encodeURIComponent(agentID) + '/sessions');
  }

  static createSession(
    agentID: string,
    sessionName: string,
    sessionDisplayName: string,
  ): Promise<IdentityRegistration> {
    return this.request('POST', '/agents/' + encodeURIComponent(agentID) + '/sessions', {
      ...(sessionName ? { sessionName } : {}),
      ...(sessionDisplayName ? { sessionDisplayName } : {}),
    });
  }

  static getSession(sessionID: string): Promise<Session> {
    return this.request('GET', '/sessions/' + encodeURIComponent(sessionID));
  }

  static updateSession(sessionID: string, changes: SessionChanges): Promise<Session> {
    return this.request('PATCH', '/sessions/' + encodeURIComponent(sessionID), changes);
  }

  static setDefaultSession(sessionID: string): Promise<Session> {
    return this.request('PUT', '/sessions/' + encodeURIComponent(sessionID) + '/default-selection');
  }

  static archiveSession(sessionID: string): Promise<{ id: string; archived: true }> {
    return this.request('DELETE', '/sessions/' + encodeURIComponent(sessionID));
  }

  static rotateResumeToken(sessionID: string): Promise<{ resumeToken: string }> {
    return this.request('PUT', '/sessions/' + encodeURIComponent(sessionID) + '/resume-credential');
  }
}
