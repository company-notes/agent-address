#!/usr/bin/env node
// Real Chromium -> real local Worker -> OAuth -> D1, with no API mocks or production access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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
  await TestProcess.run('npx', [
    'wrangler', 'd1', 'migrations', 'apply', 'DB',
    '--local', '--config', '.wrangler.deploy.jsonc',
  ]);
};

let worker;
let browser;
try {
  await configure();

  worker = spawn('npx', [
    'wrangler', 'dev',
    '--local', '--ip', '127.0.0.1', '--port', '8789',
    '--config', '.wrangler.deploy.jsonc',
    '--var', 'REGISTRATION_KEY:' + registrationKey,
  ], {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  worker.stdout.on('data', (data) => { output += data.toString(); });
  worker.stderr.on('data', (data) => { output += data.toString(); });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (worker.exitCode !== null) {
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

  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => { pageErrors.push(error.message); });

  await page.goto(origin + '/portal/');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  await page.locator('#su-email').waitFor({ timeout: 15000 });

  const email = 'portal-' + Date.now().toString(36) + '@example.test';
  await page.locator('#su-email').fill(email);
  await page.locator('#su-password').fill('Portal-password-2026!');
  await page.locator('#su-key').fill(registrationKey);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByText('Register your Organization').waitFor({ timeout: 25000 });

  const slug = 'portal' + Date.now().toString(36);
  await page.locator('#slug').fill(slug);
  await page.locator('#displayName').fill('Portal E2E Organization');
  await page.getByRole('button', { name: 'Register Organization' }).click();
  await page.getByText('Portal E2E Organization').waitFor({ timeout: 15000 });

  await page.locator('#agentName').fill('xiaoming');
  await page.locator('#sessionName').fill('main');
  await page.getByRole('button', { name: 'Create Agent' }).click();

  await page.getByText(slug + '/xiaoming/main').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Sessions' }).first().click();
  await page.getByText('Default Session', { exact: true }).waitFor();

  await page.locator('#newSessionName').fill('ffl-dev');
  await page.getByRole('button', { name: 'Create Session' }).click();
  await page.getByText(slug + '/xiaoming/ffl-dev').waitFor({ timeout: 15000 });

  assert.deepEqual(pageErrors, [], 'Browser must have no uncaught script errors');
  console.log('PASS: real Chromium + Worker + OAuth + D1 — Portal signup, Organization, Agent and Sessions');
} finally {
  if (browser) {
    await browser.close();
  }

  if (worker) {
    worker.kill('SIGTERM');
  }
}
