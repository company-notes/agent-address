#!/usr/bin/env node
// Resolve existing Cloudflare resources for the deployment, without creating any.
import { appendFile } from 'node:fs/promises';

class CloudflareResourceResolver {
  constructor(accountId, apiToken) {
    this.accountId = accountId;
    this.apiToken = apiToken;
  }

  async resolve(name, options) {
    const { kind, endpoint, field, idField, perPage, searchByName } = options;
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: '1',
    });

    if (searchByName) {
      params.set('name', name);
    }

    const url = 'https://api.cloudflare.com/client/v4/accounts/' +
      encodeURIComponent(this.accountId) + endpoint + '?' + params.toString();
    const response = await fetch(url, {
      headers: {
        authorization: 'Bearer ' + this.apiToken,
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Cloudflare ' + kind + ' lookup HTTP ' + response.status +
        ': ensure the API token has D1 Read and Workers KV Storage Read permissions');
    }

    const body = await response.json();
    if (!body.success || !Array.isArray(body.result)) {
      throw new Error('Cloudflare ' + kind + ' lookup failed: check the API token permissions');
    }

    if (body.result_info?.total_count > body.result.length) {
      throw new Error('Cloudflare ' + kind + ' lookup is paginated: configure the resource ID instead');
    }

    const matches = body.result.filter((item) => item[field] === name);
    if (matches.length !== 1 || typeof matches[0][idField] !== 'string') {
      throw new Error('Expected exactly one ' + kind + ' named "' + name +
        '"; found ' + matches.length + '. Enter its actual ID in GitHub Variables.');
    }

    console.log('Resolved ' + kind + ' by unique exact name: ' + name);

    return matches[0][idField];
  }
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const configuredName = (process.env.CLOUDFLARE_D1_DATABASE_NAME || '').trim();
const envFile = process.env.GITHUB_ENV;

if (!accountId || !apiToken || !envFile) {
  throw new Error('Missing Cloudflare configuration or GITHUB_ENV');
}

if (configuredName && configuredName !== 'company-notes-agent-address') {
  throw new Error('GitHub CLOUDFLARE_D1_DATABASE_NAME must identify the original Agent Address database.');
}

const resolver = new CloudflareResourceResolver(accountId, apiToken);

// Resolve canonical resource names instead of trusting stale GitHub ID variables.
// Existing GitHub Secrets/Variables remain the single deployment entrypoint;
// this step verifies Cloudflare's actual IDs and overrides only this workflow job.
const [d1Id, kvId] = await Promise.all([
  resolver.resolve('company-notes-agent-address', {
    kind: 'D1 database',
    endpoint: '/d1/database',
    field: 'name',
    idField: 'uuid',
    perPage: 1000,
    searchByName: true,
  }),
  resolver.resolve('OAUTH_KV', {
    kind: 'KV namespace',
    endpoint: '/storage/kv/namespaces',
    field: 'title',
    idField: 'id',
    perPage: 1000,
    searchByName: false,
  }),
]);

const overrides = [
  'CLOUDFLARE_D1_DATABASE_ID=' + d1Id,
  'CLOUDFLARE_D1_DATABASE_NAME=company-notes-agent-address',
  'CLOUDFLARE_OAUTH_KV_ID=' + kvId,
];

await appendFile(envFile, overrides.join('\n') + '\n');
console.log('Verified canonical Agent Address D1 and OAuth KV by exact Cloudflare name.');
