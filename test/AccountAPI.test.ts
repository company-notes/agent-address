import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

// Exercises the account-scoped Address API purely over HTTP with an OAuth bearer token, the way a
// separate product (such as a separate agent messaging service) is meant to call Agent Address directly,
describe('account API (plain HTTP, no MCP)', () => {
  const client = new TestClient();

  async function signedInAccount() {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    return accessToken;
  }

  it('rejects requests without a valid OAuth bearer token', async () => {
    expect((await client.call('GET', '/v1/account/status')).status).toBe(401);
    expect((await client.call('GET', '/v1/account/status', { token: 'garbage' })).status).toBe(401);
  });

  it('reports no organization for a brand-new account', async () => {
    const token = await signedInAccount();
    const status = await client.call('GET', '/v1/account/status', { token });
    expect(status.status).toBe(200);
    expect(status.body.data.organization).toBeNull();
  });

  it('registers the organization and claims a session in one call', async () => {
    const token = await signedInAccount();
    const slug = TestClient.uniqueName('org');

    const claimed = await client.call('POST', '/v1/account/work', {
      token,
      body: { organization: slug, host: 'mypc', handle: 'build-release' },
    });
    expect(claimed.status).toBe(201);
    expect(claimed.body.data.organization.slug).toBe(slug);
    expect(claimed.body.data.work.canonical).toBe(`${slug}/mypc/build-release`);

    const status = await client.call('GET', '/v1/account/status', { token });
    expect(status.body.data.organization.slug).toBe(slug);
    expect(status.body.data.hosts).toHaveLength(1);
  });

  it('needs no organization once the account owns one, and reports which machine is ambiguous', async () => {
    const token = await signedInAccount();
    const slug = TestClient.uniqueName('org');
    await client.call('POST', '/v1/account/work', { token, body: { organization: slug, host: 'mypc' } });

    const second = await client.call('POST', '/v1/account/work', { token, body: { host: 'vps1' } });
    expect(second.status).toBe(201);
    expect(second.body.data.organization.slug).toBe(slug);

    const ambiguous = await client.call('POST', '/v1/account/work', { token, body: {} });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error.code).toBe('host_required');
  });

  it('renames, resolves and releases a claimed work address', async () => {
    const token = await signedInAccount();
    const slug = TestClient.uniqueName('org');
    const claimed = await client.call('POST', '/v1/account/work', {
      token,
      body: { organization: slug, host: 'mypc', handle: 'job' },
    });
    const workId = claimed.body.data.work.id;

    const renamed = await client.call('PATCH', `/v1/account/work/${workId}`, { token, body: { handle: 'job-2' } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.path).toBe('mypc/job-2');

    const resolved = await client.call('GET', `/v1/account/resolve?address=${encodeURIComponent('@mypc/job-2')}`, { token });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.id).toBe(workId);

    const released = await client.call('DELETE', `/v1/account/work/${workId}`, { token });
    expect(released.status).toBe(200);
    expect(released.body.data.active).toBe(false);
  });

  it('rejects status lookup of work addresses belonging to another organization', async () => {
    // Regression: a foreign workAddressId must not disclose another organization's work address.
    const ownerToken = await signedInAccount();
    const strangerToken = await signedInAccount();

    const owner = await client.call('POST', '/v1/account/work', {
      token: ownerToken,
      body: {
        organization: TestClient.uniqueName('org'),
        host: 'owner-host',
        handle: 'private-work',
      },
    });
    expect(owner.status).toBe(201);

    const stranger = await client.call('POST', '/v1/account/work', {
      token: strangerToken,
      body: {
        organization: TestClient.uniqueName('org'),
        host: 'stranger-host',
        handle: 'own-work',
      },
    });
    expect(stranger.status).toBe(201);

    const status = await client.call(
      'GET',
      `/v1/account/status?work_address_id=${owner.body.data.work.id}`,
      { token: strangerToken },
    );

    expect(status.status).toBe(403);
    expect(status.body.error.code).toBe('wrong_address');
  });

  it('does not let one account touch another account work address', async () => {
    const ownerToken = await signedInAccount();
    const strangerToken = await signedInAccount();
    const claimed = await client.call('POST', '/v1/account/work', {
      token: ownerToken,
      body: { organization: TestClient.uniqueName('org'), host: 'mypc', handle: 'job' },
    });
    const workId = claimed.body.data.work.id;

    const renamed = await client.call('PATCH', `/v1/account/work/${workId}`, { token: strangerToken, body: { handle: 'stolen' } });
    expect(renamed.status).toBe(403);
  });

  it('prepares a local install whose code redeems to a working host credential', async () => {
    const token = await signedInAccount();
    await client.call('POST', '/v1/account/work', {
      token,
      body: { organization: TestClient.uniqueName('org'), host: 'cloud', handle: 'chat' },
    });

    const install = await client.call('POST', '/v1/account/local-install', { token, body: { host: 'mypc' } });
    expect(install.status).toBe(200);
    expect(install.body.data.enrollmentCode).toMatch(/^enr_/);

    const redeemed = await client.call('POST', '/v1/enrollments/redeem', { body: { code: install.body.data.enrollmentCode } });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.data.address.canonical).toBe(install.body.data.host.canonical);
  });
});
