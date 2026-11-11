import { AccountController } from './AccountAPI';
import { Env } from './Env';
import { APIError, RequestData, ResponseData } from './HTTP';
import { IssuedAddress, OrganizationRow, RegistryService } from './RegistryService';
import { Services } from './Services';

// HTTP adapter for the registry: parses requests, checks bearer credentials and shapes responses.
export class RegistryController {
  private readonly registry: RegistryService;
  private readonly services: Services;

  constructor(private readonly env: Env) {
    this.services = new Services(env);
    this.registry = this.services.registry;
  }

  private async authenticateOrganization(request: Request, orgSlug: string): Promise<OrganizationRow> {
    const organization = await this.registry.getOrganizationBySlug(RequestData.normalizeOrgSlug(orgSlug));
    const credential = await this.registry.authenticate(RequestData.bearerToken(request), 'org');
    if (credential.orgId !== organization.id) {
      throw new APIError(403, 'wrong_organization', 'Credential does not belong to this organization.');
    }

    return organization;
  }

  private async authenticateAddressOwner(request: Request, addressId: string, message: string): Promise<void> {
    const credential = await this.registry.authenticate(RequestData.bearerToken(request), 'address');
    if (credential.addressId !== addressId) {
      throw new APIError(403, 'wrong_address', message);
    }
  }

  private async readHandleAndDisplayName(request: Request): Promise<[string, string | null]> {
    const data = await RequestData.readJSON(request);
    const handle = RequestData.normalizeHandle(RequestData.requiredString(data, 'handle', 64));
    const displayName = RequestData.optionalString(data, 'displayName', 120);

    return [handle, displayName];
  }

  private addressCreatedResponse(orgSlug: string, issued: IssuedAddress): Response {
    return ResponseData.ok(
      {
        address: RegistryService.publicAddress(orgSlug, issued.address),
        addressToken: issued.token,
        warning: 'This token is shown only once. Keep it only in the runtime that owns this address.',
      },
      201,
    );
  }

  async createOrganization(request: Request): Promise<Response> {
    if (this.env.REGISTRATION_KEY) {
      const supplied = request.headers.get('x-registration-key');
      if (!supplied || supplied !== this.env.REGISTRATION_KEY) {
        throw new APIError(403, 'registration_closed', 'Organization registration requires a registration key.');
      }
    }

    const data = await RequestData.readJSON(request);
    const slug = RequestData.normalizeOrgSlug(RequestData.requiredString(data, 'slug', 63));
    const displayName = RequestData.requiredString(data, 'displayName', 120);
    const issued = await this.registry.createOrganization(slug, displayName);

    return ResponseData.ok(
      {
        organization: RegistryService.publicOrganization(issued.organization),
        orgToken: issued.token,
        warning: 'This token is shown only once. Store it securely.',
      },
      201,
    );
  }

  async getOrganization(orgSlug: string): Promise<Response> {
    const organization = await this.registry.getOrganizationBySlug(RequestData.normalizeOrgSlug(orgSlug));
    return ResponseData.ok(RegistryService.publicOrganization(organization));
  }

  async createRootAddress(request: Request, orgSlug: string): Promise<Response> {
    const organization = await this.authenticateOrganization(request, orgSlug);
    const [handle, displayName] = await this.readHandleAndDisplayName(request);
    const issued = await this.registry.createAddress(organization, handle, displayName, null);

    return this.addressCreatedResponse(organization.slug, issued);
  }

  async createChildAddress(request: Request, parentAddressId: string): Promise<Response> {
    await this.authenticateAddressOwner(request, parentAddressId, 'Credential does not own this parent address.');

    const parentAddress = await this.registry.getActiveAddressById(parentAddressId);
    const organization = await this.registry.getOrganizationById(parentAddress.orgId);
    const [handle, displayName] = await this.readHandleAndDisplayName(request);
    const issued = await this.registry.createAddress(organization, handle, displayName, parentAddress);

    return this.addressCreatedResponse(organization.slug, issued);
  }

