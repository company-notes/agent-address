import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

describe('Organization identity lifecycle (real OAuth, Worker and D1)', () => {
  const client = new TestClient();

  it('updates human display names and address handles without changing immutable identity', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('rename');
    await client.registerOrganization(accessToken, slug);

    const created = await client.call('POST', '/v2/account/agents', {
      token: accessToken,
      body: { agentName: 'coder', sessionName: 'ffl' },
    });
    expect(created.status).toBe(201);

    const { agentId, id: sessionID } = created.body.data.session;
    const updatedAgent = await client.call('PATCH', `/v2/account/agents/${agentId}`, {
      token: accessToken,
      body: { agentName: 'developer', agentDisplayName: '開發助理' },
    });
    expect(updatedAgent.status).toBe(200);
    expect(updatedAgent.body.data.id).toBe(agentId);
    expect(updatedAgent.body.data.displayName).toBe('開發助理');

    const updatedSession = await client.call('PATCH', `/v2/account/sessions/${sessionID}`, {
      token: accessToken,
      body: { sessionName: 'ffl-dev', sessionDisplayName: 'FFL 開發' },
    });
    expect(updatedSession.status).toBe(200);
    expect(updatedSession.body.data).toMatchObject({
      id: sessionID,
      canonical: `${slug}/developer/ffl-dev`,
      displayName: 'FFL 開發',
    });

    const old = await client.call('GET', `/v2/account/addresses?address=${slug}/coder/ffl`, {
      token: accessToken,
    });
    expect(old.status).toBe(404);

    const current = await client.call('GET', `/v2/account/addresses?address=${slug}/developer`, {
      token: accessToken,
    });
    expect(current.body.data.id).toBe(sessionID);

    const row = await env.DB.prepare(
      'SELECT handle, display_name AS displayName FROM sessions WHERE id = ?',
    ).bind(sessionID).first<{ handle: string; displayName: string }>();
    expect(row).toMatchObject({ handle: 'ffl-dev', displayName: 'FFL 開發' });

    const renamedOrg = await client.call('PATCH', '/v2/account/organization', {
      token: accessToken,
      body: { displayName: 'Nuwa R&D' },
    });
    expect(renamedOrg.status).toBe(200);
    expect(renamedOrg.body.data).toMatchObject({ slug, displayName: 'Nuwa R&D' });
  });

  it('switches the default Session before archiving; deactivated addresses and capabilities stop working', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('archive');
    await client.registerOrganization(accessToken, slug);

    const first = await client.createAgent(accessToken, 'robot', 'main');
    const agentID = first.body.data.session.agentId;
    const mainID = first.body.data.session.id;
    const extra = await client.call('POST', `/v2/account/agents/${agentID}/session-runtime-leases`, {
      token: accessToken,
      body: { sessionName: 'research' },
    });
    expect(extra.status).toBe(201);

    const extraID = extra.body.data.session.id;
    const protectedDefault = await client.call('DELETE', `/v2/account/sessions/${mainID}`, {
      token: accessToken,
    });
    expect(protectedDefault.status).toBe(409);
    expect(protectedDefault.body.error.code).toBe('default_session_required');

    const setDefault = await client.call('PUT', `/v2/account/sessions/${extraID}/default-selection`, {
      token: accessToken,
    });
    expect(setDefault.status).toBe(200);
    expect(setDefault.body.data.isDefault).toBe(true);

    const archivedMain = await client.call('DELETE', `/v2/account/sessions/${mainID}`, {
      token: accessToken,
    });
    expect(archivedMain.status).toBe(200);

    const selected = await client.call('GET', `/v2/account/addresses?address=${slug}/robot`, {
      token: accessToken,
    });
    expect(selected.body.data.id).toBe(extraID);

    const disabled = await client.call('GET', `/v2/account/sessions/${mainID}`, { token: accessToken });
    expect(disabled.status).toBe(404);

    const archivedAgent = await client.call('DELETE', `/v2/account/agents/${agentID}`, {
      token: accessToken,
    });
    expect(archivedAgent.status).toBe(200);

    const oldLease = await client.call('PATCH', `/v2/account/sessions/${extraID}/runtime-lease`, {
      token: accessToken,
      body: { runtimeToken: extra.body.data.runtimeToken },
    });
    expect(oldLease.status).toBe(404);

    const oldResume = await client.call('PUT', `/v2/account/sessions/${extraID}/runtime-lease`, {
      token: accessToken,
      body: { resumeToken: extra.body.data.resumeToken },
    });
    expect(oldResume.status).toBe(404);

    const remaining = await client.call('GET', '/v2/account/agents', { token: accessToken });
    expect(remaining.body.data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: agentID }),
    ]));

    const newAgent = await client.call('POST', '/v2/account/agents', {
      token: accessToken,
      body: { agentName: 'robot', sessionName: 'main' },
    });
    expect(newAgent.status).toBe(201);
    expect(newAgent.body.data.session.agentId).not.toBe(agentID);
  });

  it('rotates a lost resume capability without revoking a current Runtime', async () => {
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    await client.registerOrganization(accessToken, TestClient.uniqueName('rotate'));

    const original = await client.createAgent(accessToken, 'testbot', 'main');
    const sessionID = original.body.data.session.id;
    const rotated = await client.call('PUT', `/v2/account/sessions/${sessionID}/resume-credential`, {
      token: accessToken,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.resumeToken).not.toBe(original.body.data.resumeToken);

    const active = await client.call('PATCH', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { runtimeToken: original.body.data.runtimeToken },
    });
    expect(active.status).toBe(200);

    const released = await client.call('DELETE', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { runtimeToken: original.body.data.runtimeToken },
    });
    expect(released.status).toBe(200);

    const outdated = await client.call('PUT', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { resumeToken: original.body.data.resumeToken },
    });
    expect(outdated.status).toBe(403);

    const recovered = await client.call('PUT', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { resumeToken: rotated.body.data.resumeToken },
    });
    expect(recovered.status).toBe(200);
  });

  it('recovers an idle address for its Organization owner without changing Agent or Session IDs', async () => {
    const owner = await OAuthTestFlow.signUpAndGetToken();
    const outsider = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('recovery');
    await client.registerOrganization(owner.accessToken, slug);
    await client.registerOrganization(outsider.accessToken, TestClient.uniqueName('other'));

    const original = await client.createAgent(owner.accessToken, 'gateway', 'main');
    const sessionID = original.body.data.session.id;
    const endpoint = `/v2/account/sessions/${sessionID}/owner-runtime-lease`;

    const busy = await client.call('PUT', endpoint, { token: owner.accessToken, body: {} });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('session_in_use');

    const released = await client.call('DELETE',
      `/v2/account/sessions/${sessionID}/runtime-lease`, {
        token: owner.accessToken,
        body: { runtimeToken: original.body.data.runtimeToken },
      });
    expect(released.status).toBe(200);

    const foreign = await client.call('PUT', endpoint, { token: outsider.accessToken, body: {} });
    expect(foreign.status).toBe(404);

    const recovered = await client.call('PUT', endpoint, { token: owner.accessToken, body: {} });
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.session).toMatchObject({
      id: sessionID,
      agentId: original.body.data.session.agentId,
      canonical: `${slug}/gateway/main`,
    });
    expect(recovered.body.data.resumeToken).not.toBe(original.body.data.resumeToken);

    const oldCapability = await client.call('PUT',
      `/v2/account/sessions/${sessionID}/runtime-lease`, {
        token: owner.accessToken,
        body: { resumeToken: original.body.data.resumeToken },
      });
    expect(oldCapability.status).toBe(403);
    expect(oldCapability.body.error.code).toBe('invalid_resume_token');

    const agents = await client.call('GET', '/v2/account/agents', {
      token: owner.accessToken,
    });
    expect(agents.body.data).toHaveLength(1);
  });

  it('blocks another Organization from modifying, archiving, or rotating an Agent Session', async () => {
    const first = await OAuthTestFlow.signUpAndGetToken();
    const second = await OAuthTestFlow.signUpAndGetToken();
    await client.registerOrganization(first.accessToken, TestClient.uniqueName('first'));
    await client.registerOrganization(second.accessToken, TestClient.uniqueName('second'));

    const claimed = await client.createAgent(first.accessToken, 'private', 'main');
    const agentID = claimed.body.data.session.agentId;
    const sessionID = claimed.body.data.session.id;

    for (const [method, path, body] of [
      ['PATCH', `/v2/account/agents/${agentID}`, { agentName: 'hijack' }],
      ['DELETE', `/v2/account/agents/${agentID}`, undefined],
      ['PATCH', `/v2/account/sessions/${sessionID}`, { sessionName: 'hijack' }],
      ['DELETE', `/v2/account/sessions/${sessionID}`, undefined],
      ['PUT', `/v2/account/sessions/${sessionID}/default-selection`, undefined],
      ['PUT', `/v2/account/sessions/${sessionID}/resume-credential`, undefined],
    ] as const) {
      const result = await client.call(method, path, { token: second.accessToken, body });
      expect(result.status).toBe(404);
    }
  });
});
