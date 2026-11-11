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
const d1Value = process.env.CLOUDFLARE_D1_DATABASE_ID;
const kvValue = process.env.CLOUDFLARE_OAUTH_KV_ID;
const envFile = process.env.GITHUB_ENV;

if (!accountId || !apiToken || !d1Value || !kvValue || !envFile) {
  throw new Error('Missing Cloudflare configuration or GITHUB_ENV');
}

const resolver = new CloudflareResourceResolver(accountId, apiToken);
const overrides = [];

if (!/^[a-f0-9]{32}$/i.test(kvValue)) {
  const id = await resolver.resolve(kvValue, {
    kind: 'KV namespace',
    endpoint: '/storage/kv/namespaces',
    field: 'title',
    idField: 'id',
    perPage: 1000,
    searchByName: false,
  });

  overrides.push('CLOUDFLARE_OAUTH_KV_ID=' + id);
}

if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(d1Value)) {
  const configuredName = (process.env.CLOUDFLARE_D1_DATABASE_NAME || '').trim();
  if (configuredName && configuredName !== d1Value) {
    throw new Error('CLOUDFLARE_D1_DATABASE_NAME must match the resolved D1 name');
  }

  const id = await resolver.resolve(d1Value, {
    kind: 'D1 database',
    endpoint: '/d1/database',
    field: 'name',
    idField: 'uuid',
    perPage: 1000,
    searchByName: true,
  });

  overrides.push('CLOUDFLARE_D1_DATABASE_ID=' + id);
  overrides.push('CLOUDFLARE_D1_DATABASE_NAME=' + d1Value);
}

if (overrides.length > 0) {
  await appendFile(envFile, overrides.join('\n') + '\n');
}

console.log('Cloudflare D1 and KV identifiers are ready.');