  async listAddresses(request: Request, orgSlug: string): Promise<Response> {
    const organization = await this.authenticateOrganization(request, orgSlug);
    const addresses = await this.registry.listAddresses(organization.id);

    return ResponseData.ok(addresses.map((address) => RegistryService.publicAddress(organization.slug, address)));
  }

  async resolveAddress(orgSlug: string, pathInput: string): Promise<Response> {
    const organization = await this.registry.getOrganizationBySlug(RequestData.normalizeOrgSlug(orgSlug));
    const address = await this.registry.findActiveAddressByPath(organization.id, RequestData.normalizePath(pathInput));
    if (!address) {
      throw new APIError(404, 'address_not_found', 'Active address not found.');
    }

    return ResponseData.json(
      { ok: true, data: RegistryService.publicAddress(organization.slug, address) },
      200,
      { 'cache-control': 'public, max-age=30' },
    );
  }

  async renameAddress(request: Request, addressId: string): Promise<Response> {
    await this.authenticateAddressOwner(request, addressId, 'Credential does not own this address.');

    const address = await this.registry.getActiveAddressById(addressId);
    const data = await RequestData.readJSON(request);
    const newHandle = RequestData.normalizeHandle(RequestData.requiredString(data, 'handle', 64));
    const renamed = await this.registry.renameAddress(address, newHandle);
    const organization = await this.registry.getOrganizationById(renamed.orgId);

    return ResponseData.ok(RegistryService.publicAddress(organization.slug, renamed));
  }

  async revokeOwnedAddress(request: Request, addressId: string): Promise<Response> {
    await this.authenticateAddressOwner(request, addressId, 'Credential does not own this address.');
    return this.revokeAddress(addressId);
  }

  async revokeOrganizationAddress(request: Request, orgSlug: string, addressId: string): Promise<Response> {
    const organization = await this.authenticateOrganization(request, orgSlug);
    const address = await this.registry.getAddressById(addressId);
    if (address.orgId !== organization.id) {
      throw new APIError(404, 'address_not_found', 'Address not found in this organization.');
    }
    return this.revokeAddress(addressId);
  }

  private async revokeAddress(addressId: string): Promise<Response> {
    const revoked = await this.registry.revokeAddressTree(addressId);
    const organization = await this.registry.getOrganizationById(revoked.orgId);

    return ResponseData.ok(RegistryService.publicAddress(organization.slug, revoked));
  }

  async rotateAddressToken(request: Request, orgSlug: string, addressId: string): Promise<Response> {
    const organization = await this.authenticateOrganization(request, orgSlug);
    const address = await this.registry.getAddressById(addressId);
    if (address.orgId !== organization.id || address.revokedAt) {
      throw new APIError(404, 'address_not_found', 'Active address not found.');
    }

    const token = await this.registry.rotateAddressToken(address);
    return ResponseData.ok({
      address: RegistryService.publicAddress(organization.slug, address),
      addressToken: token,
      warning: 'Previous address credentials were revoked. This token is shown only once.',
    });
  }

  async rotateOrgToken(request: Request, orgSlug: string): Promise<Response> {
    const organization = await this.authenticateOrganization(request, orgSlug);
    const token = await this.registry.rotateOrganizationToken(organization);
    return ResponseData.ok({
      organization: RegistryService.publicOrganization(organization),
      orgToken: token,
      warning: 'Previous org credentials were revoked. This token is shown only once.',
    });
  }

  async redeemEnrollment(request: Request): Promise<Response> {
    const data = await RequestData.readJSON(request);
    const redeemed = await this.services.enrollments.redeem(RequestData.requiredString(data, 'code', 256));
    return ResponseData.ok({
      address: RegistryService.publicAddress(redeemed.organization.slug, redeemed.address),
      addressToken: redeemed.token,
      warning: 'This token is shown only once. Keep it only on the machine that owns this host address.',
    });
  }

