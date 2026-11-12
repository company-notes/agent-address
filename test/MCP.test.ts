import { exports } from 'cloudflare:workers';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

type ToolResult = { isError: boolean; text: string; data: any };

class MCPTestSession {
  private readonly client = new Client({ name: 'identity-flow', version: '1.0.0' });

  static async connect(accessToken: string): Promise<MCPTestSession> {
    const session = new MCPTestSession();
    const transport = new StreamableHTTPClientTransport(
      new URL(`${TestClient.ORIGIN}/mcp`),
      {
        requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
        fetch: (input, init) => exports.default.fetch(new Request(input as string | URL, init)),
      },
    );

    await session.client.connect(transport);

    return session;
  }

  async listToolNames(): Promise<string[]> {
    return (await this.client.listTools()).tools.map((tool) => tool.name);
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const response = await this.client.callTool({ name, arguments: args });
    const text = (response.content as { text: string }[])[0].text;
    const isError = Boolean(response.isError);

    return {
      isError,
      text,
      data: isError ? null : JSON.parse(text),
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

describe('real MCP client authenticates through OAuth and uses the shared API', () => {
  it('registers an Organization, claims a named Agent and resolves the default Session', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const session = await MCPTestSession.connect(accessToken);
    const slug = TestClient.uniqueName('mcp');

    expect(await session.listToolNames()).toEqual(expect.arrayContaining([
      'agentAddressGetStatus',
      'agentAddressRegisterOrganization',
      'agentAddressClaimAgent',
      'agentAddressCreateSession',
      'agentAddressResumeSession',
      'agentAddressHeartbeatRuntime',
      'agentAddressReleaseRuntime',
      'agentAddressResolve',
      'agentAddressListAgents',
      'agentAddressListSessions',
    ]));

    const original = await session.call('agentAddressGetStatus');
    expect(original.data.organization).toBeNull();

    const organization = await session.call('agentAddressRegisterOrganization', { slug, displayName: 'Team' });
    expect(organization.isError).toBe(false);

    const claimed = await session.call('agentAddressClaimAgent', {
      agentName: 'xiaoming',
      sessionName: 'main',
    });
    expect(claimed.isError).toBe(false);
    expect(claimed.data.session.canonical).toBe(`${slug}/xiaoming/main`);

    const status = await session.call('agentAddressGetStatus');
    expect(status.data.session.canonical).toBe(`${slug}/xiaoming/main`);

    const resolved = await session.call('agentAddressResolve', { address: `${slug}/xiaoming` });
    expect(resolved.data.id).toBe(claimed.data.session.id);

    const renewed = await session.call('agentAddressHeartbeatRuntime');
    expect(renewed.isError).toBe(false);
    expect(renewed.data.expiresAt).toBeTruthy();

    const duplicate = await session.call('agentAddressClaimAgent', { agentName: 'other' });
    expect(duplicate.isError).toBe(true);

    const released = await session.call('agentAddressReleaseRuntime');
    expect(released.data.released).toBe(true);

    await session.close();
  });

  it('provides distinct Agent identities for independent runtime connections', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const client = new TestClient();
    const slug = TestClient.uniqueName('distinct');
    await client.registerOrganization(accessToken, slug);

    const first = await MCPTestSession.connect(accessToken);
    const second = await MCPTestSession.connect(accessToken);
    const a = await first.call('agentAddressClaimAgent', { sessionName: 'ffl-dev' });
    const b = await second.call('agentAddressClaimAgent', { sessionName: 'ffl-dev-mac' });

    expect(a.data.session.agentId).not.toBe(b.data.session.agentId);
    expect(a.data.session.canonical).toMatch(new RegExp(`^${slug}/agent-[a-f0-9]{8}/ffl-dev$`));
    expect(b.data.session.canonical).toContain('/ffl-dev-mac');

    await first.close();
    await second.close();
  });
});
