#!/usr/bin/env node
// Real Chromium -> real local Worker -> OAuth -> D1, with no API mocks or production access.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WranglerD1Runner } from '../../scripts/check-d1-cutover.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://127.0.0.1:8789';
const registrationKey = 'portal-e2e-registration';
const environment = {
  ...process.env,
  CI: 'true',
  CLOUDFLARE_D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000',
  CLOUDFLARE_OAUTH_KV_ID: '00000000000000000000000000000000',
  ADMIN_ACCESS_TEAM_NAME: 'testing',
  ADMIN_ALLOWED_EMAILS: 'admin@example.test',
  ADMIN_ACCESS_AUDIENCE: '0'.repeat(64),
};

class TestProcess {
  static async run(command, args) {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });

    const code = await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });

    if (code !== 0) {
      throw new Error([command, ...args].join(' ') + ' exited ' + code + ':\n' + output);
    }

    return output;
  }
}

const configure = async () => {
  await TestProcess.run(process.execPath, ['scripts/prepare-deploy.mjs']);
  const migration = WranglerD1Runner.invocation([
    'd1', 'migrations', 'apply', 'DB',
    '--local', '--config', '.wrangler.deploy.jsonc',
  ]);

  await TestProcess.run(migration.executable, migration.arguments);
};

let worker;
let browser;
try {
  await configure();

  const server = WranglerD1Runner.invocation([
    'dev', '--local', '--ip', '127.0.0.1', '--port', '8789',
    '--config', '.wrangler.deploy.jsonc',
    '--var', 'REGISTRATION_KEY:' + registrationKey,
  ]);

  worker = spawn(server.executable, server.arguments, {
    cwd: root,
    env: environment,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let startupError;
  worker.stdout.on('data', (data) => { output += data.toString(); });
  worker.stderr.on('data', (data) => { output += data.toString(); });
  worker.once('error', (error) => { startupError = error; });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (startupError) {
      throw new Error('Local Worker could not be launched:\n' + output, { cause: startupError });
    }

    if (worker.exitCode !== null || worker.signalCode !== null) {
      throw new Error('Local Worker stopped unexpectedly:\n' + output);
    }

    try {
      const response = await fetch(origin + '/portal/');
      if (response.ok) {
        break;
      }
    } catch (error) {
      if (attempt === 119) {
        throw new Error('Local Worker did not start:\n' + output, { cause: error });
      }
    }

    await sleep(250);
  }

  const home = await fetch(origin + '/', { redirect: 'manual' });
  assert.equal(home.status, 302, 'Home must lead users to Organization Portal');
  assert.equal(home.headers.get('location'), origin + '/portal/');

  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => { pageErrors.push(error.message); });

  await page.goto(origin + '/portal/');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  await page.getByText('Create a new account & Organization').click();
  await page.locator('#su-email').waitFor({ timeout: 15000 });

  const email = 'portal-' + Date.now().toString(36) + '@example.test';
  const slug = 'portal' + Date.now().toString(36);
  await page.locator('#su-email').fill(email);
  await page.locator('#su-org-name').fill('Portal E2E Organization ' + slug);
  await page.locator('#su-org-slug').fill(slug);
  await page.locator('#su-password').fill('Portal-password-2026!');
  await page.locator('#su-confirm-password').fill('incorrect-password-confirmation');
  await page.locator('#su-key').fill(registrationKey);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByRole('alert').getByText('Passwords do not match').waitFor();
  await page.locator('#su-password').fill('Portal-password-2026!');
  await page.locator('#su-confirm-password').fill('Portal-password-2026!');
  await page.locator('#su-key').fill(registrationKey);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByText('Portal E2E Organization ' + slug).waitFor({ timeout: 25000 });

  await page.locator('#agentName').fill('xiaoming');
  await page.locator('#sessionName').fill('main');
  await page.getByRole('button', { name: 'Create Agent' }).click();

  await page.getByText(slug + '/xiaoming/main', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Sessions' }).first().click();
  await page.getByText('Default Session', { exact: true }).waitFor();

  await page.locator('#newSessionName').fill('ffl-dev');
  await page.getByRole('button', { name: 'Create Session' }).click();
  await page.getByRole('heading', { name: slug + '/xiaoming/ffl-dev', exact: true }).waitFor({ timeout: 15000 });

  // Change Organization and Agent display names and rename their address handles.
  const renamedSlug = slug + '-team';
  await page.getByLabel('Organization handle').fill(renamedSlug);
  await page.getByLabel('Organization display name').fill('Portal E2E Renamed Team');
  await page.getByRole('button', { name: 'Save Organization' }).click();
  await page.getByText('Portal E2E Renamed Team', { exact: true }).waitFor();
  await page.getByRole('heading', { name: renamedSlug + '/xiaoming/main', exact: true }).waitFor();

  await page.getByRole('button', { name: 'Edit Agent' }).first().click();
  await page.getByLabel('Edit address handle').fill('xiaomei');
  await page.getByLabel('Edit display name').fill('小美');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('heading', { name: renamedSlug + '/xiaomei/main', exact: true }).waitFor();

  await page.getByRole('button', { name: 'Edit Session' }).last().click();
  await page.getByLabel('Edit address handle').fill('ffl-qa');
  await page.getByLabel('Edit display name').fill('FFL QA');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('heading', { name: renamedSlug + '/xiaomei/ffl-qa', exact: true }).waitFor();

  // Switching the default lets us archive the old main without losing the Agent identity.
  await page.getByRole('button', { name: 'Make Default' }).last().click();
  await page.getByRole('heading', { name: renamedSlug + '/xiaomei/ffl-qa', exact: true })
    .locator('..').getByText('Default Session', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Archive Session' }).last().click();
  await page.getByRole('button', { name: 'Archive Session' }).last().click();
  await page.getByRole('heading', { name: renamedSlug + '/xiaomei/main', exact: true }).waitFor({
    state: 'detached',
  });

  // Replacing the resume capability is explicit, and its new value appears only once.
  await page.getByRole('button', { name: 'Rotate Resume Token' }).first().click();
  await page.getByRole('button', { name: 'Rotate Token', exact: true }).click();
  await page.getByText('Resume token replaced').waitFor();

  await page.getByRole('button', { name: 'Archive Agent' }).first().click();
  await page.getByRole('button', { name: 'Archive Agent' }).last().click();
  await page.getByRole('button', { name: 'Edit Agent' }).waitFor({ state: 'detached' });
  await page.getByText('Choose an Agent to inspect its Sessions.').waitFor();


  // A first-time Simplified Chinese visitor sees the correct language in both
  // Portal and OAuth, and a manual language choice survives both navigation and reload.
  const simplifiedContext = await browser.newContext({ locale: 'zh-CN' });
  const localizedPage = await simplifiedContext.newPage();
  const localizedErrors = [];
  localizedPage.on('pageerror', (error) => { localizedErrors.push(error.message); });

  await localizedPage.goto(origin + '/portal/');
  await localizedPage.getByRole('button', { name: '登录或创建账号' }).waitFor();
  assert.equal(await localizedPage.locator('#portal-language').inputValue(), 'zh-Hans');
  assert.equal(await localizedPage.locator('html').getAttribute('lang'), 'zh-Hans');

  await localizedPage.locator('#portal-language').selectOption('en');
  await localizedPage.getByRole('button', { name: 'Sign in or create an account' }).waitFor();
  await localizedPage.reload();
  assert.equal(await localizedPage.locator('#portal-language').inputValue(), 'en');

  await localizedPage.getByRole('button', { name: 'Sign in or create an account' }).click();
  await localizedPage.locator('#language').waitFor();
  assert.equal(await localizedPage.locator('#language').inputValue(), 'en');
  await localizedPage.getByText('Create a new account & Organization').waitFor();

  await localizedPage.locator('#language').selectOption('zh-Hant');
  await localizedPage.getByRole('button', { name: '安全登入' }).waitFor();
  await localizedPage.getByText('建立新帳號與組織').waitFor();
  await localizedPage.reload();
  assert.equal(await localizedPage.locator('#language').inputValue(), 'zh-Hant');
  await localizedPage.getByRole('button', { name: '安全登入' }).waitFor();

  await localizedPage.goto(origin + '/portal/');
  await localizedPage.getByRole('button', { name: '登入或建立帳號' }).waitFor();
  assert.equal(await localizedPage.locator('#portal-language').inputValue(), 'zh-Hant');

  // No stored preference: Traditional Chinese browsers should select zh-Hant.
  const traditionalContext = await browser.newContext({ locale: 'zh-TW' });
  const traditionalPage = await traditionalContext.newPage();
  await traditionalPage.goto(origin + '/portal/');
  await traditionalPage.getByRole('button', { name: '登入或建立帳號' }).waitFor();
  assert.equal(await traditionalPage.locator('#portal-language').inputValue(), 'zh-Hant');

  assert.deepEqual(localizedErrors, [], 'Localized pages must have no uncaught errors');
  await traditionalContext.close();
  await simplifiedContext.close();

  assert.deepEqual(pageErrors, [], 'Browser must have no uncaught script errors');
  console.log('PASS: real Chromium + Worker + OAuth + D1 — Portal signup, create, rename, default, rotate and archive');
} finally {
  try {
    if (browser) {
      await browser.close();
    }
  } finally {
    if (worker) {
      try {
        if (worker.pid && worker.exitCode === null && worker.signalCode === null) {
          // Wrangler starts workerd as a child. Stop the entire local process tree.
          if (process.platform === 'win32') {
            execFileSync('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'], {
              stdio: 'pipe',
            });
          } else {
            process.kill(-worker.pid, 'SIGTERM');
          }
        }
      } finally {
        worker.stdout.destroy();
        worker.stderr.destroy();
      }
    }
  }
}
