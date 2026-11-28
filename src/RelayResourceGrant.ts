import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import { ApplicationError } from './ApplicationError';
import type { Env } from './Env';
import type { IdentityService } from './IdentityService';

export type RelayResource = {
  resource: string;
  sessionID: string;
};

/** A Relay resource grant pins an existing identity, not a mutable address lookup. */
export class RelayResourceGrant {
  private static readonly prefix = 'https://mcp.agent-relay.company-notes.com/mcp/';
  private static readonly addressPattern = /^[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}$/;

  static address(resource: string | string[] | undefined): string | undefined {
    const resources = Array.isArray(resource) ? resource : resource ? [resource] : [];
    const targeted = resources.filter((value) => value.startsWith(this.prefix));

    if (!targeted.length) {
      return undefined;
    }

    const address = targeted[0].slice(this.prefix.length);

    if (resources.length !== 1 || !this.addressPattern.test(address)) {
      throw new ApplicationError(400, 'invalid_relay_resource', 'Use one complete existing Nuwa address as the Relay resource.');
    }

    return address;
  }

  static async authorize(
    request: AuthRequest, accountID: string, identities: IdentityService,
  ): Promise<RelayResource | undefined> {
    const address = this.address(request.resource);

    if (!address) {
      return undefined;
    }

    const session = await identities.resolve(accountID, address);

    return { resource: this.prefix + address, sessionID: session.id };
  }

  static assertAudience(grant: RelayResource | undefined, audience: string | string[] | undefined): void {
    const address = this.address(audience);

    if (address !== undefined && (!grant || grant.resource !== this.prefix + address) ||
        grant && (address === undefined || !grant.sessionID)) {
      throw new ApplicationError(401, 'invalid_relay_resource', 'The token does not authorize this Relay resource.');
    }
  }

  static assertAccountRequest(grant: RelayResource | undefined, request: Request): void {
    if (!grant || request.method === 'GET') {
      return;
    }

    const path = new URL(request.url).pathname;
    const sessionPath = '/v2/account/sessions/' + encodeURIComponent(grant.sessionID);

    if (path === sessionPath + '/owner-runtime-lease' && request.method === 'PUT' ||
        path === sessionPath + '/runtime-lease' && ['PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      return;
    }

    throw new ApplicationError(403, 'relay_resource_restricted', 'This Relay authorization only manages its selected Session Runtime.');
  }

  /** Replace only grants in the same resource partition, preserving other connectors. */
  static async previous(
    env: Env, accountID: string, request: AuthRequest, resource: RelayResource | undefined,
  ): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await env.OAUTH_PROVIDER.listUserGrants(accountID, { cursor, limit: 50 });

      for (const grant of page.items) {
        if (grant.clientId === request.clientId &&
            (!request.clientId.startsWith('https://') || grant.redirectUri === request.redirectUri) &&
            (grant.metadata?.relayResourceSessionID ?? undefined) === resource?.sessionID) {
          ids.push(grant.id);
        }
      }
      cursor = page.cursor;
    } while (cursor);

    return ids;
  }
}
