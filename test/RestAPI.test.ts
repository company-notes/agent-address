import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';

describe('REST registry API', () => {
  const client = new TestClient();

  async function createOrgWithHost(handle = 'mypc') {
    const slug = TestClient.uniqueName('org');
    const orgToken = await client.createOrganization(slug);
    const host = await client.createHost(slug, orgToken, handle);
    return { slug, orgToken, host };
  }

  it('reports health', async () => {
    const result = await client.call('GET', '/health');
    expect(result.status).toBe(200);
    expect(result.body.data.status).toBe('ok');
  });

  it('requires the registration key to create an organization', async () => {
    const result = await client.call('POST', '/v1/orgs', {
      body: { slug: TestClient.uniqueName('org'), displayName: 'X' },
    });
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('registration_closed');
  });

  it('rejects duplicate organization slugs', async () => {
    const slug = TestClient.uniqueName('org');
    await client.createOrganization(slug);
    const duplicate = await client.call('POST', '/v1/orgs', {
      headers: { 'x-registration-key': TestClient.REGISTRATION_KEY },
      body: { slug, displayName: slug },
    });
    expect(duplicate.status).toBe(409);
  });

  it('rejects duplicate active work addresses under one host', async () => {
    const { host } = await createOrgWithHost();
    await client.createChild(host, 'same');
    const duplicate = await client.createChild(host, 'same');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('address_taken');
  });

  it('allows the same work name under different hosts', async () => {
    const { slug, orgToken, host } = await createOrgWithHost('mypc');
    const second = await client.createHost(slug, orgToken, 'vps1');
    expect((await client.createChild(host, 'build')).status).toBe(201);
    expect((await client.createChild(second, 'build')).status).toBe(201);
  });

  it('keeps credentials scoped to the address they own', async () => {
    const { slug, orgToken, host } = await createOrgWithHost('mypc');
    const second = await client.createHost(slug, orgToken, 'vps1');

    const crossHost = await client.call('POST', `/v1/addresses/${second.id}/children`, {
      token: host.token,
      body: { handle: 'x' },
    });
    expect(crossHost.status).toBe(403);

    const noToken = await client.call('POST', `/v1/addresses/${host.id}/children`, { body: { handle: 'x' } });
    expect(noToken.status).toBe(401);
  });

  it('revokes the whole subtree when a host is revoked', async () => {
    const { slug, orgToken, host } = await createOrgWithHost();
    const child = await client.createChild(host, 'job');

    const revoked = await client.call('DELETE', `/v1/orgs/${slug}/addresses/${host.id}`, { token: orgToken });
    expect(revoked.status).toBe(200);
    expect((await client.call('GET', '/v1/me', { token: child.body.data.addressToken })).status).toBe(401);
  });

  it('rotates an address token and invalidates the previous one', async () => {
    const { slug, orgToken, host } = await createOrgWithHost();

    const rotated = await client.call('POST', `/v1/orgs/${slug}/addresses/${host.id}/rotate-token`, { token: orgToken });
    expect(rotated.status).toBe(200);
    expect((await client.call('GET', '/v1/me', { token: host.token })).status).toBe(401);
    expect((await client.call('GET', '/v1/me', { token: rotated.body.data.addressToken })).status).toBe(200);
  });

  it('describes the caller through /v1/me', async () => {
    const { slug, orgToken, host } = await createOrgWithHost();
    expect((await client.call('GET', '/v1/me', { token: orgToken })).body.data.type).toBe('organization');
    expect((await client.call('GET', '/v1/me', { token: host.token })).body.data.address.canonical).toBe(`${slug}/mypc`);
  });

  it('returns 404 for unknown endpoints', async () => {
    expect((await client.call('GET', '/v1/nothing')).status).toBe(404);
  });
});
