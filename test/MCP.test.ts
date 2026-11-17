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

  async listToolDefinitions() {
    return (await this.client.listTools()).tools;
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
      'agentAddressEnsureIdentity',
      'agentAddressGetStatus',
      'agentAddressRegisterOrganization',
      'agentAddressClaimAgent',
      'agentAddressCreateSession',
      'agentAddressResumeSession',
      'agentAddressSelectSession',
      'agentAddressHeartbeatRuntime',
      'agentAddressReleaseRuntime',
      'agentAddressForgetLocalSession',
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

  it('resumes an existing Session by its complete canonical address after release', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('resume');
    const api = new TestClient();
    await api.registerOrganization(accessToken, slug);
    const session = await MCPTestSession.connect(accessToken);

    const first = await session.call('agentAddressClaimAgent', {
      agentName: 'coder',
      sessionName: 'ffl-dev',
    });
    expect(first.isError).toBe(false);
    await session.call('agentAddressReleaseRuntime');

    const resumed = await session.call('agentAddressResumeSession');
    expect(resumed.isError).toBe(false);
    expect(resumed.data.session.id).toBe(first.data.session.id);
    expect(resumed.text).not.toMatch(/runtimeToken|resumeToken|runtime_|resume_/);

    await session.call('agentAddressReleaseRuntime');
    await session.close();
  });

  it('lets a new Codex connection select an idle existing address without changing identity', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const api = new TestClient();
    const slug = TestClient.uniqueName('select');
    await api.registerOrganization(accessToken, slug);

    const original = await MCPTestSession.connect(accessToken);
    const replacement = await MCPTestSession.connect(accessToken);
    const old = await original.call('agentAddressClaimAgent', {
      agentName: 'codex-win', sessionName: 'ffl',
    });
    const fresh = await replacement.call('agentAddressEnsureIdentity');

    const busy = await replacement.call('agentAddressSelectSession', {
      address: `${slug}/codex-win/ffl`,
    });
    expect(busy.isError).toBe(true);
    expect((await replacement.call('agentAddressGetStatus')).data.session.id)
      .toBe(fresh.data.session.id);

    await original.call('agentAddressReleaseRuntime');

    const selected = await replacement.call('agentAddressSelectSession', {
      address: `${slug}/codex-win/ffl`,
    });
    expect(selected.isError).toBe(false);
    expect(selected.data.session.id).toBe(old.data.session.id);
    expect(selected.data.session.agentId).toBe(old.data.session.agentId);
    expect(selected.text).not.toMatch(/runtimeToken|resumeToken|runtime_|resume_/);

    const ensured = await replacement.call('agentAddressEnsureIdentity');
    expect(ensured.data.session.id).toBe(old.data.session.id);

    await replacement.close();
    await original.close();
  });

  it('recovers when the Portal archives the current Agent during an active MCP connection', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const api = new TestClient();
    await api.registerOrganization(accessToken, TestClient.uniqueName('revoked'));
    const session = await MCPTestSession.connect(accessToken);

    const original = await session.call('agentAddressClaimAgent', {
      agentName: 'old-agent',
      sessionName: 'main',
    });
    expect(original.isError).toBe(false);

    const archived = await api.call('DELETE', `/v2/account/agents/${original.data.session.agentId}`, {
      token: accessToken,
    });
    expect(archived.status).toBe(200);

    const stale = await session.call('agentAddressHeartbeatRuntime');
    expect(stale.isError).toBe(true);

    const cleared = await session.call('agentAddressForgetLocalSession');
    expect(cleared.isError).toBe(false);
    expect(cleared.data.detached).toBe(true);

    const next = await session.call('agentAddressClaimAgent', { agentName: 'new-agent' });
    expect(next.isError).toBe(false);
    expect(next.data.session.agentId).not.toBe(original.data.session.agentId);

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
  it('auto-claims a persona address after OAuth without prompting for Organization or secrets', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const session = await MCPTestSession.connect(accessToken);

    const created = await session.call('agentAddressEnsureIdentity', {
      agentDisplayName: '小晴',
    });

    expect(created.isError).toBe(false);
    expect(created.data.session.canonical).toMatch(
      /^personal-[a-f0-9]{12}\/agent-[a-f0-9]{8}\/main$/,
    );
    expect(created.text).not.toMatch(/runtimeToken|resumeToken|runtime_|resume_/);
    expect(created.data.created).toBe(true);

    const again = await session.call('agentAddressEnsureIdentity');

    expect(again.isError).toBe(false);
    expect(again.data.created).toBe(false);
    expect(again.data.session.id).toBe(created.data.session.id);
    expect(again.data.session.canonical).toBe(created.data.session.canonical);

    const agents = await session.call('agentAddressListAgents');
    expect(agents.data).toHaveLength(1);
    expect(agents.data[0].displayName).toBe('小晴');

    const released = await session.call('agentAddressReleaseRuntime');
    expect(released.isError).toBe(false);

    const restored = await session.call('agentAddressEnsureIdentity');
    expect(restored.isError).toBe(false);
    expect(restored.data.session.id).toBe(created.data.session.id);
    expect(restored.data.session.canonical).toBe(created.data.session.canonical);
    expect(restored.text).not.toMatch(/runtimeToken|resumeToken|runtime_|resume_/);

    await session.close();
  });

  it('keeps independent Agent installations separate under the same OAuth Account', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const first = await MCPTestSession.connect(accessToken);
    const second = await MCPTestSession.connect(accessToken);

    const xiaoqing = await first.call('agentAddressEnsureIdentity', {
      agentDisplayName: '小晴',
    });
    const daxiong = await second.call('agentAddressEnsureIdentity', {
      agentDisplayName: '大熊',
    });

    expect(xiaoqing.isError).toBe(false);
    expect(daxiong.isError).toBe(false);
    expect(xiaoqing.data.session.agentId).not.toBe(daxiong.data.session.agentId);
    expect(xiaoqing.data.session.id).not.toBe(daxiong.data.session.id);

    await first.close();
    await second.close();
  });

  it('never includes Runtime or Resume credentials in model-facing tool definitions', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const session = await MCPTestSession.connect(accessToken);
    const schema = JSON.stringify(await session.listToolDefinitions());

    expect(schema).toContain('agentAddressEnsureIdentity');
    expect(schema).not.toMatch(/resumeToken|runtimeToken|signingSecret/);
    expect(schema).not.toContain('agentAddressResumeWithToken');

    await session.close();
  });

});
