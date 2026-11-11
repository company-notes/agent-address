import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AccountController } from './AccountAPI';
import { AccountProps } from './Authorize';
import { Env } from './Env';

type PublicAddress = {
  id: string;
  org: string;
  handle: string;
  path: string;
  address: string;
  canonical: string;
};

type PublicOrganization = {
  id: string;
  slug: string;
  displayName: string;
};

type AccountAPIResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// Thin in-process client for AccountController: it builds the same Request/Response shape a real
// HTTP caller of the Account API would use, so every rule the API enforces applies to MCP too -
// but it skips bearer-token parsing, because McpAgent has already authenticated the caller through
// OAuthProvider's Durable Object props and the raw access token string never reaches this session.
class AccountAPIClient {
  constructor(
    private readonly env: Env,
    private readonly identity: AccountProps,
  ) {}

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const request = new Request(`https://account.internal${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await new AccountController(this.env).handleAuthenticated(
      this.identity.accountId,
      request,
      this.identity.authVersion,
    );
    const payload = (await response.json()) as AccountAPIResponse<T>;

    if (!payload.ok) {
      throw new Error(payload.error.message);
    }

    return payload.data;
  }
}

// One instance per MCP session. The account comes from OAuth; the session's own work address is
// remembered in Durable Object storage so it survives reconnects of the same session.
export class AddressMCP extends McpAgent<Env, unknown, AccountProps> {
  static readonly WORK_KEY = 'workAddressId';

  static readonly INSTRUCTIONS =
    'Agent Address gives each agent session a name of the form org/@machine/session, ' +
    'for example example-org/@mypc/build-release. The user is already signed in. ' +
    'When the user asks to name or "give a name to" this session, call agentAddressClaimWork once. ' +
    'Pass organization only if the user named it and the account has none yet; the account owns at most one ' +
    'organization, so otherwise omit it. Pass host with the machine name the user gave; if the tool asks which ' +
    'machine, ask the user. If the user gives no session name, omit handle and a temporary name is assigned. ' +
    'If a local agent on the machine needs its own host credential, call agentAddressInstallLocal and pass it ' +
    'the resulting enrollment code. Do not claim a new name for every message. After claiming or renaming, ' +
    'tell the user the active address.';

  server = new McpServer(
    { name: 'Agent Address', version: '0.3.0' },
    { instructions: AddressMCP.INSTRUCTIONS },
  );

  private get accountAPI(): AccountAPIClient {
    return new AccountAPIClient(this.env, this.props!);
  }

  private static textResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  }

  private static describeSession(message: string, orgSlug: string, work: PublicAddress) {
    return AddressMCP.textResult({ workAddress: work, message: `${message} ${orgSlug}/@${work.path}.` });
  }

  private loadWorkAddressId(): Promise<string | undefined> {
    return this.ctx.storage.get<string>(AddressMCP.WORK_KEY);
  }

  private async requireWorkAddressId(): Promise<string> {
    const addressId = await this.loadWorkAddressId();
    if (!addressId) {
      throw new Error('This agent session has no name yet. Call agentAddressClaimWork first.');
    }

    return addressId;
  }

  private registerStatusTool(): void {
    this.server.registerTool(
      'agentAddressGetStatus',
      {
        description:
          "Show the signed-in account, its organization, its machines (hosts) and this session's current name.",
      },
      async () => {
        const workAddressId = await this.loadWorkAddressId();
        const query = workAddressId ? `?work_address_id=${encodeURIComponent(workAddressId)}` : '';
        return AddressMCP.textResult(await this.accountAPI.call('GET', `/v1/account/status${query}`));
      },
    );
  }

  private registerClaimTool(): void {
    this.server.registerTool(
      'agentAddressClaimWork',
      {
        description:
          'Give this session a name (org/@machine/session). Registers the organization first if the account has ' +
          'none and one is provided, creates the machine if it is new, and assigns a temporary name when no ' +
          'handle is given.',
        inputSchema: {
          handle: z.string().optional().describe('Session name in kebab-case. Omit for a temporary name.'),
          host: z.string().optional().describe('Machine name such as mypc. Needed unless the account has exactly one.'),
          organization: z.string().optional().describe('Organization slug. Only needed to register a new organization.'),
          organizationDisplayName: z.string().optional(),
          displayName: z.string().optional(),
        },
      },
      async (request) => {
        if (await this.loadWorkAddressId()) {
          throw new Error('This session already has a name. Rename or release it instead.');
        }

        const claimed = await this.accountAPI.call<{ organization: PublicOrganization; work: PublicAddress }>(
          'POST',
          '/v1/account/work',
          request,
        );
        await this.ctx.storage.put(AddressMCP.WORK_KEY, claimed.work.id);
        return AddressMCP.describeSession('This session is now', claimed.organization.slug, claimed.work);
      },
    );
  }

  private registerRenameTool(): void {
    this.server.registerTool(
      'agentAddressRenameWork',
      {
        description: 'Rename this session, keeping the same machine.',
        inputSchema: { handle: z.string() },
      },
      async ({ handle }) => {
        const workAddressId = await this.requireWorkAddressId();
        const work = await this.accountAPI.call<PublicAddress>(
          'PATCH',
          `/v1/account/work/${encodeURIComponent(workAddressId)}`,
          { handle },
        );
        return AddressMCP.describeSession('This session is now', work.org, work);
      },
    );
  }

  private registerReleaseTool(): void {
    this.server.registerTool(
      'agentAddressReleaseWork',
      { description: "Release this session's name when the work is finished so it can be reused." },
      async () => {
        const workAddressId = await this.requireWorkAddressId();
        const work = await this.accountAPI.call<PublicAddress>(
          'DELETE',
          `/v1/account/work/${encodeURIComponent(workAddressId)}`,
        );
        await this.ctx.storage.delete(AddressMCP.WORK_KEY);
        return AddressMCP.textResult({ released: true, canonical: work.canonical });
      },
    );
  }

  private registerResolveTool(): void {
    this.server.registerTool(
      'agentAddressResolve',
      {
        description: 'Resolve @machine/session in your organization, or an explicit org/machine/session address.',
        inputSchema: { address: z.string() },
      },
      async ({ address }) => {
        const resolved = await this.accountAPI.call(
          'GET',
          `/v1/account/resolve?address=${encodeURIComponent(address)}`,
        );

        return AddressMCP.textResult(resolved);
      },
    );
  }

  private registerInstallLocalTool(): void {
    this.server.registerTool(
      'agentAddressInstallLocal',
      {
        description:
          "Prepare the user's machine for a local agent that needs its own host credential: registers the " +
          'machine name if needed and returns a one-time enrollment code (valid 15 minutes, single use) that ' +
          'the local agent redeems via POST /v1/enrollments/redeem.',
        inputSchema: { host: z.string().describe('Machine name such as mypc.') },
      },
      async ({ host }) => {
        const install = await this.accountAPI.call<{ host: PublicAddress; enrollmentCode: string; expiresAt: string }>(
          'POST',
          '/v1/account/local-install',
          { host },
        );
        return AddressMCP.textResult({
          host: install.host,
          enrollmentCode: install.enrollmentCode,
          expiresAt: install.expiresAt,
          instructions:
            `Give this code to the local agent on ${install.host.org}/@${install.host.path}. It redeems the ` +
            'code once, within 15 minutes, via POST /v1/enrollments/redeem { "code": "..." } to obtain this ' +
            "machine's host credential (addressToken).",
        });
      },
    );
  }

  async init(): Promise<void> {
    this.registerStatusTool();
    this.registerClaimTool();
    this.registerRenameTool();
    this.registerReleaseTool();
    this.registerResolveTool();
    this.registerInstallLocalTool();
  }
}
