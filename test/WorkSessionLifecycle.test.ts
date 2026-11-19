import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

class WorkClaimScenario {
  readonly client = new TestClient();

  static credentials() {
    return {
      sessionID: crypto.randomUUID(),
      resumeToken: 'resume_' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
      runtimeToken: 'runtime_' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
    };
  }

  async start(token: string, claim: ReturnType<typeof WorkClaimScenario.credentials>, agentID?: string) {
    const path = agentID
      ? `/v2/account/agents/${agentID}/session-runtime-leases`
      : '/v2/account/agent-runtime-leases';

    return this.client.call('POST', path, {
      token,
      body: {
        ...(agentID
          ? { sessionName: 'fix-share-parser', sessionDisplayName: 'Fix ChatGPT share parser' }
          : { agentDisplayName: 'Codex' }),
        claim,
      },
    });
  }
}

describe('remote work Session lifecycle through real OAuth, HTTP and D1', () => {
  it('retries lost and concurrent claims under the same Agent without invalidating the office directory', async () => {
    const scenario = new WorkClaimScenario();
    const { accessToken: token } = await OAuthTestFlow.signUpAndGetToken();
    const slug = TestClient.uniqueName('work');
    await scenario.client.registerOrganization(token, slug);

    const rootClaim = WorkClaimScenario.credentials();
    const roots = await Promise.all([scenario.start(token, rootClaim), scenario.start(token, rootClaim)]);

    for (const root of roots) {
      expect(root.status).toBe(201);
      expect(root.body.data.session.id).toBe(rootClaim.sessionID);
      expect(root.body.data.session.canonical).toBe(slug + '/codex/main');
    }

    const agentID = roots[0].body.data.session.agentId;
    const revision = async () => (await env.DB.prepare(
      'SELECT identity_revision AS revision FROM organizations WHERE slug = ?',
    ).bind(slug).first<{ revision: number }>())!.revision;
    const before = await revision();

    const firstClaim = WorkClaimScenario.credentials();
    const secondClaim = WorkClaimScenario.credentials();
    const [first, repeated, second] = await Promise.all([
      scenario.start(token, firstClaim, agentID),
      scenario.start(token, firstClaim, agentID),
      scenario.start(token, secondClaim, agentID),
    ]);

    for (const response of [first, repeated, second]) {
      expect(response.status).toBe(201);
      expect(response.body.data.session.agentId).toBe(agentID);
    }

    expect(first.body.data.session.id).toBe(firstClaim.sessionID);
    expect(repeated.body.data.session.id).toBe(firstClaim.sessionID);
    expect(repeated.body.data.runtimeToken).toBe(first.body.data.runtimeToken);
    expect(second.body.data.session.id).toBe(secondClaim.sessionID);
    expect(first.body.data.session.canonical).not.toBe(second.body.data.session.canonical);
    expect([first, second].some((item) =>
      item.body.data.session.canonical === slug + '/codex/fix-share-parser')).toBe(true);
    expect(await revision()).toBe(before);

    const list = await scenario.client.call('GET', `/v2/account/agents/${agentID}/sessions`, { token });
    expect(list.body.data).toHaveLength(3);

    const resumed = await scenario.start(token, firstClaim, agentID);
    expect(resumed.body.data.session.id).toBe(firstClaim.sessionID);
    const wrong = await scenario.start(token, { ...secondClaim, resumeToken: firstClaim.resumeToken }, agentID);
    expect(wrong.status).toBe(409);

    const other = await OAuthTestFlow.signUpAndGetToken();
    await scenario.client.registerOrganization(other.accessToken, TestClient.uniqueName('foreign'));
    expect((await scenario.start(other.accessToken, firstClaim, agentID)).status).toBe(404);

    const renamed = await scenario.client.call('PATCH', `/v2/account/sessions/${firstClaim.sessionID}`, {
      token, body: { sessionName: 'share-parser-fixed' },
    });
    expect(renamed.status).toBe(200);
    expect(await revision()).toBeGreaterThan(before);
    expect((await scenario.start(token, firstClaim, agentID)).body.data.session.canonical)
      .toBe(slug + '/codex/share-parser-fixed');
  });
});
