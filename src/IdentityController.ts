import { AccountAuthenticator } from './AccountAuthenticator';
import { AccountService } from './Accounts';
import { Env } from './Env';
import { ApplicationError } from './ApplicationError';
import { JSONRecord, RequestData, ResponseData } from './HTTP';
import { NewAgentInput, NewSessionInput } from './IdentityService';
import { Services } from './Services';

// The only account-facing HTTP API. MCP calls handleAuthenticated with its OAuth identity.
export class IdentityController {
  private readonly accounts: AccountService;

  constructor(private readonly env: Env) {
    this.accounts = new AccountService(env.DB, env.REGISTRATION_KEY);
  }

  async handle(request: Request): Promise<Response> {
    const identity = await AccountAuthenticator.authenticate(request, this.env);

    if (new URL(request.url).pathname === '/v2/account/grant' &&
        request.method === 'GET') {
      await this.accounts.assertAuthVersion(identity.accountId, identity.authVersion ?? 0);

      return ResponseData.ok({ grantFingerprint: identity.grantFingerprint });
    }

    return this.handleAuthenticated(identity.accountId, request, identity.authVersion,
      identity.grantFingerprint);
  }

  async handleAuthenticated(
    accountID: string, request: Request, authVersion = 0, grantFingerprint?: string,
  ): Promise<Response> {
    const { account, organization } = await this.accounts.authenticatedAccount(accountID, authVersion);
    const services = new Services(this.env, { accountID, organization });

    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const method = request.method;
    const [, , resource, identifier, action] = segments;

    if (segments[0] !== 'v2' || segments[1] !== 'account') {
      throw new ApplicationError(404, 'not_found', 'Identity API endpoint not found.');
    }

    if (method === 'GET' && resource === 'status' && segments.length === 3) {
      if (account.orgId && !organization) {
        throw new ApplicationError(404, 'organization_not_found', 'Organization not found.');
      }

      return ResponseData.ok({
        account: { email: account.email },
        organization,
        ...(url.searchParams.get('include_grant') === '1' && grantFingerprint
          ? { grantFingerprint } : {}),
      });
    }

    if (method === 'POST' && resource === 'organization' && segments.length === 3) {
      const data = await RequestData.readJSON(request);
      const slug = RequestData.requiredString(data, 'slug', 63);
      const displayName = RequestData.requiredString(data, 'displayName', 120);

      return ResponseData.ok(await services.organizations.register(accountID, slug, displayName), 201);
    }

    if (method === 'PATCH' && resource === 'organization' && segments.length === 3) {
      const data = await RequestData.readJSON(request);
      const displayName = RequestData.requiredString(data, 'displayName', 120);

      return ResponseData.ok(await services.organizations.updateDisplayName(accountID, displayName));
    }

    if (method === 'POST' && resource === 'agent-runtime-leases' &&
        segments.length === 3) {
      const data = await RequestData.readJSON(request);

      return ResponseData.ok(
        await services.identities.claimAgent(accountID, IdentityController.newAgentInput(data)),
        201,
      );
    }

    if (resource === 'agents' && identifier && action === 'session-runtime-leases' &&
        segments.length === 5 && method === 'POST') {
      const data = await RequestData.readJSON(request);

      return ResponseData.ok(
        await services.identities.claimSession(
          accountID,
          identifier,
          IdentityController.newSessionInput(data),
        ),
        201,
      );
    }

    if (resource === 'agent-registrations' && identifier &&
        segments.length === 4 && method === 'PUT') {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(identifier)) {
        throw new ApplicationError(400, 'invalid_registration_id',
          'Registration ID must be a stable lowercase identifier.');
      }

      const data = await RequestData.readJSON(request);
      const input: NewAgentInput = {
        agentName: RequestData.requiredString(data, 'agentName', 64),
        agentDisplayName: RequestData.requiredString(data, 'agentDisplayName', 120),
        sessionName: RequestData.optionalString(data, 'sessionName', 64) ?? 'main',
      };

      return ResponseData.ok(
        await services.identities.registerOfficeAgent(accountID, identifier, input),
      );
    }

    if (resource === 'agents' && segments.length === 3) {
      if (method === 'GET') {
        return ResponseData.ok(await services.identities.listAgents(accountID));
      }

      if (method === 'POST') {
        const data = await RequestData.readJSON(request);
        const input = IdentityController.newAgentInput(data);

        return ResponseData.ok(await services.identities.registerAgent(accountID, input), 201);
      }
    }

    if (resource === 'agents' && identifier && segments.length === 4) {
      if (method === 'PATCH') {
        const data = await RequestData.readJSON(request);
        const changes = IdentityController.agentChanges(data);

        return ResponseData.ok(await services.identities.updateAgent(accountID, identifier, changes));
      }

      if (method === 'DELETE') {
        return ResponseData.ok(await services.identities.archiveAgent(accountID, identifier));
      }
    }

    if (resource === 'agents' && identifier && action === 'sessions' && segments.length === 5) {
      if (method === 'GET') {
        return ResponseData.ok(await services.identities.listSessions(accountID, identifier));
      }

      if (method === 'POST') {
        const data = await RequestData.readJSON(request);
        const input = IdentityController.newSessionInput(data);

        return ResponseData.ok(await services.identities.registerSession(accountID, identifier, input), 201);
      }
    }

