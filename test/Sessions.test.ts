import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { APIError } from '../src/HTTP';
import { Services } from '../src/Services';
import { TestClient } from './Helpers';

async function expectAPIError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(APIError);
  expect((error as APIError).code).toBe(code);
}

describe('accounts', () => {
  const services = new Services(env);
  const password = 'correct horse battery';

  async function signUp(prefix = 'user') {
    const email = `${TestClient.uniqueName(prefix)}@example.com`;
    return services.accounts.signUp(email, password, TestClient.REGISTRATION_KEY);
  }

  it('requires the registration key to sign up', async () => {
    await expectAPIError(services.accounts.signUp('a@example.com', password, null), 'registration_closed');
    await expectAPIError(services.accounts.signUp('a@example.com', password, 'wrong'), 'registration_closed');
  });

  it('validates email and password strength', async () => {
    await expectAPIError(services.accounts.signUp('nope', password, TestClient.REGISTRATION_KEY), 'invalid_email');
    await expectAPIError(services.accounts.signUp('a@example.com', 'short', TestClient.REGISTRATION_KEY), 'weak_password');
  });

  it('signs in with the right password only', async () => {
    const account = await signUp();
    expect((await services.accounts.logIn(account.email.toUpperCase(), password)).id).toBe(account.id);
    await expectAPIError(services.accounts.logIn(account.email, 'wrong password!'), 'invalid_credentials');
    await expectAPIError(services.accounts.logIn('missing@example.com', password), 'invalid_credentials');
  });

  it('rejects duplicate emails', async () => {
    const account = await signUp();
    await expectAPIError(services.accounts.signUp(account.email, password, TestClient.REGISTRATION_KEY), 'account_exists');
  });

  it('allows one organization per account and one account per organization', async () => {
    const first = await signUp();
    const second = await signUp();
    const slug = TestClient.uniqueName('org');

    const organization = await services.accounts.registerOrganization(first, slug, 'Org');
    expect(organization.slug).toBe(slug);

    const reloaded = await services.accounts.getAccount(first.id);
    expect(reloaded.orgId).toBe(organization.id);
    await expectAPIError(services.accounts.registerOrganization(reloaded, TestClient.uniqueName('org'), 'Other'), 'account_has_organization');
    await expectAPIError(services.accounts.registerOrganization(second, slug, 'Org'), 'org_slug_taken');
  });

  it('links an existing organization only with its organization token', async () => {
    const client = new TestClient();
    const slug = TestClient.uniqueName('org');
    const orgToken = await client.createOrganization(slug);
    const other = await client.createOrganization(TestClient.uniqueName('org'));
    const account = await signUp();

    await expectAPIError(services.accounts.linkOrganization(account, slug, other), 'wrong_organization');
    const organization = await services.accounts.linkOrganization(account, slug, orgToken);
    expect(organization.slug).toBe(slug);

    const another = await signUp();
    await expectAPIError(services.accounts.linkOrganization(another, slug, orgToken), 'organization_owned');
  });
});

