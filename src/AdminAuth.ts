import { createRemoteJWKSet, jwtVerify } from 'jose';

import { Env } from './Env';
import { APIError } from './HTTP';

// Authentication for internal administrators is separate from account OAuth and from the UI.
// Cloudflare Access protects /admin/*, including /admin/api/*, at the edge.
export class AdminAuthenticator {
  private static readonly TEAM_NAME_RE = /^[a-z0-9-]+$/;
  private static readonly jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  private static getJWKSet(teamName: string): ReturnType<typeof createRemoteJWKSet> {
    let jwks = this.jwksByTeam.get(teamName);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`https://${teamName}.cloudflareaccess.com/cdn-cgi/access/certs`));
      this.jwksByTeam.set(teamName, jwks);
    }
    return jwks;
  }

  async authenticate(request: Request, env: Env): Promise<string> {
    const teamName = env.ADMIN_ACCESS_TEAM_NAME?.trim() ?? '';
    const audience = env.ADMIN_ACCESS_AUDIENCE?.trim() ?? '';
    const allowed = (env.ADMIN_ALLOWED_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);

    if (!AdminAuthenticator.TEAM_NAME_RE.test(teamName) || !audience || allowed.length === 0) {
      throw new APIError(503, 'admin_unconfigured', 'Administration is not configured.');
    }

    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) {
      throw new APIError(401, 'admin_unauthorized', 'Cloudflare Access authentication required.');
    }

    let email: string;
    try {
      const verified = await jwtVerify(token, AdminAuthenticator.getJWKSet(teamName), {
        issuer: `https://${teamName}.cloudflareaccess.com`,
        audience,
        algorithms: ['RS256'],
      });
      email = typeof verified.payload.email === 'string' ? verified.payload.email.trim().toLowerCase() : '';
    } catch (error) {
      console.debug('Cloudflare Access JWT verification failed:', error);
      throw new APIError(401, 'admin_unauthorized', 'Cloudflare Access token is invalid.');
    }

    if (!email || !allowed.includes(email)) {
      throw new APIError(403, 'admin_forbidden', 'This identity is not an administrator.');
    }
    return email;
  }

  static assertSafeMutation(request: Request): void {
    const origin = request.headers.get('origin');
    const expectedOrigin = new URL(request.url).origin;
    const fetchSite = request.headers.get('sec-fetch-site');

    if (origin !== expectedOrigin || (fetchSite && fetchSite !== 'same-origin')) {
      throw new APIError(403, 'admin_cross_origin', 'Administration changes require a same-origin request.');
    }
  }
}
