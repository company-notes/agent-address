import { AccountProps } from './Authorize';
import { Env } from './Env';
import { IdentityController } from './IdentityController';

type APIResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// MCP is an in-process consumer of the same HTTP controller as external clients.
// The OAuth grant identity is forwarded, not an invented bearer credential.
export class IdentityAPIClient {
  constructor(
    private readonly env: Env,
    private readonly identity: AccountProps,
  ) {}

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = body === undefined ? {} : { 'content-type': 'application/json' };
    const request = new Request(`https://account.internal${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const response = await new IdentityController(this.env).handleAuthenticated(
      this.identity.accountId,
      request,
      this.identity.authVersion,
    );
    const result = await response.json() as APIResult<T>;

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return result.data;
  }
}
