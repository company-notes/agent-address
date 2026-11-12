import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AccountProps } from './Authorize';
import { Env } from './Env';
import { IdentityAPIClient } from './IdentityAPIClient';
import { AgentRow, ClaimedIdentity, PublicSession, ResumedIdentity } from './IdentityService';

type AccountStatus = {
  account: { email: string };
  organization: { id: string; slug: string; displayName: string } | null;
};

// MCP handles tool descriptions and the current client's saved identity only.
// All business behavior is delegated to the shared HTTP API.
export class AddressMCP extends McpAgent<Env, unknown, AccountProps> {
  private static readonly SESSION_KEY = 'sessionID';
  private static readonly RUNTIME_KEY = 'runtimeToken';

  private static readonly INSTRUCTIONS =
    'Agent Address identifies your Organization, Agent, and Session using an ' +
    'organization/agent/session address. One application may host many Agents, and one Agent ' +
    'may host many Sessions. If you have no Organization, ask the user for its name. ' +
    'Create a new Agent for a new instance; resume an existing Session only with an authorized ' +
    'resume token. The user may name the Agent, Session, both, or neither. ' +
    'Always give the user the complete canonical address after registration. ' +
    'Never reclaim a Session already held by another Runtime; choose a new address.';

  server = new McpServer(
    { name: 'Agent Address', version: '1.0.0' },
    { instructions: AddressMCP.INSTRUCTIONS },
  );

  private get api(): IdentityAPIClient {
    return new IdentityAPIClient(this.env, this.props!);
  }

