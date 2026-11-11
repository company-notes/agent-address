#!/usr/bin/env node
// Real-browser E2E against a local Vite server. All admin API calls are mocked:
// this test never contacts production or modifies an actual account.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const origin = 'http://127.0.0.1:4178';
const server = spawn(process.execPath, [
  viteBin, '--host', '127.0.0.1', '--port', '4178', '--strictPort',
], { cwd: webRoot, stdio: ['ignore', 'pipe', 'pipe'] });

let serverOutput = '';
server.stdout.on('data', (data) => { serverOutput += data.toString(); });
server.stderr.on('data', (data) => { serverOutput += data.toString(); });

async function waitUntilReady() {
  for (let i = 0; i < 90; i += 1) {
    if (server.exitCode !== null) {
      throw new Error('Vite exited unexpectedly: ' + serverOutput);
    }
    try {
      const response = await fetch(origin + '/admin/');
      if (response.ok) {
        return;
      }
    } catch (error) {
      console.debug('Vite startup connection is not ready:', error);
    }
    await sleep(250);
  }
  throw new Error('Local Vite did not become ready: ' + serverOutput);
}

const account = {
  id: 'test-account-1',
  email: 'operator@example.test',
  orgId: 'test-organization-1',
  organizationSlug: 'e2e-org',
  createdAt: '2026-11-11T00:00:00.000Z',
  hostCount: 1,
  workCount: 1,
};

const detail = {
  ...account,
  organization: { slug: 'e2e-org', displayName: 'E2E Test Organization' },
  addresses: [
    { id: 'host-1', canonical: 'host.e2e-org.example.test', kind: 'host', active: true, createdAt: account.createdAt },
    { id: 'work-1', canonical: 'work.e2e-org.example.test', kind: 'work', active: true, createdAt: account.createdAt },
  ],
  credentials: [{ id: 'credential-1', kind: 'password', addressId: null, createdAt: account.createdAt, revokedAt: null }],
  enrollments: [],
  auditEvents: [],
};

let browser;
try {
  await waitUntilReady();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const pageErrors = [];
  const searchTerms = [];
  const passwordUpdates = [];

  page.on('pageerror', (error) => { pageErrors.push(error.message); });
  await page.route('**/v1/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const options = { status: 200, contentType: 'application/json' };
    if (request.method() === 'GET' && url.pathname === '/v1/admin/accounts') {
      searchTerms.push(url.searchParams.get('search') ?? '');
      await route.fulfill({
        ...options,
        body: JSON.stringify({ ok: true, data: { items: [account], total: 1 } }),
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/v1/admin/accounts/' + account.id) {
      await route.fulfill({ ...options, body: JSON.stringify({ ok: true, data: detail }) });
      return;
    }
    if (request.method() === 'PUT' && url.pathname === '/v1/admin/accounts/' + account.id + '/password') {
      passwordUpdates.push(JSON.parse(request.postData() ?? '{}'));
      await route.fulfill({ ...options, body: JSON.stringify({ ok: true, data: { id: account.id } }) });
      return;
    }
    throw new Error('Unexpected admin API request: ' + request.method() + ' ' + url.pathname);
  });

  await page.goto(origin + '/admin/');
  await page.getByText('Agent Address · Administration').waitFor({ timeout: 15_000 });
  await page.getByText(account.email).first().waitFor({ timeout: 15_000 });
  assert.equal(await page.getByText('Registered accounts').count(), 1);

  const search = page.getByLabel('Search by email or organization');
  await search.fill('e2e-org');
  await search.press('Enter');
  for (let i = 0; i < 40 && !searchTerms.includes('e2e-org'); i += 1) {
    await sleep(150);
  }
  assert(searchTerms.includes('e2e-org'), 'Search must be sent to the API');

  await page.getByText(account.email).first().click();
  await page.getByText('E2E Test Organization').waitFor({ timeout: 15_000 });
  await page.getByText('host.e2e-org.example.test').waitFor();
  await page.getByText('work.e2e-org.example.test').waitFor();
  await page.getByText('Credentials (metadata only)').waitFor();

  await page.locator('input#password').fill('E2e-Password-2026!');
  await page.locator('input#confirmPassword').fill('E2e-Password-2026!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await page.getByText('Password updated. Existing Agent Address authorizations are no longer valid.').waitFor();
  assert.deepEqual(passwordUpdates, [{ password: 'E2e-Password-2026!' }]);
  assert.deepEqual(pageErrors, [], 'Browser must have no uncaught JavaScript errors');

  console.log('PASS: real Chromium E2E — account list, organization, host/work, search, password reset');
} finally {
  if (browser) {
    await browser.close();
  }
  server.kill('SIGTERM');
}
