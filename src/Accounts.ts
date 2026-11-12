import { APIError } from './HTTP';

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
      throw new APIError(400, 'weak_password', `Password must be at least ${this.MIN_LENGTH} characters.`);
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
  private static readonly SELECT = `
    SELECT id, email, org_id AS orgId, created_at AS createdAt,
           auth_version AS authVersion, password_hash AS passwordHash,
           password_salt AS passwordSalt
      FROM accounts`;

  constructor(
    private readonly db: D1Database,
    private readonly registrationKey?: string,
  ) {}

  private static publicAccount(row: AccountCredentialRow): AccountRow {
    const { passwordHash, passwordSalt, ...account } = row;

    return account;
  }

  async signUp(email: string, password: string, registrationKey: string | null): Promise<AccountRow> {
    if (this.registrationKey && registrationKey !== this.registrationKey) {
      throw new APIError(403, 'registration_closed', 'Sign-up requires a valid registration key.');
    }

    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !AccountService.EMAIL_RE.test(normalized)) {
      throw new APIError(400, 'invalid_email', 'Enter a valid email address.');
    }

    const id = crypto.randomUUID();
    const { hash, salt } = await PasswordHasher.createCredentials(password);
    const createdAt = new Date().toISOString();

    try {
      await this.db.prepare(
        `INSERT INTO accounts (id, email, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, normalized, hash, salt, createdAt).run();
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed: accounts.email')) {
        console.debug('Account email collision:', error);
        throw new APIError(409, 'account_exists', 'An account with that email already exists.');
      }

      throw error;
    }

    return { id, email: normalized, orgId: null, createdAt, authVersion: 0 };
  }

  async logIn(email: string, password: string): Promise<AccountRow> {
    const row = await this.db.prepare(
      `${AccountService.SELECT} WHERE email = ? COLLATE NOCASE`,
    ).bind(email.trim()).first<AccountCredentialRow>();

    const salt = row?.passwordSalt ?? PasswordHasher.createSalt();
    const valid = await PasswordHasher.verify(password, salt, row?.passwordHash ?? '');

    if (!row || !valid) {
      throw new APIError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    return AccountService.publicAccount(row);
  }

  async getAccount(id: string): Promise<AccountRow> {
    const row = await this.db.prepare(
      `${AccountService.SELECT} WHERE id = ?`,
    ).bind(id).first<AccountCredentialRow>();

    if (!row) {
      throw new APIError(401, 'invalid_account', 'Account no longer exists.');
    }

    return AccountService.publicAccount(row);
  }

  async assertAuthVersion(accountID: string, authVersion: number): Promise<void> {
    const account = await this.getAccount(accountID);

    if (account.authVersion !== authVersion) {
      throw new APIError(401, 'authorization_revoked', 'This account must sign in again.');
    }
  }
}
