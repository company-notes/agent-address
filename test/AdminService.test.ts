import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { AdminAuthenticator } from '../src/AdminAuth';
import { AdminService } from '../src/AdminService';
import { IdentityController } from '../src/IdentityController';
import { Services } from '../src/Services';

import { TestClient } from './Helpers';

describe('Admin accounts, Agents and Sessions (real D1)', () => {
  const services = new Services(env);
  const admin = new AdminService(env.DB, services.accounts, services.organizations);

  it('shows actual Organization, Agent, Session relationships but never credentials', async () => {
    const email = `${TestClient.uniqueName('admin')}@example.com`;
    const account = await services.accounts.signUp(email, 'long-password-123', TestClient.REGISTRATION_KEY);
    const slug = TestClient.uniqueName('company');
    await services.organizations.register(account.id, slug, 'Team');
    const claimed = await services.identities.claimAgent(account.id, {
      agentName: 'releasebot',
      sessionName: 'main',
    });

    const page = await admin.listAccounts(email, 0, 10);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ agentCount: 1, sessionCount: 1 });

    const detail = await admin.getAccount(account.id);
    expect(detail.agents).toHaveLength(1);
    expect(detail.sessions[0].canonical).toBe(`${slug}/releasebot/main`);
    expect(JSON.stringify(detail)).not.toContain(claimed.resumeToken);
    expect(JSON.stringify(detail)).not.toContain(claimed.runtimeToken);
    expect(JSON.stringify(detail)).not.toMatch(/passwordHash|passwordSalt|tokenHash/i);
  });

  it('renames an Organization as administrator and keeps its existing Agent and audit record', async () => {
    const email = `${TestClient.uniqueName('rename-admin')}@example.com`;
    const account = await services.accounts.signUp(email, 'long-password-123', TestClient.REGISTRATION_KEY);
    const slug = TestClient.uniqueName('company');
    const organization = await services.organizations.register(account.id, slug, 'Team');
    const claimed = await services.identities.claimAgent(account.id, { agentName: 'assistant' });

    const renamed = await admin.updateOrganization(account.id, {
      slug: slug + '-new', displayName: 'Nuwa Team',
    }, 'operator@example.com');
    expect(renamed).toMatchObject({ id: organization.id, slug: slug + '-new', displayName: 'Nuwa Team' });

    const detail = await admin.getAccount(account.id);
    expect(detail.sessions[0]).toMatchObject({
      id: claimed.session.id, canonical: slug + '-new/assistant/main',
    });
    expect(detail.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorEmail: 'operator@example.com', eventPath: '/accounts/organization/update' }),
    ]));
  });

  it('handles a new account with no Organization', async () => {
    const email = `${TestClient.uniqueName('unlinked')}@example.com`;
    const account = await services.accounts.signUp(email, 'long-password-123', TestClient.REGISTRATION_KEY);

    const detail = await admin.getAccount(account.id);
    expect(detail.organization).toBeNull();
    expect(detail.agents).toEqual([]);
    expect(detail.sessions).toEqual([]);
  });

  it('atomically changes a password, audits it, and revokes older OAuth grants', async () => {
    const email = `${TestClient.uniqueName('reset')}@example.com`;
    const account = await services.accounts.signUp(email, 'old-password-123', TestClient.REGISTRATION_KEY);
    const request = new Request(`${TestClient.ORIGIN}/v2/account/status`);
    const controller = new IdentityController(env);
    const before = await controller.handleAuthenticated(account.id, request, 0);
    expect(before.status).toBe(200);

    await admin.resetPassword(account.id, 'new-password-321', 'operator@example.com');

    await expect(services.accounts.logIn(email, 'old-password-123'))
      .rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(services.accounts.logIn(email, 'new-password-321'))
      .resolves.toMatchObject({ id: account.id });
    await expect(controller.handleAuthenticated(account.id, request, 0))
      .rejects.toMatchObject({ code: 'authorization_revoked' });

    const audit = await env.DB.prepare(
      'SELECT actor_email AS actorEmail FROM admin_audit WHERE target_account_id = ?',
    ).bind(account.id).first<{ actorEmail: string }>();

    expect(audit?.actorEmail).toBe('operator@example.com');
  });

  it('requires Cloudflare Access and rejects foreign-origin mutations', async () => {
    const response = await exports.default.fetch(
      new Request(`${TestClient.ORIGIN}/admin/api/accounts`),
    );
    expect(response.status).toBe(503);

    expect(() => AdminAuthenticator.assertSafeMutation(
      new Request(`${TestClient.ORIGIN}/admin/api/accounts/x/password`, {
        method: 'PUT',
        headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
      }),
    )).toThrowError('same-origin');
  });
});
