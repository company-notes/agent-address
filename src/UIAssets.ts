import type { Env } from './Env';

// Public UI asset delivery. Authentication belongs to API controllers;
// Cloudflare Access protects the internal /admin/ entrypoint at the edge.
export class UIAssets {
  static matches(pathname: string): boolean {
    if (pathname === '/admin/api' || pathname.startsWith('/admin/api/')) {
      return false;
    }

    return pathname === '/admin' ||
      pathname.startsWith('/admin/') ||
      pathname === '/portal' ||
      pathname.startsWith('/portal/') ||
      pathname.startsWith('/ui/');
  }

  private static assetPath(pathname: string): string {
    if (pathname.startsWith('/ui/')) {
      return pathname.slice('/ui'.length);
    }

    return '/index.html';
  }

  static async handle(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    const url = new URL(request.url);
    if (url.pathname === '/admin' || url.pathname === '/portal') {
      url.pathname += '/';

      return Response.redirect(url.toString(), 308);
    }

    const html = !url.pathname.startsWith('/ui/');
    url.pathname = this.assetPath(url.pathname);

    const response = await env.ASSETS.fetch(new Request(url, request));
    if (!html) {
      return response;
    }

    const document = new Response(response.body, response);
    document.headers.set('cache-control', 'no-store');
    document.headers.set('x-frame-options', 'DENY');
    document.headers.set('x-content-type-options', 'nosniff');

    return document;
  }
}
