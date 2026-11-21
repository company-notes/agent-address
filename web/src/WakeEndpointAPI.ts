import { PortalOAuth } from './PortalOAuth';

export type WakeEndpoint = {
  sessionID: string;
  enabled: boolean;
  callbackHost: string;
  authMode: string;
};

type RelayResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** Account-owned Wake endpoint changes use the Portal's existing OAuth grant. */
export class WakeEndpointAPI {
  private static readonly base = 'https://agent-relay.company-notes.com/v2/account-wake/sessions/';

  private static async request(method: 'GET' | 'PUT', sessionID: string, callbackUrl?: string):
      Promise<WakeEndpoint> {
    const token = PortalOAuth.getToken();

    if (!token) {
      throw new Error('Sign in to Agent Address before editing a Wake URL.');
    }

    const response = await fetch(
      this.base + encodeURIComponent(sessionID) + '/endpoint', {
        method,
        cache: 'no-store',
        headers: {
          authorization: 'Bearer ' + token,
          ...(callbackUrl === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(callbackUrl === undefined ? {} : { body: JSON.stringify({ callbackUrl }) }),
      },
    );
    const result = await response.json() as RelayResponse<WakeEndpoint>;

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return result.data;
  }

  static get(sessionID: string): Promise<WakeEndpoint> {
    return this.request('GET', sessionID);
  }

  static update(sessionID: string, callbackUrl: string): Promise<WakeEndpoint> {
    return this.request('PUT', sessionID, callbackUrl.trim());
  }
}
