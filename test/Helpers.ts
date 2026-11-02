import { exports } from 'cloudflare:workers';

export type APIResult = { status: number; body: any };

type CallOptions = { token?: string; body?: unknown; headers?: Record<string, string> };

export class TestClient {
  static readonly ORIGIN = 'https://address.test';
  static readonly REGISTRATION_KEY = 'test-registration-key';

  private static uniqueCounter = 0;

  static uniqueName(prefix: string): string {
    TestClient.uniqueCounter += 1;

    return `${prefix}${Date.now().toString(36)}${TestClient.uniqueCounter}`;
  }

  async call(method: string, path: string, options: CallOptions = {}): Promise<APIResult> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
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

  async createOrganization(slug: string): Promise<string> {
    const result = await this.call('POST', '/v1/orgs', {
      headers: { 'x-registration-key': TestClient.REGISTRATION_KEY },
      body: { slug, displayName: slug },
    });
    return result.body.data.orgToken;
  }

  async createHost(slug: string, orgToken: string, handle: string): Promise<{ id: string; token: string }> {
    const result = await this.call('POST', `/v1/orgs/${slug}/addresses`, { token: orgToken, body: { handle } });
    return { id: result.body.data.address.id, token: result.body.data.addressToken };
  }

  async createChild(host: { id: string; token: string }, handle: string): Promise<APIResult> {
    return this.call('POST', `/v1/addresses/${host.id}/children`, { token: host.token, body: { handle } });
  }
}
