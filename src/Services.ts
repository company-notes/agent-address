import { AccountService } from './Accounts';
import { Env } from './Env';
import { IdentityService } from './IdentityService';
import { OrganizationService, type OrganizationScope } from './Organizations';
import { RuntimeLeaseService } from './RuntimeLeaseService';

// Composition root. The HTTP API and MCP use these same services.
export class Services {
  readonly accounts: AccountService;
  readonly organizations: OrganizationService;
  readonly leases: RuntimeLeaseService;
  readonly identities: IdentityService;

  constructor(env: Env, scope?: OrganizationScope) {
    this.accounts = new AccountService(env.DB, env.REGISTRATION_KEY);
    this.organizations = new OrganizationService(env.DB, scope);
    this.leases = new RuntimeLeaseService(env.DB);
    this.identities = new IdentityService(env.DB, this.organizations, this.leases);
  }
}