describe('session addresses', () => {
  const services = new Services(env);

  async function accountWithOrganization() {
    const account = await services.accounts.signUp(
      `${TestClient.uniqueName('user')}@example.com`,
      'correct horse battery',
      TestClient.REGISTRATION_KEY,
    );
    return account;
  }

  it('registers the organization and host while naming the first session', async () => {
    const account = await accountWithOrganization();
    const slug = TestClient.uniqueName('org');

    const claimed = await services.sessions.claim(account.id, { organization: slug, host: 'mypc', handle: 'build-release' });
    expect(claimed.organization.slug).toBe(slug);
    expect(claimed.host.path).toBe('mypc');
    expect(claimed.work.path).toBe('mypc/build-release');
  });

  it('needs no organization name once the account owns one', async () => {
    const account = await accountWithOrganization();
    const slug = TestClient.uniqueName('org');
    await services.sessions.claim(account.id, { organization: slug, host: 'mypc', handle: 'first' });

    const second = await services.sessions.claim(account.id, { handle: 'second' });
    expect(second.organization.slug).toBe(slug);
    expect(second.work.path).toBe('mypc/second');
  });

  it('assigns a temporary name when none is requested', async () => {
    const account = await accountWithOrganization();
    const claimed = await services.sessions.claim(account.id, { organization: TestClient.uniqueName('org'), host: 'mypc' });
    expect(claimed.work.handle).toMatch(/^session-[0-9a-f]{6}$/);
  });

  it('asks which machine to use when it cannot be inferred', async () => {
    const account = await accountWithOrganization();
    const slug = TestClient.uniqueName('org');
    await expectAPIError(services.sessions.claim(account.id, { organization: slug }), 'host_required');

    await services.sessions.claim(account.id, { host: 'mypc' });
    await services.sessions.claim(account.id, { host: 'vps1' });
    await expectAPIError(services.sessions.claim(account.id, {}), 'host_required');
  });

  it('requires an organization name for an account without one', async () => {
    const account = await accountWithOrganization();
    await expectAPIError(services.sessions.claim(account.id, { host: 'mypc' }), 'no_organization');
  });

  it('rejects claiming a different organization than the account owns', async () => {
    const account = await accountWithOrganization();
    await services.sessions.claim(account.id, { organization: TestClient.uniqueName('org'), host: 'mypc' });
    await expectAPIError(
      services.sessions.claim(account.id, { organization: TestClient.uniqueName('org') }),
      'account_has_organization',
    );
  });

  it('renames and releases only work addresses of the same account', async () => {
    const owner = await accountWithOrganization();
    const stranger = await accountWithOrganization();
    await services.sessions.claim(stranger.id, { organization: TestClient.uniqueName('org'), host: 'mypc' });
    const claimed = await services.sessions.claim(owner.id, { organization: TestClient.uniqueName('org'), host: 'mypc', handle: 'job' });

    await expectAPIError(services.sessions.rename(stranger.id, claimed.work.id, 'stolen'), 'wrong_address');
    await expectAPIError(services.sessions.release(owner.id, claimed.host.id), 'wrong_address');

    const renamed = await services.sessions.rename(owner.id, claimed.work.id, 'job-2');
    expect(renamed.work.path).toBe('mypc/job-2');

    const released = await services.sessions.release(owner.id, claimed.work.id);
    expect(released.work.revokedAt).not.toBeNull();
    await expectAPIError(services.sessions.rename(owner.id, claimed.work.id, 'again'), 'address_not_found');
  });

  it('only revokes an empty, exactly matching smoke-run Host', async () => {
    const account = await accountWithOrganization();
    const other = await accountWithOrganization();
    const runId = '0123456789';
    const name = 'relay-smoke-' + runId + '-a';
    const claimed = await services.sessions.claim(account.id, {
      organization: TestClient.uniqueName('org'),
      host: name,
      handle: name,
    });

    await expectAPIError(
      services.sessions.releaseSmokeHost(account.id, claimed.host.id, runId),
      'smoke_host_not_empty',
    );
    await expectAPIError(
      services.sessions.releaseSmokeHost(other.id, claimed.host.id, runId),
      'no_organization',
    );
    await expectAPIError(
      services.sessions.releaseSmokeHost(account.id, claimed.host.id, 'ffffffffff'),
      'smoke_host_cleanup_forbidden',
    );

    await services.sessions.release(account.id, claimed.work.id);
    const released = await services.sessions.releaseSmokeHost(account.id, claimed.host.id, runId);
    expect(released.host.revokedAt).not.toBeNull();

    const status = await services.sessions.describe(account.id, null);
    expect((status.hosts as unknown[]).some((item: any) => item.id === claimed.host.id)).toBe(false);
  });

  it('does not delete ordinary production Hosts even when they are empty', async () => {
    const account = await accountWithOrganization();
    const claimed = await services.sessions.claim(account.id, {
      organization: TestClient.uniqueName('org'),
      host: 'real-host',
      handle: 'job',
    });
    await services.sessions.release(account.id, claimed.work.id);

    await expectAPIError(
      services.sessions.releaseSmokeHost(account.id, claimed.host.id, '0123456789'),
      'smoke_host_cleanup_forbidden',
    );
  });

  it('resolves addresses relative to the account organization', async () => {
    const account = await accountWithOrganization();
    const slug = TestClient.uniqueName('org');
    await services.sessions.claim(account.id, { organization: slug, host: 'mypc', handle: 'job' });

    expect((await services.sessions.resolve(account.id, '@mypc/job')).canonical).toBe(`${slug}/mypc/job`);
    expect((await services.sessions.resolve(account.id, `${slug}/mypc/job`)).canonical).toBe(`${slug}/mypc/job`);
    await expectAPIError(services.sessions.resolve(account.id, '@mypc/none'), 'address_not_found');
  });

  it('describes the account with and without an organization', async () => {
    const account = await accountWithOrganization();
    expect((await services.sessions.describe(account.id, null)).organization).toBeNull();

    const claimed = await services.sessions.claim(account.id, { organization: TestClient.uniqueName('org'), host: 'mypc', handle: 'job' });
    const described = await services.sessions.describe(account.id, claimed.work.id);
    expect((described.hosts as unknown[]).length).toBe(1);
    expect((described.work as { address: string }).address).toBe('@mypc/job');
  });
});

