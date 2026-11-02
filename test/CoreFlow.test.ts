import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';

describe('core Agent Address flow', () => {
  it('creates, resolves, renames and releases an address with persisted credentials', async () => {
    const client = new TestClient();
    const slug = TestClient.uniqueName('core');
    const orgToken = await client.createOrganization(slug);

    const host = await client.createHost(slug, orgToken, 'mypc');
    const child = await client.createChild(host, 'build-release');
    expect(child.status).toBe(201);
    expect(child.body.data.address.canonical).toBe(`${slug}/mypc/build-release`);

    const workId: string = child.body.data.address.id;
    const workToken: string = child.body.data.addressToken;

    // Verify both the API response and the actual D1 state.
    const row = await env.DB.prepare('SELECT path, revoked_at AS revokedAt FROM addresses WHERE id = ?')
      .bind(workId)
      .first<{ path: string; revokedAt: string | null }>();
    expect(row?.path).toBe('mypc/build-release');
    expect(row?.revokedAt).toBeNull();

    const resolved = await client.call('GET', `/v1/resolve/${slug}/mypc/build-release`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.id).toBe(workId);

    const renamed = await client.call('PATCH', `/v1/addresses/${workId}`, {
      token: workToken,
      body: { handle: 'release-2' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.path).toBe('mypc/release-2');

    const renamedRow = await env.DB.prepare('SELECT path FROM addresses WHERE id = ?')
      .bind(workId)
      .first<{ path: string }>();
    expect(renamedRow?.path).toBe('mypc/release-2');

    const released = await client.call('DELETE', `/v1/addresses/${workId}`, {
      token: workToken,
    });
    expect(released.status).toBe(200);
    expect(released.body.data.active).toBe(false);

    const revokedRow = await env.DB.prepare('SELECT revoked_at AS revokedAt FROM addresses WHERE id = ?')
      .bind(workId)
      .first<{ revokedAt: string | null }>();
    expect(revokedRow?.revokedAt).not.toBeNull();

    // Revoked work cannot be resolved or authenticated, and its handle is reusable.
    const missing = await client.call('GET', `/v1/resolve/${slug}/mypc/release-2`);
    const oldCredential = await client.call('GET', '/v1/me', { token: workToken });
    const reused = await client.createChild(host, 'release-2');

    expect(missing.status).toBe(404);
    expect(oldCredential.status).toBe(401);
    expect(reused.status).toBe(201);
  });
});
