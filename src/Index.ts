import OAuthProvider from '@cloudflare/workers-oauth-provider';

import { AuthorizeController } from './Authorize';
import { Env } from './Env';
import { ResponseData } from './HTTP';
import { AddressMCP } from './MCP';
import { APIRouter } from './RestAPI';

export { AddressMCP } from './MCP';

// Everything that is not an OAuth endpoint or an authenticated /mcp call: the login page and the REST API.
class PublicRoutes {
  static readonly CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-registration-key',
    'access-control-max-age': '86400',
  };

  private static async handleREST(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: this.CORS_HEADERS });
    }

    const response = await new APIRouter(env).handle(request);
    response.headers.set('access-control-allow-origin', '*');

    return response;
  }

  static async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (new URL(request.url).pathname === AuthorizeController.PATH) {
        return await new AuthorizeController(env).handle(request);
      }
      return await this.handleREST(request, env);
    } catch (error) {
      const response = ResponseData.error(error);
      response.headers.set('access-control-allow-origin', '*');
      return response;
    }
  }
}

export default new OAuthProvider<Env>({
  apiHandlers: { '/mcp': AddressMCP.serve('/mcp') },
  defaultHandler: { fetch: (request: Request, env: Env) => PublicRoutes.fetch(request, env) },
  authorizeEndpoint: AuthorizeController.PATH,
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
