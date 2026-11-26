import type { AccountRow } from './Accounts';
import { TokenService } from './Tokens';

export class BrowserSessions {
  private static readonly COOKIE_NAME = '__Host-nuwa_address_browser';
  private static readonly TTL_SECONDS = 30 * 60;

  constructor(private readonly db: D1Database) {}

  private static token(request: Request): string | undefined {
    const prefix = BrowserSessions.COOKIE_NAME + '=';
    const token = (request.headers.get('cookie') ?? '').split(';')
      .map((value) => value.trim()).find((value) => value.startsWith(prefix))?.slice(prefix.length);

    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  }

  async account(request: Request): Promise<AccountRow | null> {
    const token = BrowserSessions.token(request);

    if (!token) {
      return null;
    }

    return this.db.prepare(
      `SELECT a.id, a.email, a.org_id AS orgId, a.created_at AS createdAt, a.auth_version AS authVersion
         FROM browser_sessions b JOIN accounts a ON a.id = b.account_id
        WHERE b.token_hash = ? AND b.expires_at > ? AND b.auth_version = a.auth_version`,
    ).bind(await TokenService.sha256Hex(token), Date.now()).first<AccountRow>();
  }

  async issue(request: Request, account: AccountRow): Promise<string> {
    const token = TokenService.base64URL(crypto.getRandomValues(new Uint8Array(32)));
    const previous = BrowserSessions.token(request);
    const now = Date.now();
    const statements = [
      this.db.prepare('DELETE FROM browser_sessions WHERE expires_at <= ?').bind(now),
    ];

    if (previous) {
      statements.push(this.db.prepare('DELETE FROM browser_sessions WHERE token_hash = ?')
        .bind(await TokenService.sha256Hex(previous)));
    }

    statements.push(this.db.prepare(
      'INSERT INTO browser_sessions (token_hash, account_id, auth_version, expires_at) VALUES (?, ?, ?, ?)',
    ).bind(await TokenService.sha256Hex(token), account.id, account.authVersion,
      now + BrowserSessions.TTL_SECONDS * 1000));
    await this.db.batch(statements);

    return BrowserSessions.COOKIE_NAME + '=' + token +
      '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + BrowserSessions.TTL_SECONDS;
  }
}
