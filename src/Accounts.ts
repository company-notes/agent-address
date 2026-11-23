import { ApplicationError } from './ApplicationError';
import { IdentityNames } from './IdentityNames';
import type { OrganizationRow } from './Organizations';

export type AccountRow = {
  id: string;
  email: string;
  orgId: string | null;
  createdAt: string;
  authVersion: number;
};

type AccountOrganizationRow = AccountRow & {
  organizationID: string | null;
  organizationSlug: string;
  organizationDisplayName: string;
  organizationCreatedAt: string;
};

export type AuthenticatedAccount = {
  account: AccountRow;
  organization: OrganizationRow | null;
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

  static createSalt(): string {
    return this.toHex(crypto.getRandomValues(new Uint8Array(16)));
  }

  static async hash(password: string, saltHex: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: this.fromHex(saltHex),
        iterations: this.ITERATIONS,
      },
      key,
      256,
    );

    return this.toHex(new Uint8Array(bits));
  }

  static async createCredentials(password: string): Promise<{ salt: string; hash: string }> {
    if (password.length < this.MIN_LENGTH) {
      throw new ApplicationError(400, 'weak_password', `Password must be at least ${this.MIN_LENGTH} characters.`);
    }

    const salt = this.createSalt();

    return { salt, hash: await this.hash(password, salt) };
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

export class AccountService {
  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private static readonly PUBLIC_COLUMNS =
    'a.id, a.email, a.org_id AS orgId, a.created_at AS createdAt, a.auth_version AS authVersion';
  private static readonly CREDENTIAL_SELECT = `
    SELECT ${AccountService.PUBLIC_COLUMNS}, a.password_hash AS passwordHash,
           a.password_salt AS passwordSalt
      FROM accounts a`;

  constructor(
    private readonly db: D1Database,
    private readonly registrationKey?: string,
  ) {}

  private static publicAccount(row: AccountCredentialRow): AccountRow {
    const { passwordHash, passwordSalt, ...account } = row;

    return account;
  }

  private static requireAuthVersion(account: AccountRow, authVersion: number): void {
    if (account.authVersion !== authVersion) {
      throw new ApplicationError(401, 'authorization_revoked', 'This account must sign in again.');
    }
  }

  async signUp(
    email: string, password: string, registrationKey: string | null,
    organizationSlug: string, organizationName: string,
  ): Promise<AccountRow> {
    if (this.registrationKey && registrationKey !== this.registrationKey) {
      throw new ApplicationError(403, 'registration_closed', 'Sign-up requires a valid registration key.');
    }

    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !AccountService.EMAIL_RE.test(normalized)) {
      throw new ApplicationError(400, 'invalid_email', 'Enter a valid email address.');
    }

    const slug = IdentityNames.organizationSlug(organizationSlug);
    const displayName = IdentityNames.organizationDisplayName(organizationName);
    const id = crypto.randomUUID();
    const organizationID = crypto.randomUUID();
    const { hash, salt } = await PasswordHasher.createCredentials(password);
    const createdAt = new Date().toISOString();

    // D1 batch is atomic: a duplicate name or email cannot leave a partial account.
    try {
      await this.db.batch([
        this.db.prepare(
          'INSERT INTO organizations (id, slug, display_name, created_at) VALUES (?, ?, ?, ?)',
        ).bind(organizationID, slug, displayName, createdAt),
        this.db.prepare(
          `INSERT INTO accounts (id, email, password_hash, password_salt, org_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(id, normalized, hash, salt, organizationID, createdAt),
      ]);
    } catch (error) {
      const failure = String(error);
      if (failure.includes('UNIQUE constraint failed: accounts.email')) {
        console.debug('Account email collision:', error);
        throw new ApplicationError(409, 'account_exists', 'An account with that email already exists.');
      }

      if (failure.includes('UNIQUE constraint failed: organizations.slug') ||
          failure.includes('idx_organizations_unique_display_name')) {
        console.debug('Organization name collision:', error);
        throw new ApplicationError(409, 'organization_name_taken', 'Organization name is already registered.');
      }

      throw error;
    }

    return { id, email: normalized, orgId: organizationID, createdAt, authVersion: 0 };
  }

  async logIn(email: string, password: string): Promise<AccountRow> {
    const row = await this.db.prepare(
      `${AccountService.CREDENTIAL_SELECT} WHERE a.email = ? COLLATE NOCASE`,
    ).bind(email.trim()).first<AccountCredentialRow>();

    const salt = row?.passwordSalt ?? PasswordHasher.createSalt();
    const valid = await PasswordHasher.verify(password, salt, row?.passwordHash ?? '');

    if (!row || !valid) {
      throw new ApplicationError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    return AccountService.publicAccount(row);
  }

  async getAccount(id: string): Promise<AccountRow> {
    const row = await this.db.prepare(
      `SELECT ${AccountService.PUBLIC_COLUMNS} FROM accounts a WHERE a.id = ?`,
    ).bind(id).first<AccountRow>();

    if (!row) {
      throw new ApplicationError(401, 'invalid_account', 'Account no longer exists.');
    }

    return row;
  }

  async assertAuthVersion(accountID: string, authVersion: number): Promise<AccountRow> {
    const account = await this.getAccount(accountID);
    AccountService.requireAuthVersion(account, authVersion);

    return account;
  }

  async authenticatedAccount(accountID: string, authVersion: number): Promise<AuthenticatedAccount> {
    const row = await this.db.prepare(
      `SELECT ${AccountService.PUBLIC_COLUMNS}, o.id AS organizationID, o.slug AS organizationSlug,
              o.display_name AS organizationDisplayName, o.created_at AS organizationCreatedAt
         FROM accounts a LEFT JOIN organizations o ON o.id = a.org_id WHERE a.id = ?`,
    ).bind(accountID).first<AccountOrganizationRow>();

    if (!row) {
      throw new ApplicationError(401, 'invalid_account', 'Account no longer exists.');
    }

    AccountService.requireAuthVersion(row, authVersion);

    const { organizationID, organizationSlug, organizationDisplayName, organizationCreatedAt,
      ...account } = row;

    return {
      account,
      organization: organizationID === null ? null : {
        id: organizationID, slug: organizationSlug,
        displayName: organizationDisplayName, createdAt: organizationCreatedAt,
      },
    };
  }
}
