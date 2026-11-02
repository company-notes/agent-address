import { exports } from 'cloudflare:workers';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

type ToolResult = { isError: boolean; text: string; data: any };

class MCPTestSession {
  private readonly client = new Client({ name: 'test', version: '1.0.0' });

  static async connect(accessToken: string): Promise<MCPTestSession> {
    const session = new MCPTestSession();
    const transport = new StreamableHTTPClientTransport(new URL(`${TestClient.ORIGIN}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
      fetch: (input, init) => exports.default.fetch(new Request(input as string | URL, init)),
    });
    await session.client.connect(transport);
    return session;
  }

  async listToolNames(): Promise<string[]> {
    return (await this.client.listTools()).tools.map((tool) => tool.name);
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const result = await this.client.callTool({ name, arguments: args });
    const text = (result.content as { text: string }[])[0].text;
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { isError: Boolean(result.isError), text, data };
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

describe('remote MCP over OAuth', () => {
  it('exposes the session naming tools to an authenticated account', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const session = await MCPTestSession.connect(accessToken);
    expect(await session.listToolNames()).toEqual(
      expect.arrayContaining([
        'agentAddressGetStatus',
        'agentAddressClaimWork',
        'agentAddressRenameWork',
        'agentAddressReleaseWork',
        'agentAddressResolve',
        'agentAddressInstallLocal',
      ]),
    );
    await session.close();
  });

  it('registers the organization and names the session in one call', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const session = await MCPTestSession.connect(accessToken);
    const slug = TestClient.uniqueName('org');

    const before = await session.call('agentAddressGetStatus');
    expect(before.data.organization).toBeNull();

    const claimed = await session.call('agentAddressClaimWork', { organization: slug, host: 'mypc', handle: 'build-release' });
    expect(claimed.isError).toBe(false);
    expect(claimed.data.message).toBe(`This session is now ${slug}/@mypc/build-release.`);

    const status = await session.call('agentAddressGetStatus');
    expect(status.data.organization.slug).toBe(slug);
    expect(status.data.work.address).toBe('@mypc/build-release');

    await session.close();
  });

  it('assigns a temporary name and never needs the organization again', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const first = await MCPTestSession.connect(accessToken);
    const slug = TestClient.uniqueName('org');
    await first.call('agentAddressClaimWork', { organization: slug, host: 'mypc', handle: 'first' });

    const second = await MCPTestSession.connect(accessToken);
    const claimed = await second.call('agentAddressClaimWork', {});
    expect(claimed.isError).toBe(false);
    expect(claimed.data.workAddress.canonical).toMatch(new RegExp(`^${slug}/mypc/session-[0-9a-f]{6}$`));

    await first.close();
    await second.close();
  });

  it('keeps one name per session and supports rename and release', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const session = await MCPTestSession.connect(accessToken);
    await session.call('agentAddressClaimWork', { organization: TestClient.uniqueName('org'), host: 'mypc', handle: 'job' });

    expect((await session.call('agentAddressClaimWork', { handle: 'again' })).isError).toBe(true);

    const renamed = await session.call('agentAddressRenameWork', { handle: 'job-2' });
    expect(renamed.data.workAddress.path).toBe('mypc/job-2');

    const released = await session.call('agentAddressReleaseWork');
    expect(released.data.released).toBe(true);
    expect((await session.call('agentAddressReleaseWork')).isError).toBe(true);

    const reclaimed = await session.call('agentAddressClaimWork', { handle: 'job-2' });
    expect(reclaimed.isError).toBe(false);

    await session.close();
  });

  it('reports a helpful error when the machine is ambiguous', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const session = await MCPTestSession.connect(accessToken);
    const result = await session.call('agentAddressClaimWork', { organization: TestClient.uniqueName('org') });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Which machine');
    await session.close();
  });

  it('isolates accounts from each other', async () => {
    const owner = await OAuthTestFlow.signUpAndGetToken();
    const stranger = await OAuthTestFlow.signUpAndGetToken();
    const ownerSession = await MCPTestSession.connect(owner.accessToken);
    const strangerSession = await MCPTestSession.connect(stranger.accessToken);

    const slug = TestClient.uniqueName('org');
    await ownerSession.call('agentAddressClaimWork', { organization: slug, host: 'mypc', handle: 'secret' });

    const status = await strangerSession.call('agentAddressGetStatus');
    expect(status.data.organization).toBeNull();
    expect((await strangerSession.call('agentAddressRenameWork', { handle: 'x' })).isError).toBe(true);

    await ownerSession.close();
    await strangerSession.close();
  });

  it('prepares a local install whose code enrolls the machine', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const session = await MCPTestSession.connect(accessToken);
    const slug = TestClient.uniqueName('org');
    await session.call('agentAddressClaimWork', { organization: slug, host: 'cloud', handle: 'chat' });

    const install = await session.call('agentAddressInstallLocal', { host: 'mypc' });
    expect(install.isError).toBe(false);
    expect(install.data.instructions).toContain('/v1/enrollments/redeem');

    const redeemed = await new TestClient().call('POST', '/v1/enrollments/redeem', {
      body: { code: install.data.enrollmentCode },
    });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.data.address.canonical).toBe(`${slug}/mypc`);

    await session.close();
  });
});
