import { describe, expect, it } from 'vitest';

import { UIAssets } from '../src/UIAssets';
import type { Env } from '../src/Env';

describe('UI static assets binding', () => {
  const requests: string[] = [];
  const assets = {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      requests.push(path);
      return new Response('asset: ' + path, { status: 200 });
    },
  } as unknown as Fetcher;

  const env = { ASSETS: assets } as Env;
  const host = 'https://address.company-notes.com';

  it('matches only the admin URL prefix, never public OAuth or MCP routes', () => {
    expect(UIAssets.matches('/admin')).toBe(true);
    expect(UIAssets.matches('/admin/')).toBe(true);
    expect(UIAssets.matches('/ui/assets/index.js')).toBe(true);
    expect(UIAssets.matches('/administrator')).toBe(false);
    expect(UIAssets.matches('/authorize')).toBe(false);
    expect(UIAssets.matches('/mcp')).toBe(false);
    expect(UIAssets.matches('/token')).toBe(false);
    expect(UIAssets.matches('/v2/account/agents')).toBe(false);
    expect(UIAssets.matches('/admin/api')).toBe(false);
    expect(UIAssets.matches('/admin/api/accounts')).toBe(false);
    expect(UIAssets.matches('/portal/')).toBe(true);
    expect(UIAssets.matches('/ui/assets/index.js')).toBe(true);
  });

  it('serves the SPA shell and Vite bundle files at their root binding locations', async () => {
    const shell = await UIAssets.handle(new Request(host + '/admin/'), env);
    const bundle = await UIAssets.handle(new Request(host + '/ui/assets/index.js'), env);

    expect(shell.status).toBe(200);
    expect(await shell.text()).toBe('asset: /index.html');
    expect(bundle.status).toBe(200);
    expect(await bundle.text()).toBe('asset: /assets/index.js');
    expect(requests).toContain('/index.html');
    expect(requests).toContain('/assets/index.js');
  });

  it('redirects canonical UI entry paths', async () => {
    const result = await UIAssets.handle(new Request(host + '/admin'), env);
    expect(result.status).toBe(308);
    expect(result.headers.get('location')).toBe(host + '/admin/');

    const portal = await UIAssets.handle(new Request(host + '/portal'), env);
    expect(portal.headers.get('location')).toBe(host + '/portal/');
  });

  it('disallows mutation methods on static assets', async () => {
    const mutation = await UIAssets.handle(new Request(host + '/admin/', { method: 'POST' }), env);

    expect(mutation.status).toBe(405);
  });
});
