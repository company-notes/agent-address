#!/usr/bin/env node
// Generate a deployment-only Wrangler config without committing Cloudflare resource IDs.
import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = 'wrangler.jsonc';
const outputPath = '.wrangler.deploy.jsonc';

const required = (name, expression, message) => {
  const value = (process.env[name] || '').trim();
  if (!expression.test(value)) {
    throw new Error(name + ': ' + message);
  }

  return value;
};

const kvId = required('CLOUDFLARE_OAUTH_KV_ID', /^[0-9a-f]{32}$/i, 'expected a 32-character hexadecimal KV namespace ID');
const d1Id = required('CLOUDFLARE_D1_DATABASE_ID', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'expected a D1 database UUID');

const config = JSON.parse(await readFile(sourcePath, 'utf8'));
const namespace = config.kv_namespaces?.find((binding) => binding.binding === 'OAUTH_KV');
const database = config.d1_databases?.find((binding) => binding.binding === 'DB');

if (!namespace || !database) {
  throw new Error('wrangler.jsonc must contain OAUTH_KV and DB bindings');
}

namespace.id = kvId;
database.database_id = d1Id;

const databaseName = (process.env.CLOUDFLARE_D1_DATABASE_NAME || '').trim();
if (databaseName) {
  if (!/^[a-z0-9_-]{1,64}$/i.test(databaseName)) {
    throw new Error('Invalid CLOUDFLARE_D1_DATABASE_NAME');
  }

  database.database_name = databaseName;
}

const workerName = (process.env.CLOUDFLARE_WORKER_NAME || '').trim();
if (workerName) {
  if (!/^[a-z0-9_-]{1,63}$/i.test(workerName)) {
    throw new Error('Invalid CLOUDFLARE_WORKER_NAME');
  }

  config.name = workerName;
}

const domain = (process.env.CLOUDFLARE_CUSTOM_DOMAIN || '').trim().toLowerCase();
if (domain) {
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error('CLOUDFLARE_CUSTOM_DOMAIN must be a hostname (without https:// or a path)');
  }

  config.routes = [{ pattern: domain, custom_domain: true }];
}

// Only the deployment bundle serves the independently built UI. Core tests and
// Wrangler development do not need node_modules or a built web/ directory.
config.assets = {
  directory: './web/dist',
  base_path: '/admin',
  run_worker_first: ['/v1/*', '/authorize', '/mcp', '/mcp/*', '/register', '/token', '/.well-known/*'],
};

await writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
console.log('Prepared deployment config for Worker: ' + config.name + (domain ? ' (Custom Domain: ' + domain + ')' : ''));
