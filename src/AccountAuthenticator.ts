import { AccountProps } from './Authorize';
import { Env } from './Env';
import { ApplicationError } from './ApplicationError';
import { RequestData } from './HTTP';
import { RelayResourceGrant } from './RelayResourceGrant';

export type OAuthGrantIdentity = AccountProps & { grantFingerprint: string };

export class AccountAuthenticator {
  static async authenticate(request: Request, env: Env): Promise<OAuthGrantIdentity> {
    const token = RequestData.bearerToken(request, 'Bearer OAuth access token required.');
    const result = await env.OAUTH_PROVIDER.unwrapToken<AccountProps>(token);

    if (!result) {
      throw new ApplicationError(401, 'invalid_token', 'OAuth access token is invalid or revoked.');
    }

    const props = result.grant.props;

    if (!props || typeof props.accountId !== 'string' ||
        props.accountId !== result.userId || typeof result.grantId !== 'string' ||
        !result.grantId) {
      throw new ApplicationError(401, 'invalid_token', 'OAuth access token is invalid or revoked.');
    }

    RelayResourceGrant.assertAudience(props.relayResource, result.audience);

    // Grant ID is authoritative provider state, unlike a rotating access token
    // or an Account email. Expose only a purpose-scoped irreversible fingerprint.
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
      'nuwa-relay-grant-v1:' + result.userId + ':' + result.grantId,
    ));
    const grantFingerprint = Array.from(new Uint8Array(bytes),
      (byte) => byte.toString(16).padStart(2, '0')).join('');

    return { ...props, grantFingerprint };
  }
}
