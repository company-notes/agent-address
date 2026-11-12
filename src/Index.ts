import OAuthProvider from '@cloudflare/workers-oauth-provider';

import { UIAssets } from './UIAssets';
import { AdminController } from './AdminController';
import { AuthorizeController } from './Authorize';
import { Env } from './Env';
import { ApplicationError } from './ApplicationError';
import { ResponseData } from './HTTP';
import { IdentityController } from './IdentityController';
import { AddressMCP } from './MCP';

export { AddressMCP } from './MCP';

// Deployment entrypoint: dispatches independently owned HTTP adapters.
// MCP and HTTP share IdentityController / domain services, never implementation shortcuts.
class ApplicationRouter {
  private static readonly CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
  };

  static async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    try {
      if (path.startsWith('/admin/api/')) {
        return await new AdminController(env).handle(request);
      }

      if (UIAssets.matches(path)) {
        return await UIAssets.handle(request, env);
      }

      if (path === AuthorizeController.PATH) {
        return await new AuthorizeController(env).handle(request);
      }

      if (path.startsWith('/v2/account/')) {
        return await this.accountAPI(request, env);
      }

      throw new ApplicationError(404, 'not_found', 'Resource not found.');
    } catch (error) {
      const response = ResponseData.error(error);
      if (path.startsWith('/v2/account/')) {
        response.headers.set('access-control-allow-origin', '*');
      }

      return response;
    }
  }

  private static async accountAPI(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: this.CORS_HEADERS });
    }

    const response = await new IdentityController(env).handle(request);
    response.headers.set('access-control-allow-origin', '*');

    return response;
  }
}

export default new OAuthProvider<Env>({
  apiHandlers: { '/mcp': AddressMCP.serve('/mcp') },
  defaultHandler: { fetch: (request: Request, env: Env) => ApplicationRouter.fetch(request, env) },
  authorizeEndpoint: AuthorizeController.PATH,
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