    if (resource === 'sessions' && identifier && segments.length === 4) {
      if (method === 'GET') {
        return ResponseData.ok(await services.identities.getSession(accountID, identifier));
      }

      if (method === 'PATCH') {
        const data = await RequestData.readJSON(request);
        const changes = IdentityController.sessionChanges(data);

        return ResponseData.ok(await services.identities.updateSession(accountID, identifier, changes));
      }

      if (method === 'DELETE') {
        return ResponseData.ok(await services.identities.archiveSession(accountID, identifier));
      }
    }

    if (resource === 'sessions' && identifier && segments.length === 5 &&
        method === 'PUT' && action === 'default-selection') {
      return ResponseData.ok(await services.identities.setDefaultSession(accountID, identifier));
    }

    if (resource === 'sessions' && identifier && segments.length === 5 &&
        method === 'PUT' && action === 'resume-credential') {
      return ResponseData.ok(await services.identities.rotateResumeToken(accountID, identifier));
    }

    if (resource === 'sessions' && identifier && action === 'owner-runtime-lease' &&
        segments.length === 5 && method === 'PUT') {
      const data = await RequestData.readJSON(request);
      const runtimeLabel = RequestData.optionalString(data, 'runtimeLabel', 120);

      return ResponseData.ok(
        await services.identities.recoverByOwner(accountID, identifier, runtimeLabel),
      );
    }

    if (resource === 'sessions' && identifier && action === 'runtime-lease' &&
        segments.length === 5 && ['PUT', 'PATCH', 'DELETE'].includes(method)) {
      return this.sessionRuntime(services, accountID, identifier, request);
    }

    if (method === 'GET' && resource === 'addresses' && segments.length === 3) {
      const address = url.searchParams.get('address');
      if (!address) {
        throw new ApplicationError(400, 'invalid_address', 'address query parameter is required.');
      }

      return ResponseData.ok(await services.identities.resolve(accountID, address));
    }

    throw new ApplicationError(404, 'not_found', 'Identity API endpoint not found.');
  }

  private async sessionRuntime(
    services: Services,
    accountID: string,
    sessionID: string,
    request: Request,
  ): Promise<Response> {
    const data = await RequestData.readJSON(request);

    if (request.method === 'PUT') {
      const resumeToken = RequestData.requiredString(data, 'resumeToken', 256);
      const runtimeLabel = RequestData.optionalString(data, 'runtimeLabel', 120);
      const runtimeToken = RequestData.optionalString(data, 'runtimeToken', 256) ?? undefined;

      return ResponseData.ok(
        await services.identities.resume(accountID, sessionID, resumeToken, runtimeLabel, runtimeToken),
      );
    }

    const runtimeToken = RequestData.requiredString(data, 'runtimeToken', 256);

    if (request.method === 'PATCH') {
      const lease = await services.identities.renewWithIdentity(accountID, sessionID, runtimeToken);

      return ResponseData.ok(new URL(request.url).searchParams.get('include_identity') === '1'
        ? lease : { expiresAt: lease.expiresAt });
    }

    if (request.method === 'DELETE') {
      return ResponseData.ok(await services.identities.release(accountID, sessionID, runtimeToken));
    }

    throw new ApplicationError(404, 'not_found', 'Identity API endpoint not found.');
  }

  private static agentChanges(data: JSONRecord) {
    if (!('agentName' in data) && !('agentDisplayName' in data)) {
      throw new ApplicationError(400, 'invalid_request', 'Provide an Agent name or display name.');
    }

    return {
      agentName: 'agentName' in data ? RequestData.requiredString(data, 'agentName', 64) : undefined,
      agentDisplayName: 'agentDisplayName' in data
        ? RequestData.optionalString(data, 'agentDisplayName', 120)
        : undefined,
    };
  }

  private static sessionChanges(data: JSONRecord) {
    if (!('sessionName' in data) && !('sessionDisplayName' in data)) {
      throw new ApplicationError(400, 'invalid_request', 'Provide a Session name or display name.');
    }

    return {
      sessionName: 'sessionName' in data ? RequestData.requiredString(data, 'sessionName', 64) : undefined,
      sessionDisplayName: 'sessionDisplayName' in data
        ? RequestData.optionalString(data, 'sessionDisplayName', 120)
        : undefined,
    };
  }

  private static newSessionInput(data: JSONRecord): NewSessionInput {
    return {
      sessionName: RequestData.optionalString(data, 'sessionName', 64) ?? undefined,
      sessionDisplayName: RequestData.optionalString(data, 'sessionDisplayName', 120) ?? undefined,
      runtimeLabel: RequestData.optionalString(data, 'runtimeLabel', 120) ?? undefined,
    };
  }

  private static newAgentInput(data: JSONRecord): NewAgentInput {
    return {
      agentName: RequestData.optionalString(data, 'agentName', 64) ?? undefined,
      agentDisplayName: RequestData.optionalString(data, 'agentDisplayName', 120) ?? undefined,
      ...this.newSessionInput(data),
    };
  }
}
