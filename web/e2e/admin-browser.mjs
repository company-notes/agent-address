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
  agentCount: 1,
  sessionCount: 2,
};

const detail = {
  ...account,
  organization: { id: account.orgId, slug: 'e2e-org', displayName: 'E2E Test Organization' },
  agents: [{ id: 'agent-1', handle: 'releasebot', displayName: 'Release Bot', createdAt: account.createdAt }],
  sessions: [
    { id: 'session-1', agentId: 'agent-1', agentHandle: 'releasebot',
      handle: 'main', canonical: 'e2e-org/releasebot/main',
      isDefault: true, createdAt: account.createdAt },
    { id: 'session-2', agentId: 'agent-1', agentHandle: 'releasebot',
      handle: 'ffl-dev', canonical: 'e2e-org/releasebot/ffl-dev',
      isDefault: false, createdAt: account.createdAt },
  ],
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
  const organizationUpdates = [];

  page.on('pageerror', (error) => { pageErrors.push(error.message); });
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const options = { status: 200, contentType: 'application/json' };
    if (request.method() === 'GET' && url.pathname === '/admin/api/accounts') {
      searchTerms.push(url.searchParams.get('search') ?? '');
      await route.fulfill({
        ...options,
        body: JSON.stringify({ ok: true, data: { items: [account], total: 1 } }),
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/admin/api/accounts/' + account.id) {
      await route.fulfill({ ...options, body: JSON.stringify({ ok: true, data: detail }) });
      return;
    }
    if (request.method() === 'PATCH' && url.pathname === '/admin/api/accounts/' + account.id + '/organization') {
      const fields = JSON.parse(request.postData() ?? '{}');
      organizationUpdates.push(fields);
      account.organizationSlug = fields.slug;
      detail.organizationSlug = fields.slug;
      Object.assign(detail.organization, fields);

      for (const session of detail.sessions) {
        session.canonical = fields.slug + '/' + session.agentHandle + '/' + session.handle;
      }

      await route.fulfill({ ...options, body: JSON.stringify({ ok: true, data: detail.organization }) });
      return;
    }

    if (request.method() === 'PUT' && url.pathname === '/admin/api/accounts/' + account.id + '/password') {
      passwordUpdates.push(JSON.parse(request.postData() ?? '{}'));
      await route.fulfill({ ...options, body: JSON.stringify({ ok: true, data: { id: account.id } }) });
      return;
    }
    throw new Error('Unexpected admin API request: ' + request.method() + ' ' + url.pathname);
  });

  await page.goto(origin + '/admin/');
  await page.getByText('Agent Address · Administration').waitFor({ timeout: 15_000 });
  assert.equal(await page.getByRole('link', { name: 'Organization Portal' })
    .getAttribute('href'), '/portal/');
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
  await page.getByText('e2e-org/releasebot/main').waitFor();
  await page.getByText('e2e-org/releasebot/ffl-dev').waitFor();
  await page.getByText('Agent identities').waitFor();

  await page.getByLabel('Organization handle').fill('e2e-renamed');
  await page.getByLabel('Organization display name').fill('Renamed Organization');
  await page.getByRole('button', { name: 'Save Organization' }).click();
  await page.getByText('Organization updated.').waitFor();
  await page.getByText('e2e-renamed/releasebot/main').waitFor();
  assert.deepEqual(organizationUpdates, [{ slug: 'e2e-renamed', displayName: 'Renamed Organization' }]);

  await page.locator('input#password').fill('E2e-Password-2026!');
  await page.locator('input#confirmPassword').fill('E2e-Password-2026!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await page.getByText('Password updated. Existing Agent Address authorizations are no longer valid.').waitFor();
  assert.deepEqual(passwordUpdates, [{ password: 'E2e-Password-2026!' }]);
  assert.deepEqual(pageErrors, [], 'Browser must have no uncaught JavaScript errors');

  console.log('PASS: real Chromium E2E — account list, organization, Agent/Session, search, password reset');
} finally {
  if (browser) {
    await browser.close();
  }
  server.kill('SIGTERM');
}