  async whoAmI(request: Request): Promise<Response> {
    const credential = await this.registry.authenticate(RequestData.bearerToken(request));
    const organization = await this.registry.getOrganizationById(credential.orgId);
    if (credential.kind === 'org') {
      return ResponseData.ok({
        type: 'organization',
        organization: RegistryService.publicOrganization(organization),
      });
    }

    if (!credential.addressId) {
      throw new APIError(401, 'invalid_token', 'Address credential is incomplete.');
    }
    const address = await this.registry.getAddressById(credential.addressId);
    if (address.revokedAt) {
      throw new APIError(401, 'invalid_token', 'Address no longer exists or is revoked.');
    }

    return ResponseData.ok({
      type: 'address',
      address: RegistryService.publicAddress(organization.slug, address),
    });
  }
}

export class APIRouter {
  private readonly controller: RegistryController;
  private readonly accountController: AccountController;

  static routeParts(pathname: string): string[] {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent);
  }

  constructor(env: Env) {
    this.controller = new RegistryController(env);
    this.accountController = new AccountController(env);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const parts = APIRouter.routeParts(url.pathname);
    const [root, resource, id, sub, subId, action] = parts;

    if (method === 'GET' && url.pathname === '/health') {
      return ResponseData.ok({ service: 'agent-address', status: 'ok' });
    }
    if (method === 'GET' && url.pathname === '/') {
      return ResponseData.ok({
        service: 'Agent Address',
        version: 'v1',
        docs: 'https://github.com/company-notes/agent-address/blob/main/docs/openapi.yaml',
        canonicalHost: url.host,
      });
    }

    if (root !== 'v1') {
      throw new APIError(404, 'not_found', 'Endpoint not found.');
    }

    if (resource === 'account') {
      return this.accountController.handle(request);
    }

    const count = parts.length;
    if (method === 'POST' && count === 2 && resource === 'orgs') {
      return this.controller.createOrganization(request);
    }
    if (method === 'GET' && count === 3 && resource === 'orgs') {
      return this.controller.getOrganization(id);
    }

    if (method === 'POST' && count === 4 && resource === 'orgs' && sub === 'addresses') {
      return this.controller.createRootAddress(request, id);
    }
    if (method === 'GET' && count === 4 && resource === 'orgs' && sub === 'addresses') {
      return this.controller.listAddresses(request, id);
    }
    if (method === 'DELETE' && count === 5 && resource === 'orgs' && sub === 'addresses') {
      return this.controller.revokeOrganizationAddress(request, id, subId);
    }
    if (method === 'POST' && count === 6 && resource === 'orgs' && sub === 'addresses' && action === 'rotate-token') {
      return this.controller.rotateAddressToken(request, id, subId);
    }
    if (method === 'POST' && count === 4 && resource === 'orgs' && sub === 'rotate-token') {
      return this.controller.rotateOrgToken(request, id);
    }

    if (method === 'POST' && count === 4 && resource === 'addresses' && sub === 'children') {
      return this.controller.createChildAddress(request, id);
    }
    if (method === 'PATCH' && count === 3 && resource === 'addresses') {
      return this.controller.renameAddress(request, id);
    }
    if (method === 'DELETE' && count === 3 && resource === 'addresses') {
      return this.controller.revokeOwnedAddress(request, id);
    }

    if (method === 'POST' && count === 3 && resource === 'enrollments' && id === 'redeem') {
      return this.controller.redeemEnrollment(request);
    }

    if (method === 'GET' && count >= 4 && resource === 'resolve') {
      return this.controller.resolveAddress(id, parts.slice(3).join('/'));
    }
    if (method === 'GET' && count === 2 && resource === 'me') {
      return this.controller.whoAmI(request);
    }

    throw new APIError(404, 'not_found', 'Endpoint not found.');
  }
}
