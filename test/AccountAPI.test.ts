import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { Services } from '../src/Services';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

// Exercises the account-scoped Address API purely over HTTP with an OAuth bearer token, the way a
// separate product (such as an agent messaging service) calls Agent Address directly.
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

  it('lists active Work recipients rather than only Hosts, with scoped search and pagination', async () => {
    const ownerToken = await signedInAccount();
    const strangerToken = await signedInAccount();
    const slug = TestClient.uniqueName('directory');
    const ownWorks = [
      { host: 'alpha-host', handle: 'cosmo', displayName: 'Cosmo Agent' },
      { host: 'alpha-host', handle: 'grok', displayName: 'Grok Agent' },
      { host: 'beta-host', handle: 'runner', displayName: 'Runner Agent' },
    ];

    const claimed = [];
    for (const work of ownWorks) {
      const result = await client.call('POST', '/v1/account/work', {
        token: ownerToken,
        body: { organization: slug, ...work },
      });
      expect(result.status).toBe(201);
      claimed.push(result.body.data.work);
    }

    const foreign = await client.call('POST', '/v1/account/work', {
      token: strangerToken,
      body: {
        organization: TestClient.uniqueName('foreign'),
        host: 'unknown',
        handle: 'secret',
        displayName: 'Foreign Agent',
      },
    });
    expect(foreign.status).toBe(201);

    // Registry supports hierarchical addresses, but a Relay Work recipient
    // must be a direct child of an active Host, not a grandchild of a Work.
    const services = new Services(env);
    const organization = await services.registry.getOrganizationBySlug(slug);
    const parentWork = await services.registry.getActiveAddressById(claimed[0].id);
    await services.registry.createAddress(organization, 'nested', null, parentWork);

    const forbidden = await client.call('GET', '/v1/account/works?limit=2');
    expect(forbidden.status).toBe(401);

    const first = await client.call('GET', '/v1/account/works?limit=2', {
      token: ownerToken,
    });
    expect(first.status).toBe(200);
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.items.every((item: any) => item.kind === 'work')).toBe(true);
    expect(first.body.data.items.map((item: any) => item.address))
      .toEqual(['@alpha-host/cosmo', '@alpha-host/grok']);
    expect(first.body.data.nextCursor).toBe('alpha-host/grok');

    const second = await client.call('GET',
      '/v1/account/works?limit=2&cursor=' + encodeURIComponent(first.body.data.nextCursor),
      { token: ownerToken },
    );
    expect(second.status).toBe(200);
    expect(second.body.data.items.map((item: any) => item.address))
      .toEqual(['@beta-host/runner']);
    expect(second.body.data.nextCursor).toBeNull();
    expect(JSON.stringify([...first.body.data.items, ...second.body.data.items]))
      .not.toContain('unknown/secret');

    const filtered = await client.call('GET',
      '/v1/account/works?search=GROK', { token: ownerToken },
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items.map((item: any) => item.id)).toEqual([claimed[1].id]);

    const revoked = await client.call('DELETE', '/v1/account/work/' + claimed[1].id,
      { token: ownerToken });
    expect(revoked.status).toBe(200);

    const afterRevoke = await client.call('GET', '/v1/account/works', { token: ownerToken });
    expect(afterRevoke.body.data.items).toHaveLength(2);
    expect(afterRevoke.body.data.items.map((item: any) => item.id)).not.toContain(claimed[1].id);

    const foreignDirectory = await client.call('GET', '/v1/account/works',
      { token: strangerToken });
    expect(foreignDirectory.body.data.items).toHaveLength(1);
    expect(foreignDirectory.body.data.items[0].canonical).toBe(foreign.body.data.work.canonical);
    expect(JSON.stringify(foreignDirectory.body.data.items)).not.toContain(slug);
  });

  it('rejects invalid Work directory pagination and search values', async () => {
    const token = await signedInAccount();
    const created = await client.call('POST', '/v1/account/work', {
      token,
      body: { organization: TestClient.uniqueName('directory'), host: 'bot', handle: 'agent' },
    });
    expect(created.status).toBe(201);

    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'cursor=other/..',
      'search=' + 'x'.repeat(65)]) {
      const response = await client.call('GET', '/v1/account/works?' + query, { token });
      expect(response.status, query).toBe(400);
    }
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

  it('releases smoke Hosts only after their last Work was revoked', async () => {
    const token = await signedInAccount();
    const runId = 'aabbccddee';
    const name = 'relay-smoke-' + runId + '-b';
    const claimed = await client.call('POST', '/v1/account/work', {
      token,
      body: { organization: TestClient.uniqueName('org'), host: name, handle: name },
    });
    expect(claimed.status).toBe(201);
    const hostId = claimed.body.data.host.id;

    const premature = await client.call(
      'DELETE', '/v1/account/host/' + hostId + '?run_id=' + runId, { token },
    );
    expect(premature.status).toBe(409);

    await client.call('DELETE', '/v1/account/work/' + claimed.body.data.work.id, { token });
    const deleted = await client.call(
      'DELETE', '/v1/account/host/' + hostId + '?run_id=' + runId, { token },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.active).toBe(false);
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

    const ownerStatus = await client.call(
      'GET',
      `/v1/account/status?work_address_id=${owner.body.data.work.id}`,
      { token: ownerToken },
    );
    expect(ownerStatus.status, 'An owner must be able to read its own active work').toBe(200);
    expect(ownerStatus.body.data.work.id).toBe(owner.body.data.work.id);

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

    expect(status.status, 'An unrelated organization must not read the work address').toBe(403);
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
