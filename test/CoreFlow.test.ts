import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

describe('core Organization Agent Session scenario (real OAuth, Worker, D1)', () => {
  it('registers the organization, creates two Agents, resolves Sessions, rejects takeover and resumes safely', async () => {
    const client = new TestClient();
    const { accessToken } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('nuwa');

    const organization = await client.registerOrganization(accessToken, slug);
    expect(organization.status).toBe(201);

    const windows = await client.createAgent(accessToken, undefined, 'ffl-dev');
    expect(windows.status).toBe(201);
    expect(windows.body.data.session.canonical)
      .toMatch(new RegExp(`^${slug}/agent-[a-f0-9]{8}/ffl-dev$`));

    const mac = await client.createAgent(accessToken, undefined, 'ffl-dev-mac');
    expect(mac.status).toBe(201);
    expect(mac.body.data.session.agentId).not.toBe(windows.body.data.session.agentId);

    const sql = await env.DB.prepare(
      `SELECT a.org_id AS orgID, s.handle, s.is_default AS isDefault
         FROM sessions s JOIN agents a ON a.id = s.agent_id
        WHERE s.id = ?`,
    ).bind(windows.body.data.session.id)
      .first<{ orgID: string; handle: string; isDefault: number }>();

    expect(sql).toMatchObject({
      orgID: organization.body.data.id,
      handle: 'ffl-dev',
      isDefault: 1,
    });

    const directory = await client.call('GET', '/v2/account/agents', { token: accessToken });
    expect(directory.status).toBe(200);
    expect(directory.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: windows.body.data.session.agentId }),
      expect.objectContaining({ id: mac.body.data.session.agentId }),
    ]));

    const full = await client.call('GET', '/v2/account/addresses?address=' +
      encodeURIComponent(windows.body.data.session.canonical), { token: accessToken });
    expect(full.status).toBe(200);
    expect(full.body.data.id).toBe(windows.body.data.session.id);

    const agentAddress = `${slug}/${windows.body.data.session.agentHandle}`;
    const defaultResolved = await client.call('GET', '/v2/account/addresses?address=' +
      encodeURIComponent(agentAddress), { token: accessToken });
    expect(defaultResolved.body.data.id).toBe(windows.body.data.session.id);

    const sessionID = windows.body.data.session.id;
    const resumeBody = { resumeToken: windows.body.data.resumeToken, runtimeLabel: 'mac' };

    const conflicted = await client.call('PUT', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: resumeBody,
    });
    expect(conflicted.status).toBe(409);
    expect(conflicted.body.error.code).toBe('session_in_use');

    const released = await client.call('DELETE', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { runtimeToken: windows.body.data.runtimeToken },
    });
    expect(released.status).toBe(200);

    const resumed = await client.call('PUT', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: resumeBody,
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.session.canonical).toBe(windows.body.data.session.canonical);
    expect(resumed.body.data.runtimeToken).not.toBe(windows.body.data.runtimeToken);

    const formerOwner = await client.call('PATCH', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { runtimeToken: windows.body.data.runtimeToken },
    });
    expect(formerOwner.status).toBe(409);

    const heartbeat = await client.call('PATCH', `/v2/account/sessions/${sessionID}/runtime-lease`, {
      token: accessToken,
      body: { runtimeToken: resumed.body.data.runtimeToken },
    });
    expect(heartbeat.status).toBe(200);
  });
});
