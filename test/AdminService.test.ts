import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { AccountController } from '../src/AccountAPI';
import { AdminAuthenticator } from '../src/AdminAuth';
import { AdminService } from '../src/AdminService';
import { Services } from '../src/Services';
import { TestClient } from './Helpers';

describe('admin accounts (real D1)', () => {
  const services = new Services(env);
  const admin = new AdminService(env.DB, services.accounts, services.registry);

  it('lists registered accounts and their actual Host/Work relationships without exposing secrets', async () => {
    const email = `${TestClient.uniqueName('admin-list')}@example.com`;
    const account = await services.accounts.signUp(email, 'password-initial-123', TestClient.REGISTRATION_KEY);
    const slug = TestClient.uniqueName('company');
    const organization = (await services.registry.createOrganization(slug, 'Team')).organization;
    const host = (await services.registry.createAddress(organization, 'mac', null, null)).address;
    await services.registry.createAddress(organization, 'current-work', null, host);
    const orgToken = await services.registry.rotateOrganizationToken(organization);
    await services.accounts.linkOrganization(account, slug, orgToken);

    const page = await admin.listAccounts(email, 0, 10);
    expect(page.total).toBe(1);
    expect(page.items[0].hostCount).toBe(1);
    expect(page.items[0].workCount).toBe(1);

    const detail = await admin.getAccount(account.id);
    expect((detail.addresses as unknown[]).length).toBe(2);
    expect(JSON.stringify(detail)).not.toMatch(/passwordHash|passwordSalt|tokenHash/i);
  });

  it('reports an unlinked account without inventing organization metadata', async () => {
    const email = `${TestClient.uniqueName('admin-unlinked')}@example.com`;
    const account = await services.accounts.signUp(email, 'password-initial-123', TestClient.REGISTRATION_KEY);

    const detail = await admin.getAccount(account.id);

    expect(detail.organization).toBeNull();
    expect(detail.addresses).toEqual([]);
    expect(detail.credentials).toEqual([]);
    expect(detail.enrollments).toEqual([]);
    expect(detail.auditEvents).toEqual([]);
  });

  it('atomically resets a password, audits the actor, and invalidates old account grants', async () => {
    const email = `${TestClient.uniqueName('admin-reset')}@example.com`;
    const oldPassword = 'old-password-123';
    const newPassword = 'new-password-321';
    const account = await services.accounts.signUp(email, oldPassword, TestClient.REGISTRATION_KEY);
    const accountRequest = new Request(`${TestClient.ORIGIN}/v1/account/status`);
    const before = await new AccountController(env).handleAuthenticated(account.id, accountRequest, 0);
    expect(before.status).toBe(200);

    expect((await admin.resetPassword(account.id, newPassword, 'admin@example.com')).passwordChanged).toBe(true);
    await expect(services.accounts.logIn(email, oldPassword)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(services.accounts.logIn(email, newPassword)).resolves.toMatchObject({ id: account.id });
    await expect(new AccountController(env).handleAuthenticated(account.id, accountRequest, 0))
      .rejects.toMatchObject({ code: 'authorization_revoked' });

    const audit = await env.DB.prepare('SELECT actor_email AS actorEmail FROM admin_audit WHERE target_account_id = ?')
      .bind(account.id).first<{ actorEmail: string }>();
    expect(audit?.actorEmail).toBe('admin@example.com');
  });

  it('keeps the public Admin API closed until Access is configured', async () => {
    const response = await exports.default.fetch(new Request(`${TestClient.ORIGIN}/v1/admin/accounts`));
    expect(response.status).toBe(503);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects cross-origin browser mutations', () => {
    expect(() => AdminAuthenticator.assertSafeMutation(new Request(`${TestClient.ORIGIN}/v1/admin/accounts/x/password`, {
      method: 'PUT',
      headers: { origin: 'https://other.example', 'sec-fetch-site': 'cross-site' },
    }))).toThrowError('same-origin');
  });
});
