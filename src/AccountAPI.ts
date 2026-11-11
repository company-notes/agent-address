import { AccountProps } from './Authorize';
import { Env } from './Env';
import { APIError, RequestData, ResponseData } from './HTTP';
import { RegistryService } from './RegistryService';
import { ClaimRequest } from './Sessions';
import { Services } from './Services';

// Authenticates a request's OAuth access token - the same token issued to /mcp clients - into the
// account it belongs to. This is the only place that talks to the OAuth token store directly.
export class AccountAuthenticator {
  private static bearerToken(request: Request): string {
    const authorization = request.headers.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new APIError(401, 'unauthorized', 'Bearer OAuth access token required.');
    }

    return match[1].trim();
  }

  static async authenticate(request: Request, env: Env): Promise<AccountProps> {
    const summary = await env.OAUTH_PROVIDER.unwrapToken<AccountProps>(this.bearerToken(request));
    if (!summary) {
      throw new APIError(401, 'invalid_token', 'OAuth access token is invalid, expired or revoked.');
    }

    return summary.grant.props;
  }
}

// The account-scoped Address API: everything a signed-in account can do to name and manage its
// agent sessions, reachable over plain HTTP with an OAuth bearer token. This is what a separate
// product - such as a separate agent messaging service - calls directly; it never needs to speak MCP to
//
// Our own remote MCP (MCP.ts) is a client of this same class through `handleAuthenticated`, which
// skips bearer-token parsing because McpAgent has already authenticated the caller through
// OAuthProvider's Durable Object props - the raw token string never reaches the session, so MCP
// supplies the account id it was already given instead of a header.
export class AccountController {
  private readonly services: Services;

  constructor(private readonly env: Env) {
    this.services = new Services(env);
  }

  async handle(request: Request): Promise<Response> {
    const identity = await AccountAuthenticator.authenticate(request, this.env);
    return this.handleAuthenticated(identity.accountId, request, identity.authVersion);
  }

  async handleAuthenticated(accountId: string, request: Request, authVersion = 0): Promise<Response> {
    await this.services.accounts.assertAuthVersion(accountId, authVersion);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const [, , resource, addressId] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (method === 'GET' && resource === 'status') {
      const workAddressId = url.searchParams.get('work_address_id');
      return ResponseData.ok(await this.services.sessions.describe(accountId, workAddressId));
    }

    if (method === 'POST' && resource === 'work' && !addressId) {
      return this.claimWork(accountId, request);
    }
    if (method === 'PATCH' && resource === 'work' && addressId) {
      return this.renameWork(accountId, addressId, request);
    }
    if (method === 'DELETE' && resource === 'work' && addressId) {
      return this.releaseWork(accountId, addressId);
    }

    if (method === 'DELETE' && resource === 'host' && addressId) {
      const runId = url.searchParams.get('run_id') || '';
      const result = await this.services.sessions.releaseSmokeHost(accountId, addressId, runId);

      return ResponseData.ok(RegistryService.publicAddress(result.organization.slug, result.host));
    }

    if (method === 'GET' && resource === 'resolve') {
      return this.resolve(accountId, url.searchParams.get('address'));
    }

    if (method === 'POST' && resource === 'local-install') {
      return this.createLocalInstall(accountId, request);
    }

    throw new APIError(404, 'not_found', 'Account API endpoint not found.');
  }

  private async claimWork(accountId: string, request: Request): Promise<Response> {
    const claimed = await this.services.sessions.claim(accountId, await this.readClaimRequest(request));
    return ResponseData.ok(
      {
        organization: RegistryService.publicOrganization(claimed.organization),
        host: RegistryService.publicAddress(claimed.organization.slug, claimed.host),
        work: RegistryService.publicAddress(claimed.organization.slug, claimed.work),
      },
      201,
    );
  }

  private async renameWork(accountId: string, addressId: string, request: Request): Promise<Response> {
    const handle = RequestData.requiredString(await RequestData.readJSON(request), 'handle', 64);
    const { organization, work } = await this.services.sessions.rename(accountId, addressId, handle);

    return ResponseData.ok(RegistryService.publicAddress(organization.slug, work));
  }

  private async releaseWork(accountId: string, addressId: string): Promise<Response> {
    const { organization, work } = await this.services.sessions.release(accountId, addressId);

    return ResponseData.ok(RegistryService.publicAddress(organization.slug, work));
  }

  private async resolve(accountId: string, address: string | null): Promise<Response> {
    if (!address) {
      throw new APIError(400, 'invalid_request', 'address query parameter is required.');
    }

    return ResponseData.ok(await this.services.sessions.resolve(accountId, address));
  }

  private async createLocalInstall(accountId: string, request: Request): Promise<Response> {
    const host = RequestData.requiredString(await RequestData.readJSON(request), 'host', 64);
    const install = await this.services.sessions.createLocalInstall(accountId, host);

    return ResponseData.ok({
      host: RegistryService.publicAddress(install.organization.slug, install.host),
      enrollmentCode: install.code,
      expiresAt: install.expiresAt,
    });
  }

  private async readClaimRequest(request: Request): Promise<ClaimRequest> {
    const data = await RequestData.readJSON(request);

    return {
      organization: RequestData.optionalString(data, 'organization', 63) ?? undefined,
      organizationDisplayName: RequestData.optionalString(data, 'organizationDisplayName', 120) ?? undefined,
      host: RequestData.optionalString(data, 'host', 64) ?? undefined,
      handle: RequestData.optionalString(data, 'handle', 64) ?? undefined,
      displayName: RequestData.optionalString(data, 'displayName', 120) ?? undefined,
    };
  }
}