describe('local agent enrollment', () => {
  const services = new Services(env);
  const client = new TestClient();

  async function organizationWithAccount() {
    const account = await services.accounts.signUp(
      `${TestClient.uniqueName('user')}@example.com`,
      'correct horse battery',
      TestClient.REGISTRATION_KEY,
    );
    const claimed = await services.sessions.claim(account.id, { organization: TestClient.uniqueName('org'), host: 'cloud' });
    return { account, organization: claimed.organization };
  }

  it('turns a one-time code into a usable host credential', async () => {
    const { account, organization } = await organizationWithAccount();
    const install = await services.sessions.createLocalInstall(account.id, 'mypc');

    const redeemed = await client.call('POST', '/v1/enrollments/redeem', { body: { code: install.code } });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.data.address.canonical).toBe(`${organization.slug}/mypc`);

    const me = await client.call('GET', '/v1/me', { token: redeemed.body.data.addressToken });
    expect(me.body.data.address.kind).toBe('host');

    const child = await client.call('POST', `/v1/addresses/${redeemed.body.data.address.id}/children`, {
      token: redeemed.body.data.addressToken,
      body: { handle: 'build' },
    });
    expect(child.status).toBe(201);
  });

  it('cannot be redeemed twice', async () => {
    const { account } = await organizationWithAccount();
    const install = await services.sessions.createLocalInstall(account.id, 'mypc');
    expect((await client.call('POST', '/v1/enrollments/redeem', { body: { code: install.code } })).status).toBe(200);
    expect((await client.call('POST', '/v1/enrollments/redeem', { body: { code: install.code } })).status).toBe(400);
  });

  it('rejects unknown and expired codes', async () => {
    expect((await client.call('POST', '/v1/enrollments/redeem', { body: { code: 'enr_unknown' } })).status).toBe(400);

    const { account } = await organizationWithAccount();
    const install = await services.sessions.createLocalInstall(account.id, 'mypc');
    await env.DB.prepare("UPDATE enrollments SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await client.call('POST', '/v1/enrollments/redeem', { body: { code: install.code } })).status).toBe(400);
  });

  it('rotates the credential when the host already exists', async () => {
    const { account } = await organizationWithAccount();
    const first = await services.sessions.createLocalInstall(account.id, 'mypc');
    const firstRedeem = await client.call('POST', '/v1/enrollments/redeem', { body: { code: first.code } });

    const second = await services.sessions.createLocalInstall(account.id, 'mypc');
    const secondRedeem = await client.call('POST', '/v1/enrollments/redeem', { body: { code: second.code } });
    expect(secondRedeem.body.data.address.id).toBe(firstRedeem.body.data.address.id);
    expect((await client.call('GET', '/v1/me', { token: firstRedeem.body.data.addressToken })).status).toBe(401);
    expect((await client.call('GET', '/v1/me', { token: secondRedeem.body.data.addressToken })).status).toBe(200);
  });
});
