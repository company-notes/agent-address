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
  defaultSessionID: string;
  defaultSessionHandle: string;
};

export type Session = {
  id: string;
  agentId: string;
  canonical: string;
  handle: string;
  displayName: string | null;
  isDefault: boolean;
};

export type IdentityClaim = {
  session: Session;
  resumeToken: string;
  runtimeToken: string;
  leaseExpiresAt: string;
};

type APIResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// Portal is a browser client of the same OAuth-backed HTTP API as MCP.
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

  static agents(): Promise<Agent[]> {
    return this.request('GET', '/agents');
  }

  static createAgent(agentName: string, sessionName: string): Promise<IdentityClaim> {
    return this.request('POST', '/agents', {
      ...(agentName ? { agentName } : {}),
      ...(sessionName ? { sessionName } : {}),
    });
  }

  static sessions(agentID: string): Promise<Session[]> {
    return this.request('GET', '/agents/' + encodeURIComponent(agentID) + '/sessions');
  }

  static createSession(agentID: string, sessionName: string): Promise<IdentityClaim> {
    return this.request('POST', '/agents/' + encodeURIComponent(agentID) + '/sessions', {
      ...(sessionName ? { sessionName } : {}),
    });
  }
}
