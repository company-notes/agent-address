import type { Env } from './Env';

// UI delivery adapter only: the Worker routes /admin/* to the asset binding.
// API authorization and business logic remain outside this class.
export class AdminAssets {
  static matches(pathname: string): boolean {
    return pathname === '/admin' || pathname.startsWith('/admin/');
  }

  static async handle(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    if (!env.ASSETS) {
      return new Response('Admin UI is not configured.', { status: 503 });
    }

    const assetUrl = new URL(request.url);
    if (assetUrl.pathname === '/admin') {
      assetUrl.pathname = '/admin/';
      return Response.redirect(assetUrl.toString(), 308);
    }

    assetUrl.pathname = assetUrl.pathname === '/admin/'
      ? '/index.html'
      : assetUrl.pathname.slice('/admin'.length);

    return await env.ASSETS.fetch(new Request(assetUrl, request));
  }
}
