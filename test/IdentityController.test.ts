import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

describe('identity account API boundaries', () => {
  const client = new TestClient();

  it('requires an OAuth account and organization before identities can be created', async () => {
    const anonymous = await client.call('GET', '/v2/account/agents');
    expect(anonymous.status).toBe(401);

    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const unlinked = await client.createAgent(accessToken, 'releasebot', 'main');
    expect(unlinked.status).toBe(409);
    expect(unlinked.body.error.code).toBe('no_organization');
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

    const resume = await client.call('POST', `/v2/account/sessions/${sessionID}/resume`, {
      token: foreign.accessToken,
      body: { resumeToken: agent.body.data.resumeToken },
    });
    expect(resume.status).toBe(404);

    const resolved = await client.call(
      'GET',
      '/v2/account/resolve?address=' + encodeURIComponent(agent.body.data.session.canonical),
      { token: foreign.accessToken },
    );
    expect(resolved.status).toBe(403);

    const invalidResume = await client.call('POST', `/v2/account/sessions/${sessionID}/resume`, {
      token: owner.accessToken,
      body: { resumeToken: 'resume_wrong' },
    });
    expect(invalidResume.status).toBe(403);
  });


});
