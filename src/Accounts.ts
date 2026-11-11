import { APIError } from './HTTP';
import { OrganizationRow, RegistryService } from './RegistryService';

export type AccountRow = {
  id: string;
  email: string;
  orgId: string | null;
  createdAt: string;
  authVersion: number;
};

type AccountCredentialRow = AccountRow & {
  passwordHash: string;
  passwordSalt: string;
};

export class PasswordHasher {
  static readonly ITERATIONS = 100000;
  static readonly MIN_LENGTH = 10;

  private static toHex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private static fromHex(hex: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
  }

  static async createCredentials(password: string): Promise<{ salt: string; hash: string }> {
    if (password.length < this.MIN_LENGTH) {
      throw new APIError(400, 'weak_password', `Password must be at least ${this.MIN_LENGTH} characters.`);
    }
    const salt = this.createSalt();
    return { salt, hash: await this.hash(password, salt) };
  }

  static createSalt(): string {
    return this.toHex(crypto.getRandomValues(new Uint8Array(16)));
  }

  static async hash(password: string, saltHex: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: this.fromHex(saltHex), iterations: this.ITERATIONS },
      key,
      256,
    );

    return this.toHex(new Uint8Array(bits));
  }

  static async verify(password: string, saltHex: string, expectedHash: string): Promise<boolean> {
    const actual = await this.hash(password, saltHex);
    if (actual.length !== expectedHash.length) {
      return false;
    }

    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) {
      difference |= actual.charCodeAt(index) ^ expectedHash.charCodeAt(index);
    }

    return difference === 0;
  }
}

// Human accounts that sign in through OAuth. One account owns at most one organization.
export class AccountService {
  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  private static readonly ACCOUNT_SELECT = `SELECT id, email, org_id AS orgId, created_at AS createdAt,
                                                   auth_version AS authVersion,
                                                   password_hash AS passwordHash, password_salt AS passwordSalt
                                              FROM accounts`;

  private static normalizeEmail(email: string): string {
    const value = email.trim().toLowerCase();
    if (value.length > 254 || !this.EMAIL_RE.test(value)) {
      throw new APIError(400, 'invalid_email', 'Enter a valid email address.');
    }

    return value;
  }

  private static publicAccount(row: AccountCredentialRow): AccountRow {
    return { id: row.id, email: row.email, orgId: row.orgId, createdAt: row.createdAt, authVersion: row.authVersion };
  }

  constructor(
    private readonly db: D1Database,
    private readonly registry: RegistryService,
    private readonly registrationKey?: string,
  ) {}

  private assertRegistrationKey(supplied: string | null): void {
    if (this.registrationKey && supplied !== this.registrationKey) {
      throw new APIError(403, 'registration_closed', 'Sign-up requires a valid registration key.');
    }
  }

  async signUp(
    email: string,
    password: string,
    suppliedRegistrationKey: string | null,
    linkedOrganization: OrganizationRow | null = null,
  ): Promise<AccountRow> {
    this.assertRegistrationKey(suppliedRegistrationKey);
    const normalizedEmail = AccountService.normalizeEmail(email);
    if (linkedOrganization) {
      await this.assertOrganizationUnowned(linkedOrganization.id);
    }

    const id = crypto.randomUUID();
    const credentials = await PasswordHasher.createCredentials(password);
    const createdAt = RegistryService.nowISO();
    try {
      await this.db
        .prepare(
          `INSERT INTO accounts (id, email, password_hash, password_salt, org_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, normalizedEmail, credentials.hash, credentials.salt, linkedOrganization?.id ?? null, createdAt)
        .run();
    } catch (error) {
      if (RegistryService.isUniqueViolation(error)) {
        throw new APIError(409, 'account_exists', 'An account with that email already exists.');
      }
      throw error;
    }

    return { id, email: normalizedEmail, orgId: linkedOrganization?.id ?? null, createdAt, authVersion: 0 };
  }

  async logIn(email: string, password: string): Promise<AccountRow> {
    const row = await this.db
      .prepare(`${AccountService.ACCOUNT_SELECT} WHERE email = ? COLLATE NOCASE`)
      .bind(email.trim())
      .first<AccountCredentialRow>();

    // Hash even for unknown emails so response time does not reveal which accounts exist.
    const salt = row?.passwordSalt ?? PasswordHasher.createSalt();
    const verified = await PasswordHasher.verify(password, salt, row?.passwordHash ?? '');
    if (!row || !verified) {
      throw new APIError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    return AccountService.publicAccount(row);
  }

  async getAccount(id: string): Promise<AccountRow> {
    const row = await this.db
      .prepare(`${AccountService.ACCOUNT_SELECT} WHERE id = ?`)
      .bind(id)
      .first<AccountCredentialRow>();
    if (!row) {
      throw new APIError(401, 'invalid_account', 'Account no longer exists.');
    }

    return AccountService.publicAccount(row);
  }

  async assertAuthVersion(accountId: string, version: number): Promise<void> {
    const account = await this.getAccount(accountId);
    if (account.authVersion !== version) {
      throw new APIError(401, 'authorization_revoked', 'This account must sign in again.');
    }
  }

  async findOrganization(account: AccountRow): Promise<OrganizationRow | null> {
    return account.orgId ? this.registry.getOrganizationById(account.orgId) : null;
  }

  async requireOrganization(account: AccountRow): Promise<OrganizationRow> {
    const organization = await this.findOrganization(account);
    if (!organization) {
      throw new APIError(
        409,
        'no_organization',
        'This account has no organization yet. Tell me the organization name to register.',
      );
    }

    return organization;
  }

  async registerOrganization(account: AccountRow, slug: string, displayName: string): Promise<OrganizationRow> {
    const current = await this.findOrganization(account);
    if (current) {
      throw new APIError(409, 'account_has_organization', `This account already owns organization ${current.slug}.`);
    }

    // The organization token is intentionally discarded: the account is the owner's credential.
    const issued = await this.registry.createOrganization(slug, displayName);
    await this.assignOrganization(account.id, issued.organization.id);

    return issued.organization;
  }

  async verifyOrganizationToken(slug: string, orgToken: string): Promise<OrganizationRow> {
    const organization = await this.registry.getOrganizationBySlug(slug);
    const credential = await this.registry.authenticate(orgToken, 'org');
    if (credential.orgId !== organization.id) {
      throw new APIError(403, 'wrong_organization', 'Organization token does not belong to that organization.');
    }

    return organization;
  }

  async linkOrganization(account: AccountRow, slug: string, orgToken: string): Promise<OrganizationRow> {
    const current = await this.findOrganization(account);
    if (current) {
      throw new APIError(409, 'account_has_organization', `This account already owns organization ${current.slug}.`);
    }

    const organization = await this.verifyOrganizationToken(slug, orgToken);
    await this.assignOrganization(account.id, organization.id);

    return organization;
  }

  private async assertOrganizationUnowned(orgId: string): Promise<void> {
    const owner = await this.db.prepare('SELECT id FROM accounts WHERE org_id = ?').bind(orgId).first();
    if (owner) {
      throw new APIError(409, 'organization_owned', 'That organization already belongs to another account.');
    }
  }

  private async assignOrganization(accountId: string, orgId: string): Promise<void> {
    try {
      await this.db.prepare('UPDATE accounts SET org_id = ? WHERE id = ?').bind(orgId, accountId).run();
    } catch (error) {
      if (RegistryService.isUniqueViolation(error)) {
        throw new APIError(409, 'organization_owned', 'That organization already belongs to another account.');
      }
      throw error;
    }
  }
}
