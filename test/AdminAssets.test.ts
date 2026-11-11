import { describe, expect, it } from 'vitest';

import { AdminAssets } from '../src/AdminAssets';
import type { Env } from '../src/Env';

describe('admin static assets binding', () => {
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
    expect(AdminAssets.matches('/admin')).toBe(true);
    expect(AdminAssets.matches('/admin/')).toBe(true);
    expect(AdminAssets.matches('/admin/assets/index.js')).toBe(true);
    expect(AdminAssets.matches('/administrator')).toBe(false);
    expect(AdminAssets.matches('/authorize')).toBe(false);
    expect(AdminAssets.matches('/mcp')).toBe(false);
    expect(AdminAssets.matches('/token')).toBe(false);
    expect(AdminAssets.matches('/v1/admin/accounts')).toBe(false);
  });

  it('serves the SPA shell and Vite bundle files at their root binding locations', async () => {
    const shell = await AdminAssets.handle(new Request(host + '/admin/'), env);
    const bundle = await AdminAssets.handle(new Request(host + '/admin/assets/index.js'), env);

    expect(shell.status).toBe(200);
    expect(await shell.text()).toBe('asset: /index.html');
    expect(bundle.status).toBe(200);
    expect(await bundle.text()).toBe('asset: /assets/index.js');
    expect(requests).toContain('/index.html');
    expect(requests).toContain('/assets/index.js');
  });

  it('redirects the admin entry path without exposing a root asset URL', async () => {
    const result = await AdminAssets.handle(new Request(host + '/admin'), env);
    expect(result.status).toBe(308);
    expect(result.headers.get('location')).toBe(host + '/admin/');
  });

  it('disallows mutation methods on static assets', async () => {
    const mutation = await AdminAssets.handle(new Request(host + '/admin/', { method: 'POST' }), env);

    expect(mutation.status).toBe(405);
  });
});
