import { AccountProps } from './Authorize';
import { Env } from './Env';
import { APIError, RequestData } from './HTTP';

export class AccountAuthenticator {
  static async authenticate(request: Request, env: Env): Promise<AccountProps> {
    const token = RequestData.bearerToken(request, 'Bearer OAuth access token required.');
    const result = await env.OAUTH_PROVIDER.unwrapToken<AccountProps>(token);

    if (!result) {
      throw new APIError(401, 'invalid_token', 'OAuth access token is invalid or revoked.');
    }

    return result.grant.props;
  }
}
