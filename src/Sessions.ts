import { AccountRow, AccountService } from './Accounts';
import { EnrollmentService } from './Enrollments';
import { APIError, JSONRecord, RequestData } from './HTTP';
import { AddressRow, OrganizationRow, RegistryService } from './RegistryService';

export type ClaimRequest = {
  organization?: string;
  organizationDisplayName?: string;
  host?: string;
  handle?: string;
  displayName?: string;
};

export type ClaimedSession = {
  organization: OrganizationRow;
  host: AddressRow;
  work: AddressRow;
};

// What an authenticated account can do from a remote MCP session: name the session, manage the
// hosts (machines) of its organization and enroll local agent installs.
export class SessionAddressService {
  static readonly TEMPORARY_PREFIX = 'session';

  static temporaryHandle(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${this.TEMPORARY_PREFIX}-${suffix}`;
  }

  constructor(
    private readonly accounts: AccountService,
    private readonly registry: RegistryService,
    private readonly enrollments: EnrollmentService,
  ) {}

  private async ensureOrganization(account: AccountRow, requested?: string, displayName?: string): Promise<OrganizationRow> {
    const current = await this.accounts.findOrganization(account);
    if (!requested) {
      return this.accounts.requireOrganization(account);
    }

    const slug = RequestData.normalizeOrgSlug(requested);
    if (!current) {
      return this.accounts.registerOrganization(account, slug, displayName?.trim() || slug);
    }
    if (current.slug.toLowerCase() !== slug) {
      throw new APIError(409, 'account_has_organization', `This account belongs to organization ${current.slug}, not ${slug}.`);
    }

    return current;
  }

  private async ensureHost(org: OrganizationRow, handle: string): Promise<AddressRow> {
    const hostHandle = RequestData.normalizeHandle(handle);
    const existing = await this.registry.findActiveAddressByPath(org.id, hostHandle);
    if (existing) {
      return existing;
    }

    return (await this.registry.createAddress(org, hostHandle, null, null)).address;
  }

  private async chooseHost(org: OrganizationRow, requested?: string): Promise<AddressRow> {
    if (requested) {
      return this.ensureHost(org, requested);
    }

    const hosts = await this.registry.listActiveHosts(org.id);
    if (hosts.length === 1) {
      return hosts[0];
    }
    if (hosts.length === 0) {
      throw new APIError(409, 'host_required', 'Which machine is this session on? Provide a host name such as mypc.');
    }

    const names = hosts.map((host) => host.handle).join(', ');
    throw new APIError(409, 'host_required', `Which machine is this session on? Choose one of: ${names}.`);
  }

  private async requireWorkAddress(account: AccountRow, addressId: string): Promise<AddressRow> {
    const address = await this.registry.getActiveAddressById(addressId);
    if (address.orgId !== account.orgId || !address.parentAddressId) {
      throw new APIError(403, 'wrong_address', 'This account does not own that work address.');
    }

    return address;
  }

  async claim(accountId: string, request: ClaimRequest): Promise<ClaimedSession> {
    const account = await this.accounts.getAccount(accountId);
    const organization = await this.ensureOrganization(account, request.organization, request.organizationDisplayName);
    const host = await this.chooseHost(organization, request.host);
    const handle = request.handle ? RequestData.normalizeHandle(request.handle) : SessionAddressService.temporaryHandle();
    const issued = await this.registry.createAddress(organization, handle, request.displayName?.trim() || null, host);

    return { organization, host, work: issued.address };
  }

  async rename(accountId: string, addressId: string, handle: string): Promise<{ organization: OrganizationRow; work: AddressRow }> {
    const account = await this.accounts.getAccount(accountId);
    const address = await this.requireWorkAddress(account, addressId);
    const organization = await this.accounts.requireOrganization(account);
    const work = await this.registry.renameAddress(address, RequestData.normalizeHandle(handle));

    return { organization, work };
  }

  async release(accountId: string, addressId: string): Promise<{ organization: OrganizationRow; work: AddressRow }> {
    const account = await this.accounts.getAccount(accountId);
    const address = await this.requireWorkAddress(account, addressId);
    const organization = await this.accounts.requireOrganization(account);
    return { organization, work: await this.registry.revokeAddressTree(address.id) };
  }

  async describe(accountId: string, workAddressId: string | null): Promise<JSONRecord> {
    const account = await this.accounts.getAccount(accountId);
    const organization = await this.accounts.findOrganization(account);
    if (!organization) {
      return {
        account: { email: account.email },
        organization: null,
        hosts: [],
        work: null,
        nextAction: 'Ask the user for an organization name, then call agentAddressClaimWork with organization set.',
      };
    }

    const hosts = await this.registry.listActiveHosts(organization.id);
    const work = workAddressId
      ? await this.requireWorkAddress(account, workAddressId)
      : null;

    return {
      account: { email: account.email },
      organization: RegistryService.publicOrganization(organization),
      hosts: hosts.map((host) => RegistryService.publicAddress(organization.slug, host)),
      work: work ? RegistryService.publicAddress(organization.slug, work) : null,
    };
  }

  async resolve(accountId: string, address: string): Promise<JSONRecord> {
    const account = await this.accounts.getAccount(accountId);
    const ownOrganization = await this.accounts.findOrganization(account);

    const value = address.trim();
    const [orgSlug, path] = value.startsWith('@')
      ? [ownOrganization?.slug, value.slice(1)]
      : [value.split('/')[0], value.split('/').slice(1).join('/')];
    if (!orgSlug || !path) {
      throw new APIError(400, 'invalid_address', 'Use @host/work for your organization or org/host/work.');
    }

    const organization = await this.registry.getOrganizationBySlug(RequestData.normalizeOrgSlug(orgSlug));
    const found = await this.registry.findActiveAddressByPath(organization.id, RequestData.normalizePath(path));
    if (!found) {
      throw new APIError(404, 'address_not_found', 'Active address not found.');
    }
    return RegistryService.publicAddress(organization.slug, found);
  }

  async createLocalInstall(accountId: string, hostHandle: string): Promise<{ organization: OrganizationRow; host: AddressRow; code: string; expiresAt: string }> {
    const account = await this.accounts.getAccount(accountId);
    const organization = await this.accounts.requireOrganization(account);
    const host = await this.ensureHost(organization, hostHandle);
    const enrollment = await this.enrollments.create(organization, host.handle);

    return { organization, host, ...enrollment };
  }
}
