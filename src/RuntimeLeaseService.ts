import { APIError } from './HTTP';
import { TokenService } from './Tokens';

export type InitialLease = {
  statement: D1PreparedStatement;
  runtimeToken: string;
  expiresAt: string;
};

export type AcquiredLease = {
  runtimeToken: string;
  expiresAt: string;
};

// Runtime ownership is a capability with a renewable lease, not an Agent identity.
// The conditional SQL update is the concurrency boundary: only one caller can win resume.
export class RuntimeLeaseService {
  static readonly LEASE_MS = 15 * 60 * 1000;

  constructor(private readonly db: D1Database) {}

  private static expiration(now: Date): string {
    return new Date(now.getTime() + this.LEASE_MS).toISOString();
  }

  async prepareInitialLease(sessionID: string, runtimeLabel: string | null): Promise<InitialLease> {
    const now = new Date();
    const expiresAt = RuntimeLeaseService.expiration(now);
    const runtimeToken = TokenService.randomToken('runtime');
    const tokenHash = await TokenService.sha256Hex(runtimeToken);

    const statement = this.db.prepare(
      `INSERT INTO session_runtime_leases
        (session_id, runtime_token_hash, runtime_label, refreshed_at, expires_at)
        VALUES (?, ?, ?, ?, ?)`,
    ).bind(sessionID, tokenHash, runtimeLabel, now.toISOString(), expiresAt);

    return { statement, runtimeToken, expiresAt };
  }

  async resume(sessionID: string, runtimeLabel: string | null): Promise<AcquiredLease> {
    const now = new Date();
    const expiresAt = RuntimeLeaseService.expiration(now);
    const runtimeToken = TokenService.randomToken('runtime');
    const tokenHash = await TokenService.sha256Hex(runtimeToken);

    const result = await this.db.prepare(
      `INSERT INTO session_runtime_leases
        (session_id, runtime_token_hash, runtime_label, refreshed_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          runtime_token_hash = excluded.runtime_token_hash,
          runtime_label = excluded.runtime_label,
          refreshed_at = excluded.refreshed_at,
          expires_at = excluded.expires_at
        WHERE session_runtime_leases.expires_at <= excluded.refreshed_at`,
    ).bind(
      sessionID,
      tokenHash,
      runtimeLabel,
      now.toISOString(),
      expiresAt,
    ).run();

    if (result.meta.changes !== 1) {
      throw new APIError(
        409,
        'session_in_use',
        'This Session already has an active Runtime. Use a new Agent/Session address instead.',
      );
    }

    return { runtimeToken, expiresAt };
  }

  async renew(sessionID: string, runtimeToken: string): Promise<{ expiresAt: string }> {
    const now = new Date();
    const expiresAt = RuntimeLeaseService.expiration(now);
    const tokenHash = await TokenService.sha256Hex(runtimeToken);

    // A former holder may renew only if no resume has replaced its token.
    const result = await this.db.prepare(
      `UPDATE session_runtime_leases
          SET refreshed_at = ?, expires_at = ?
        WHERE session_id = ? AND runtime_token_hash = ? AND expires_at > ?`,
    ).bind(now.toISOString(), expiresAt, sessionID, tokenHash, now.toISOString()).run();

    if (result.meta.changes !== 1) {
      throw new APIError(409, 'runtime_not_owner', 'This Runtime no longer owns the Session.');
    }

    return { expiresAt };
  }

  async release(sessionID: string, runtimeToken: string): Promise<void> {
    const tokenHash = await TokenService.sha256Hex(runtimeToken);
    const now = new Date().toISOString();

    const result = await this.db.prepare(
      `UPDATE session_runtime_leases
          SET expires_at = ?, refreshed_at = ?
        WHERE session_id = ? AND runtime_token_hash = ? AND expires_at > ?`,
    ).bind(now, now, sessionID, tokenHash, now).run();

    if (result.meta.changes !== 1) {
      throw new APIError(409, 'runtime_not_owner', 'This Runtime no longer owns an active Session lease.');
    }
  }
}
