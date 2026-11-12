import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AccountProps } from './Authorize';
import { Env } from './Env';
import { IdentityAPIClient } from './IdentityAPIClient';
import { AgentRow, PublicSession } from './IdentityService';
import { IdentitySummary, MCPIdentityLifecycle } from './MCPIdentityLifecycle';

type AccountStatus = {
  account: { email: string };
  organization: { id: string; slug: string; displayName: string } | null;
};

// MCP is a thin adapter. Identity, authorization and Runtime ownership remain
// inside the shared HTTP domain services, with private connection-scoped state.
export class AddressMCP extends McpAgent<Env, unknown, AccountProps> {
  private static readonly INSTRUCTIONS =
    'After successful OAuth sign-in, immediately call agentAddressEnsureIdentity. ' +
    'This action creates a personal Organization if needed, claims an Agent and Default Session ' +
    'on first use, or safely resumes the same Session when its previous lease has expired. ' +
    'Do not ask the user to choose an address or manage Runtime/Resume credentials. ' +
    'If the Agent persona already has a display name, pass it as agentDisplayName; otherwise ' +
    'let the service choose an address. Do not infer ownership from a persona name, account ' +
    'membership or someone else\'s address. Only change or forget the existing identity on an ' +
    'explicit user request. Show the resulting canonical organization/agent/session address. ' +
    'A second active Runtime cannot be taken over. Runtime and Resume credentials are never ' +
    'model-visible tool arguments or results. A fresh independent MCP connection gets its own ' +
    'Agent unless an authorized persisted connection can securely resume its previous one.';

  private pendingEnsure: Promise<IdentitySummary> | null = null;

  server = new McpServer(
    { name: 'Agent Address', version: '2.0.0' },
    { instructions: AddressMCP.INSTRUCTIONS },
  );

  private get api(): IdentityAPIClient {
    return new IdentityAPIClient(this.env, this.props!);
  }

  private get identityManager(): MCPIdentityLifecycle {
    return new MCPIdentityLifecycle(this.api, this.ctx.storage, this.props!.accountId);
  }

  private static textResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  }

  private async ensureIdentity(displayName?: string): Promise<IdentitySummary> {
    if (!this.pendingEnsure) {
      this.pendingEnsure = this.identityManager.ensure(displayName);
    }

    try {
      return await this.pendingEnsure;
    } finally {
      this.pendingEnsure = null;
    }
  }

  private registerEnsure(): void {
    this.server.registerTool(
      'agentAddressEnsureIdentity',
      {
        description: 'Use immediately after OAuth login. Automatically create or restore this ' +
          'Agent\'s private Session without user-managed credentials or naming questions.',
        inputSchema: {
          agentDisplayName: z.string().trim().min(1).max(120).optional(),
        },
      },
      async ({ agentDisplayName }) => AddressMCP.textResult(
        await this.ensureIdentity(agentDisplayName),
      ),
    );
  }

  private registerStatus(): void {
    this.server.registerTool(
      'agentAddressGetStatus',
      { description: 'Read the signed-in Account, Organization and locally selected Session.' },
      async () => AddressMCP.textResult({
        ...await this.api.call<AccountStatus>('GET', '/v2/account/status'),
        session: await this.identityManager.current(),
      }),
    );
  }

  private registerOrganization(): void {
    this.server.registerTool(
      'agentAddressRegisterOrganization',
      {
        description: 'Explicitly register a named Organization if the user requests one. ' +
          'Normal onboarding creates a private personal Organization automatically.',
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
        description: 'Explicitly create a new Agent and initial Default Session; no private ' +
          'Runtime or Resume credentials are returned. Use Ensure for normal onboarding.',
        inputSchema: {
          agentName: z.string().optional(),
          sessionName: z.string().optional(),
          agentDisplayName: z.string().optional(),
          sessionDisplayName: z.string().optional(),
          runtimeLabel: z.string().optional(),
        },
      },
      async (input) => AddressMCP.textResult(await this.identityManager.claim(input)),
    );
  }

  private registerCreateSession(): void {
    this.server.registerTool(
      'agentAddressCreateSession',
      {
        description: 'Explicitly create another Session under an authorized Agent after ' +
          'releasing the current Session.',
        inputSchema: {
          agentID: z.string(),
          sessionName: z.string().optional(),
          sessionDisplayName: z.string().optional(),
          runtimeLabel: z.string().optional(),
        },
      },
      async ({ agentID, ...input }) => AddressMCP.textResult(
        await this.identityManager.claimSession(agentID, input),
      ),
    );
  }

  private registerResume(): void {
    this.server.registerTool(
      'agentAddressResumeSession',
      {
        description: 'Restore only the Session privately saved in this MCP connection. ' +
          'Never request or return a Resume capability in model-visible text.',
      },
      async () => AddressMCP.textResult(await this.identityManager.resume()),
    );
  }

  private registerHeartbeat(): void {
    this.server.registerTool(
      'agentAddressHeartbeatRuntime',
      { description: 'Renew the current Session\'s private active Runtime lease.' },
      async () => AddressMCP.textResult(await this.identityManager.heartbeat()),
    );
  }

  private registerRelease(): void {
    this.server.registerTool(
      'agentAddressReleaseRuntime',
      {
        description: 'Release Runtime ownership but retain private Session Resume information. ' +
          'Ensure can restore this Session afterward.',
      },
      async () => AddressMCP.textResult(await this.identityManager.release()),
    );
  }

  private registerForgetLocal(): void {
    this.server.registerTool(
      'agentAddressForgetLocalSession',
      {
        description: 'Explicitly forget this MCP connection\'s saved identity after authorized ' +
          'release or external revocation. This does not revoke a live remote Runtime.',
      },
      async () => AddressMCP.textResult(await this.identityManager.forget()),
    );
  }

  private registerDirectory(): void {
    this.server.registerTool(
      'agentAddressListAgents',
      { description: 'List authorized Agents and their Default Sessions in your Organization.' },
      async () => AddressMCP.textResult(
        await this.api.call<AgentRow[]>('GET', '/v2/account/agents'),
      ),
    );

    this.server.registerTool(
      'agentAddressListSessions',
      {
        description: 'List Sessions belonging to an authorized Agent.',
        inputSchema: { agentID: z.string() },
      },
      async ({ agentID }) => AddressMCP.textResult(
        await this.api.call<PublicSession[]>(
          'GET', `/v2/account/agents/${encodeURIComponent(agentID)}/sessions`,
        ),
      ),
    );

    this.server.registerTool(
      'agentAddressResolve',
      {
        description: 'Resolve an Agent shorthand or full canonical address to a real Session.',
        inputSchema: { address: z.string() },
      },
      async ({ address }) => AddressMCP.textResult(
        await this.api.call<PublicSession>(
          'GET', `/v2/account/resolve?address=${encodeURIComponent(address)}`,
        ),
      ),
    );
  }

  async init(): Promise<void> {
    this.registerEnsure();
    this.registerStatus();
    this.registerOrganization();
    this.registerClaim();
    this.registerCreateSession();
    this.registerResume();
    this.registerHeartbeat();
    this.registerRelease();
    this.registerForgetLocal();
    this.registerDirectory();
  }
}
