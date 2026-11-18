import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

describe('identity account API boundaries', () => {
  const client = new TestClient();

  it('requires an OAuth account and organization before identities can be created', async () => {
    const anonymous = await client.call('GET', '/v2/account/agents');
    expect(anonymous.status).toBe(401);

    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const status = await client.call('GET', '/v2/account/status?include_grant=1', {
      token: accessToken,
    });
    expect(status.status).toBe(200);
    expect(status.body.data.organization).toBeNull();
    expect(status.body.data.grantFingerprint).toBeTruthy();

    const unlinked = await client.createAgent(accessToken, 'releasebot', 'main');
    expect(unlinked.status).toBe(409);
    expect(unlinked.body.error.code).toBe('no_organization');
  });

  it('accepts only resource-based Runtime claims and rejects retired action endpoints', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    await client.registerOrganization(accessToken, TestClient.uniqueName('resources'));

    const retiredClaim = await client.call('POST', '/v2/account/agents/claim', {
      token: accessToken,
      body: { agentName: 'obsolete' },
    });
    expect(retiredClaim.status).toBe(404);

    const agent = await client.createAgent(accessToken, 'current', 'main');
    expect(agent.status).toBe(201);

    const sessionID = agent.body.data.session.id;
    const oldLease = await client.call('POST', `/v2/account/sessions/${sessionID}/heartbeat`, {
      token: accessToken,
      body: { runtimeToken: agent.body.data.runtimeToken },
    });
    expect(oldLease.status).toBe(404);

    const renewed = await client.call('PATCH', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { runtimeToken: agent.body.data.runtimeToken },
    });
    expect(renewed.status).toBe(200);
  });

  it('provides a single authenticated account and Runtime identity round trip for Relay', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('relay');
    await client.registerOrganization(accessToken, slug);

    const status = await client.call('GET', '/v2/account/status?include_grant=1', {
      token: accessToken,
    });
    const grant = await client.call('GET', '/v2/account/grant', { token: accessToken });

    expect(status.status).toBe(200);
    expect(status.body.data.organization.slug).toBe(slug);
    expect(status.body.data.grantFingerprint).toBe(grant.body.data.grantFingerprint);

    const agent = await client.createAgent(accessToken, 'relaybot', 'main');
    const sessionID = agent.body.data.session.id;
    const path = `/v2/account/sessions/${sessionID}/runtime-lease?include_identity=1`;

    const lease = await client.call('PATCH', path, {
      token: accessToken, body: { runtimeToken: agent.body.data.runtimeToken },
    });
    expect(lease.status).toBe(200);
    expect(lease.body.data).toMatchObject({
      session: { id: sessionID, canonical: `${slug}/relaybot/main` },
      organization: { id: status.body.data.organization.id, slug },
    });
    expect(Date.parse(lease.body.data.expiresAt)).toBeGreaterThan(Date.now());

    await client.call('DELETE', path, {
      token: accessToken, body: { runtimeToken: agent.body.data.runtimeToken },
    });
    const revoked = await client.call('PATCH', path, {
      token: accessToken, body: { runtimeToken: agent.body.data.runtimeToken },
    });
    expect(revoked.status).toBe(409);
  });

  it('supports a named Agent with a default Session and additional Sessions', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('team');
    await client.registerOrganization(accessToken, slug);

    const agent = await client.createAgent(accessToken, 'xiaoming', 'main');
    expect(agent.status).toBe(201);
    expect(agent.body.data.session.canonical).toBe(`${slug}/xiaoming/main`);

    const created = await client.call(
      'POST',
      `/v2/account/agents/${agent.body.data.session.agentId}/sessions`,
      { token: accessToken, body: { sessionName: 'research' } },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.session.canonical).toBe(`${slug}/xiaoming/research`);
    expect(created.body.data.session.isDefault).toBe(false);

    const list = await client.call(
      'GET',
      `/v2/account/agents/${agent.body.data.session.agentId}/sessions`,
      { token: accessToken },
    );
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.find((x: any) => x.isDefault).handle).toBe('main');

    const duplicate = await client.createAgent(accessToken, 'xiaoming', 'another');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('identity_name_taken');
  });

  it('keeps the same managed coworker Agent across a lost registration response and retry', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('office');
    await client.registerOrganization(accessToken, slug);

    const endpoint = '/v2/account/agent-registrations/office-test-native-001';
    const body = {
      agentName: 'office-bear', agentDisplayName: '大熊', sessionName: 'main',
    };
    const first = await client.call('PUT', endpoint, { token: accessToken, body });
    expect(first.status).toBe(200);
    expect(first.body.data.session.canonical).toBe(slug + '/office-bear/main');
    expect(first.body.data.resumeToken).toBeUndefined();
    expect(first.body.data.runtimeToken).toBeUndefined();

    // The first API response is treated as lost. The same request ID must
    // return the immutable Session, without creating a second Agent.
    const repeated = await client.call('PUT', endpoint, { token: accessToken, body });
    expect(repeated.status).toBe(200);
    expect(repeated.body.data).toEqual(first.body.data);

    const directory = await client.call('GET', '/v2/account/agents', {
      token: accessToken,
    });
    expect(directory.body.data).toHaveLength(1);
    expect(directory.body.data[0].defaultSessionID).toBe(first.body.data.session.id);

    const persisted = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM agent_registration_requests WHERE registration_id = ?',
    ).bind('office-test-native-001').first<{ count: number }>();
    expect(persisted?.count).toBe(1);

    const altered = await client.call('PUT', endpoint, {
      token: accessToken,
      body: { ...body, agentDisplayName: '冒名頂替' },
    });
    expect(altered.status).toBe(409);
    expect(altered.body.error.code).toBe('agent_registration_conflict');

    const stolen = await client.call('PUT',
      '/v2/account/agent-registrations/office-test-native-002', {
        token: accessToken, body,
      });
    expect(stolen.status).toBe(409);
    expect(stolen.body.error.code).toBe('identity_name_taken');

    const anotherAccount = await OAuthTestFlow.signUpAndGetToken();
    const anotherSlug = TestClient.uniqueName('office2');
    await client.registerOrganization(anotherAccount.accessToken, anotherSlug);
    const independent = await client.call('PUT', endpoint, {
      token: anotherAccount.accessToken, body,
    });
    expect(independent.status).toBe(200);
    expect(independent.body.data.session.canonical).toBe(
      anotherSlug + '/office-bear/main');
    expect(independent.body.data.session.id).not.toBe(first.body.data.session.id);
  });

  it('treats ten assistants hosted by one bot as ten Agents with independent main Sessions', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('grok');
    await client.registerOrganization(accessToken, slug);

    for (let index = 0; index < 10; index += 1) {
      const name = 'assistant-' + index;
      const claimed = await client.call('POST', '/v2/account/agents', {
        token: accessToken,
        body: { agentName: name },
      });
      expect(claimed.status).toBe(201);
      expect(claimed.body.data.session.canonical).toBe(`${slug}/${name}/main`);
      expect(claimed.body.data.session.isDefault).toBe(true);
      expect(claimed.body.data.session.runtime).toBeNull();
    }

    const agents = await client.call('GET', '/v2/account/agents', { token: accessToken });
    expect(agents.body.data).toHaveLength(10);
    expect(new Set(agents.body.data.map((agent: { id: string }) => agent.id)).size).toBe(10);
  });

  it('rejects old @Host address syntax instead of silently treating it as an Agent', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('nolegacy');
    await client.registerOrganization(accessToken, slug);
    await client.createAgent(accessToken, 'robot', 'main');

    const legacy = await client.call(
      'GET',
      '/v2/account/addresses?address=' + encodeURIComponent(`${slug}/@robot/main`),
      { token: accessToken },
    );
    expect(legacy.status).toBe(400);
    expect(legacy.body.error.code).toBe('invalid_handle');
  });

  it('registers an Agent from Portal without occupying its Session, then allows only one Runtime', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('portal');
    await client.registerOrganization(accessToken, slug);

    const registered = await client.call('POST', '/v2/account/agents', {
      token: accessToken,
      body: { agentName: 'xiaoming', sessionName: 'main' },
    });
    expect(registered.status).toBe(201);
    expect(registered.body.data.session.canonical).toBe(`${slug}/xiaoming/main`);
    expect(registered.body.data.runtimeToken).toBeUndefined();

    const sessionID = registered.body.data.session.id;
    const resumeBody = { resumeToken: registered.body.data.resumeToken };

    const first = await client.call('PUT', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: resumeBody,
    });
    expect(first.status).toBe(200);
    expect(first.body.data.session.canonical).toBe(`${slug}/xiaoming/main`);

    const second = await client.call('PUT', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: resumeBody,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('session_in_use');

    const released = await client.call('DELETE', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { runtimeToken: first.body.data.runtimeToken },
    });
    expect(released.status).toBe(200);
  });

  it('prevents cross-organization reads and resume even with a correct address', async () => {
    const owner = await OAuthTestFlow.signUpAndGetToken();
    const foreign = await OAuthTestFlow.signUpAndGetToken();
    const ownerSlug = TestClient.uniqueName('owner');
    await client.registerOrganization(owner.accessToken, ownerSlug);
    await client.registerOrganization(foreign.accessToken, TestClient.uniqueName('foreign'));

    const agent = await client.createAgent(owner.accessToken, 'private', 'task');
    const sessionID = agent.body.data.session.id;

    const exposed = await client.call('GET', `/v2/account/sessions/${sessionID}`, {
      token: foreign.accessToken,
    });
    expect(exposed.status).toBe(404);

    const resume = await client.call('PUT', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: foreign.accessToken,
      body: { resumeToken: agent.body.data.resumeToken },
    });
    expect(resume.status).toBe(404);

    const foreignRenewal = await client.call('PATCH',
      `/v2/account/sessions/${sessionID}/runtime-lease?include_identity=1`, {
        token: foreign.accessToken, body: { runtimeToken: agent.body.data.runtimeToken },
      });
    expect(foreignRenewal.status).toBe(404);

    const ownerRenewal = await client.call('PATCH',
      `/v2/account/sessions/${sessionID}/runtime-lease?include_identity=1`, {
        token: owner.accessToken, body: { runtimeToken: agent.body.data.runtimeToken },
      });
    expect(ownerRenewal.status).toBe(200);
    expect(ownerRenewal.body.data.session.id).toBe(sessionID);

    const resolved = await client.call(
      'GET',
      '/v2/account/addresses?address=' + encodeURIComponent(agent.body.data.session.canonical),
      { token: foreign.accessToken },
    );
    expect(resolved.status).toBe(403);

    const invalidResume = await client.call('PUT', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: owner.accessToken,
      body: { resumeToken: 'resume_wrong' },
    });
    expect(invalidResume.status).toBe(403);
  });

});