  private static textResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  }

  private async requireSessionID(): Promise<string> {
    const sessionID = await this.ctx.storage.get<string>(AddressMCP.SESSION_KEY);

    if (!sessionID) {
      throw new Error('No active Session. Claim a new Agent or resume an existing Session first.');
    }

    return sessionID;
  }

  private async rememberIdentity(sessionID: string, runtimeToken: string): Promise<void> {
    await this.ctx.storage.put(AddressMCP.SESSION_KEY, sessionID);
    await this.ctx.storage.put(AddressMCP.RUNTIME_KEY, runtimeToken);
  }

  private async assertUnclaimed(): Promise<void> {
    if (await this.ctx.storage.get<string>(AddressMCP.SESSION_KEY)) {
      throw new Error('This MCP connection already has an active Session. Release it before switching.');
    }
  }

  private registerStatus(): void {
    this.server.registerTool(
      'agentAddressGetStatus',
      { description: 'Show the signed-in Organization and current Agent/Session canonical address.' },
      async () => {
        const status = await this.api.call<AccountStatus>('GET', '/v2/account/status');
        const sessionID = await this.ctx.storage.get<string>(AddressMCP.SESSION_KEY);
        const session = sessionID
          ? await this.api.call<PublicSession>('GET', `/v2/account/sessions/${encodeURIComponent(sessionID)}`)
          : null;

        return AddressMCP.textResult({ ...status, session });
      },
    );
  }

  private registerOrganization(): void {
    this.server.registerTool(
      'agentAddressRegisterOrganization',
      {
        description: 'Register an Organization for your signed-in account, if it does not already have one.',
        inputSchema: {
          slug: z.string(),
          displayName: z.string(),
        },
      },
      async (input) => AddressMCP.textResult(
        await this.api.call('POST', '/v2/account/organization', input),
      ),
    );
  }

  private registerClaim(): void {
    this.server.registerTool(
      'agentAddressClaimAgent',
      {
        description: 'Register one new Agent with its initial default Session. All names are optional.',
        inputSchema: {
          agentName: z.string().optional(),
          sessionName: z.string().optional(),
          agentDisplayName: z.string().optional(),
          sessionDisplayName: z.string().optional(),
          runtimeLabel: z.string().optional(),
        },
      },
      async (input) => {
        await this.assertUnclaimed();

        const result = await this.api.call<ClaimedIdentity>('POST', '/v2/account/agents', input);
        await this.rememberIdentity(result.session.id, result.runtimeToken);

        return AddressMCP.textResult(result);
      },
    );
  }

  private registerCreateSession(): void {
    this.server.registerTool(
      'agentAddressCreateSession',
      {
        description: 'Create another Session under a registered Agent; first release your current Session.',
        inputSchema: {
          agentID: z.string(),
          sessionName: z.string().optional(),
          sessionDisplayName: z.string().optional(),
          runtimeLabel: z.string().optional(),
        },
      },
      async ({ agentID, ...input }) => {
        await this.assertUnclaimed();

        const created = await this.api.call<ClaimedIdentity>(
          'POST',
          `/v2/account/agents/${encodeURIComponent(agentID)}/sessions`,
          input,
        );
        await this.rememberIdentity(created.session.id, created.runtimeToken);

        return AddressMCP.textResult(created);
      },
    );
  }

  private registerResume(): void {
    this.server.registerTool(
      'agentAddressResumeSession',
      {
        description: 'Resume an existing Agent Session with its private resume token. Refuses active Runtime conflicts.',
        inputSchema: {
          sessionID: z.string(),
          resumeToken: z.string(),
          runtimeLabel: z.string().optional(),
        },
      },
      async ({ sessionID, resumeToken, runtimeLabel }) => {
        await this.assertUnclaimed();

        const resumed = await this.api.call<ResumedIdentity>(
          'POST',
          `/v2/account/sessions/${encodeURIComponent(sessionID)}/resume`,
          { resumeToken, runtimeLabel },
        );
        await this.rememberIdentity(sessionID, resumed.runtimeToken);

        return AddressMCP.textResult(resumed);
      },
    );
  }

  private registerRelease(): void {
    this.server.registerTool(
      'agentAddressReleaseRuntime',
      { description: 'Release this Runtime ownership without deleting the Agent or Session.' },
      async () => {
        const sessionID = await this.requireSessionID();
        const runtimeToken = await this.ctx.storage.get<string>(AddressMCP.RUNTIME_KEY);

        if (!runtimeToken) {
          throw new Error('This Runtime does not have an ownership token.');
        }

        const result = await this.api.call<PublicSession>(
          'POST',
          `/v2/account/sessions/${encodeURIComponent(sessionID)}/release`,
          { runtimeToken },
        );

        await this.ctx.storage.delete(AddressMCP.SESSION_KEY);
        await this.ctx.storage.delete(AddressMCP.RUNTIME_KEY);

        return AddressMCP.textResult({ released: true, canonical: result.canonical });
      },
    );
  }

  private registerDirectory(): void {
    this.server.registerTool(
      'agentAddressListAgents',
      { description: 'List all registered Agent identities and their default Sessions in your Organization.' },
      async () => AddressMCP.textResult(
        await this.api.call<AgentRow[]>('GET', '/v2/account/agents'),
      ),
    );

    this.server.registerTool(
      'agentAddressListSessions',
      {
        description: 'List the Sessions belonging to an Agent in your Organization.',
        inputSchema: { agentID: z.string() },
      },
      async ({ agentID }) => AddressMCP.textResult(
        await this.api.call<PublicSession[]>(
          'GET',
          `/v2/account/agents/${encodeURIComponent(agentID)}/sessions`,
        ),
      ),
    );

    this.server.registerTool(
      'agentAddressResolve',
      {
        description: 'Resolve an Organization/Agent[/Session] address to the canonical three-level Session address.',
        inputSchema: { address: z.string() },
      },
      async ({ address }) => AddressMCP.textResult(
        await this.api.call<PublicSession>(
          'GET',
          `/v2/account/resolve?address=${encodeURIComponent(address)}`,
        ),
      ),
    );
  }

  async init(): Promise<void> {
    this.registerStatus();
    this.registerOrganization();
    this.registerClaim();
    this.registerCreateSession();
    this.registerResume();
    this.registerRelease();
    this.registerDirectory();
  }
}
