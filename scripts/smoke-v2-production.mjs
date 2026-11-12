#!/usr/bin/env node
// Read-only live smoke against the production V2 Worker and custom domain.
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const endpoints = [
  'https://agent-address.nuwainfo.workers.dev',
  'https://address.company-notes.com',
];

async function get(origin, path) {
  const response = await fetch(origin + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });

  console.log(origin + path + ': HTTP ' + response.status);

  return response;
}

async function verifyOrigin(origin, checkAdminShell) {
  let metadata;

  for (let attempt = 0; attempt < 15; attempt++) {
    metadata = await get(origin, '/.well-known/oauth-authorization-server');

    if (metadata.status === 200 || metadata.status !== 404) {
      break;
    }

    await setTimeout(2000);
  }

  assert.equal(metadata.status, 200, 'OAuth discovery must be published.');
  const discovery = await metadata.json();
  assert.equal(discovery.issuer, origin, 'OAuth issuer must belong to the production origin.');
  assert.equal(discovery.authorization_endpoint, origin + '/authorize');

  const protectedResource = await get(origin, '/.well-known/oauth-protected-resource/mcp');
  assert.equal(protectedResource.status, 200, 'MCP resource metadata must be public.');

  const status = await get(origin, '/v2/account/status');
  assert.equal(status.status, 401, 'Account API must require OAuth.');

  const agents = await get(origin, '/v2/account/agents');
  assert.equal(agents.status, 401, 'Agent directory must require OAuth.');

  const homepage = await get(origin, '/');
  assert.equal(homepage.status, 302, 'Home page must direct users to Organization Portal.');
  assert.equal(homepage.headers.get('location'), origin + '/portal/');

  const portal = await get(origin, '/portal/');
  assert.equal(portal.status, 200, 'Organization Portal must be public before OAuth login.');
  const html = await portal.text();
  assert.match(html, /<div id="root"><\/div>/, 'Organization Portal SPA must render.');

  if (checkAdminShell) {
    const admin = await get(origin, '/admin/');
    assert.equal(admin.status, 200, 'Admin shell must be published on workers.dev.');

    const forbidden = await get(origin, '/admin/api/accounts');
    assert.equal(forbidden.status, 401, 'Admin API must require Cloudflare Access JWT.');

    const assets = [...new Set([...html.matchAll(/\/ui\/assets\/[^"' ]+\.(?:js|css)/g)]
      .map((match) => match[0]))];

    assert(assets.some((asset) => asset.endsWith('.js')), 'Organization Portal JS missing.');

    for (const asset of assets) {
      assert.equal((await get(origin, asset)).status, 200, 'Missing Portal bundle asset.');
    }
  } else {
    // Cloudflare Access may enforce admin protection before a request reaches the Worker.
    const admin = await get(origin, '/admin/');
    assert([302, 303, 401, 403].includes(admin.status),
      'Custom domain must protect the Admin page with Cloudflare Access.');
  }

  const legacy = await get(origin, '/v1/account/status');
  assert.equal(legacy.status, 404, 'V1 Account API must not remain active.');
}

for (let i = 0; i < endpoints.length; i++) {
  await verifyOrigin(endpoints[i], i === 0);
}

console.log('PASS: production V2 OAuth/MCP, Organization Portal, anonymous access checks, and V1 removal.');
