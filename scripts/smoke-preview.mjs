#!/usr/bin/env node
// Read-only smoke against the isolated V2 Preview Worker. Never talks to production.
import assert from 'node:assert/strict';

const origin = process.env.AGENT_ADDRESS_V2_PREVIEW_URL;

if (!origin || !/^https:\/\/agent-address-v2-preview\.[a-z0-9-]+\.workers\.dev$/.test(origin)) {
  throw new Error('Only the explicit isolated agent-address-v2-preview workers.dev origin is accepted.');
}

async function request(path) {
  const response = await fetch(origin + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });

  console.log(path + ': HTTP ' + response.status);

  return response;
}

const metadata = await request('/.well-known/oauth-authorization-server');
assert.equal(metadata.status, 200, 'OAuth metadata must be available');
const oauth = await metadata.json();
assert(oauth.authorization_endpoint?.startsWith(origin + '/authorize'));
assert(oauth.token_endpoint?.startsWith(origin + '/token'));

const account = await request('/v2/account/status');
assert.equal(account.status, 401, 'Anonymous Account API must be denied');

const directory = await request('/v2/account/agents');
assert.equal(directory.status, 401, 'Anonymous Agent directory must be denied');

const adminAPI = await request('/admin/api/accounts');
assert.equal(adminAPI.status, 401, 'Anonymous admin API must be denied');

const admin = await request('/admin/');
assert.equal(admin.status, 200, 'Admin shell must load');
const html = await admin.text();
assert.match(html, /<div id="root"><\/div>/);

const assets = [...new Set([...html.matchAll(/\/ui\/assets\/[^"' ]+\.(?:js|css)/g)]
  .map((match) => match[0]))];
assert(assets.some((asset) => asset.endsWith('.js')), 'Admin shell needs a JavaScript bundle');

for (const asset of assets) {
  const response = await request(asset);
  assert.equal(response.status, 200, 'Missing admin asset: ' + asset);
}

console.log('PASS: Preview OAuth metadata, anonymous protection, admin shell and assets.');
