#!/usr/bin/env node
// Read-only live smoke checks. No passwords, session cookies, or database writes.
import assert from 'node:assert/strict';

const WORKER = 'https://agent-address.nuwainfo.workers.dev';
const DOMAIN = 'https://address.company-notes.com';

async function get(path, origin = WORKER, init = {}) {
  const response = await fetch(origin + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    ...init,
  });
  const location = response.headers.get('location');
  const redirect = location ? ' → ' + location.slice(0, 115) : '';

  console.log(origin + path + ': HTTP ' + response.status + redirect);

  return response;
}

const htmlResponse = await get('/admin/');
assert.equal(htmlResponse.status, 200, 'Admin shell must return HTTP 200, not redirect to public root');
const html = await htmlResponse.text();
assert.match(html, /<div id="root"><\/div>/, 'Admin shell must render the React mount point');
assert.match(html, /\/admin\/assets\/[^"' ]+\.js/, 'Admin shell must link prefixed JavaScript');
const scripts = [...html.matchAll(/\/admin\/assets\/[^"' ]+\.js/g)].map(x => x[0]);
const styles = [...html.matchAll(/\/admin\/assets\/[^"' ]+\.css/g)].map(x => x[0]);
assert(scripts.length > 0, 'At least one JS bundle must be linked');
for (const asset of [...scripts, ...styles]) {
  const response = await get(asset);
  assert.equal(response.status, 200, 'Admin bundled asset must be available: ' + asset);
}

const forbidden = await get('/admin/api/accounts');
assert.equal(forbidden.status, 401, 'Admin API must refuse anonymous workers.dev requests');

const anonymousIdentity = await get('/v2/account/agents');
assert.equal(anonymousIdentity.status, 401, 'Identity API must require OAuth');

const metadata = await get('/.well-known/oauth-authorization-server');
assert.equal(metadata.status, 200, 'OAuth metadata must remain accessible');
const oauth = await metadata.json();
assert(oauth.authorization_endpoint?.endsWith('/authorize'), 'OAuth authorize endpoint must be advertised');

const protectedAdmin = await get('/admin/', DOMAIN);
assert([302, 303, 401, 403].includes(protectedAdmin.status), 'Custom Domain admin page must require Cloudflare Access');

const protectedAPI = await get('/admin/api/accounts', DOMAIN);
assert([302, 303, 401, 403].includes(protectedAPI.status), 'Custom Domain admin API must require Cloudflare Access');

const publicMetadata = await get('/.well-known/oauth-authorization-server', DOMAIN);
assert.equal(publicMetadata.status, 200, 'Cloudflare Access must not block public OAuth metadata');

console.log('PASS: live Admin shell, JS/CSS assets, Access edge, anonymous Admin/Identity API denial, OAuth metadata');
