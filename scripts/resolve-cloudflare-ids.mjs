#!/usr/bin/env node
// Convert exact Cloudflare resource names to IDs for this workflow run.
// Never create resources and never print API tokens.
import { appendFile } from 'node:fs/promises';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const d1Value = process.env.CLOUDFLARE_D1_DATABASE_ID;
const kvValue = process.env.CLOUDFLARE_OAUTH_KV_ID;
const envFile = process.env.GITHUB_ENV;
if (!accountId || !apiToken || !d1Value || !kvValue || !envFile) {
  throw new Error('Missing Cloudflare configuration or GITHUB_ENV');
}

async function resolve(kind, name, endpoint, field, idField, perPage) {
  const params = new URLSearchParams({ per_page: String(perPage), page: '1' });
  if (kind === 'D1 database') params.set('name', name);
  const url = 'https://api.cloudflare.com/client/v4/accounts/' +
    encodeURIComponent(accountId) + endpoint + '?' + params.toString();
  const response = await fetch(url, {
    headers: { authorization: 'Bearer ' + apiToken, accept: 'application/json' },
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

const overrides = [];
if (!/^[a-f0-9]{32}$/i.test(kvValue)) {
  overrides.push('CLOUDFLARE_OAUTH_KV_ID=' + await resolve(
    'KV namespace', kvValue, '/storage/kv/namespaces', 'title', 'id', 1000));
}
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(d1Value)) {
  overrides.push('CLOUDFLARE_D1_DATABASE_ID=' + await resolve(
    'D1 database', d1Value, '/d1/database', 'name', 'uuid', 1000));
  const configuredName = (process.env.CLOUDFLARE_D1_DATABASE_NAME || '').trim();
  if (configuredName && configuredName !== d1Value) {
    throw new Error('CLOUDFLARE_D1_DATABASE_NAME must match the resolved D1 name');
  }
  overrides.push('CLOUDFLARE_D1_DATABASE_NAME=' + d1Value);
}
if (overrides.length) await appendFile(envFile, overrides.join('\n') + '\n');
console.log('Cloudflare D1 and KV identifiers are ready.');
