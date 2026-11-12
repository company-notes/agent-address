import { exports } from 'cloudflare:workers';

export type APIResult = { status: number; body: any };
type CallOptions = { token?: string; body?: unknown; headers?: Record<string, string> };

// Real Worker HTTP calls, including real OAuth authorization and D1 access.
export class TestClient {
  static readonly ORIGIN = 'https://address.test';
  static readonly REGISTRATION_KEY = 'test-registration-key';

  private static uniqueCounter = 0;

  static uniqueName(prefix: string): string {
    this.uniqueCounter += 1;

    return `${prefix}${Date.now().toString(36)}${this.uniqueCounter}`;
  }

  async call(method: string, path: string, options: CallOptions = {}): Promise<APIResult> {
    const headers: Record<string, string> = { ...options.headers };

    if (options.token) {
      headers.authorization = `Bearer ${options.token}`;
    }

    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const response = await exports.default.fetch(
      new Request(`${TestClient.ORIGIN}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    );

    return { status: response.status, body: await response.json() };
  }

  async registerOrganization(token: string, slug: string): Promise<APIResult> {
    return this.call('POST', '/v2/account/organization', {
      token,
      body: { slug, displayName: slug },
    });
  }

  async createAgent(token: string, agentName?: string, sessionName?: string): Promise<APIResult> {
    return this.call('POST', '/v2/account/agents', {
      token,
      body: { agentName, sessionName },
    });
  }
}
