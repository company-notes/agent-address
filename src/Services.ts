import { AccountService } from './Accounts';
import { Env } from './Env';
import { EnrollmentService } from './Enrollments';
import { RegistryService } from './RegistryService';
import { SessionAddressService } from './Sessions';

// Composition root for the domain services that share one D1 database.
export class Services {
  readonly registry: RegistryService;
  readonly accounts: AccountService;
  readonly enrollments: EnrollmentService;
  readonly sessions: SessionAddressService;

  constructor(env: Env) {
    this.registry = new RegistryService(env.DB);
    this.accounts = new AccountService(env.DB, this.registry, env.REGISTRATION_KEY);
    this.enrollments = new EnrollmentService(env.DB, this.registry);
    this.sessions = new SessionAddressService(this.accounts, this.registry, this.enrollments);
  }
}
