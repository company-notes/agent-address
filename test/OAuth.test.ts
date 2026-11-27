import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { TestClient } from './Helpers';
import { OAuthTestFlow } from './OAuthFlow';

describe('OAuth', () => {
  const password = OAuthTestFlow.PASSWORD;

  it('advertises authorization server metadata', async () => {
    const response = await exports.default.fetch(
      new Request(`${TestClient.ORIGIN}/.well-known/oauth-authorization-server`),
    );
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as Record<string, string>;
    expect(metadata.authorization_endpoint).toBe(`${TestClient.ORIGIN}/authorize`);
    expect(metadata.registration_endpoint).toBe(`${TestClient.ORIGIN}/register`);
  });

  it('requires a token on /mcp and points clients at the OAuth server', async () => {
    const response = await exports.default.fetch(new Request(`${TestClient.ORIGIN}/mcp`, { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('answers a malformed authorization request with 400', async () => {
    const response = await exports.default.fetch(new Request(`${TestClient.ORIGIN}/authorize`));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
  });

  it('renders sign-in and sign-up forms carrying the authorization request', async () => {
    const flow = new OAuthTestFlow();
    await flow.registerClient();
    const { response, html, oauthRequest } = await flow.openLoginPage();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(html).toContain('Sign in');
    expect(html).toContain('id="su-confirm-password"');
    expect(html).toContain('name="organizationDisplayName"');
    expect(html).toContain('name="organizationSlug"');
    expect(html).toContain('name="passwordConfirmation"');
    expect(html).toContain('Registration key');
    expect(JSON.parse(oauthRequest).clientId).toBe(flow.clientId);
  });

  it('signs in once for Studio and opens trusted Relay management without another password', async () => {
    const studio = new OAuthTestFlow();
    await studio.registerClient();
    const page = await studio.openLoginPage();
    const email = TestClient.uniqueName('browser') + '@example.com';
    const signedIn = await studio.submitLogin({
      intent: 'signup', email, password, passwordConfirmation: password,
      registrationKey: TestClient.REGISTRATION_KEY,
    }, page.oauthRequest);
    expect(signedIn.status).toBe(302);
    const cookie = signedIn.headers.get('set-cookie')?.split(';')[0];
    expect(cookie, 'Successful sign-in must establish the browser session').toMatch(/^__Host-/);
    const studioTokens = await studio.exchangeCode(signedIn);
    const relay = new OAuthTestFlow('https://agent-relay.company-notes.com/manage/callback');
    await relay.registerClient();
    const managementURL = TestClient.ORIGIN + await relay.authorizeURL();
    const redirected = await exports.default.fetch(new Request(managementURL, {
      headers: { cookie: cookie! }, redirect: 'manual',
    }));
    expect(redirected.status).toBe(302);
    const relayTokens = await relay.exchangeCode(redirected);
    const client = new TestClient();
    const studioAccount = await client.call('GET', '/v2/account/status', { token: studioTokens.accessToken });
    const relayAccount = await client.call('GET', '/v2/account/status', { token: relayTokens.accessToken });
    expect(relayAccount.body.data.organization.id).toBe(studioAccount.body.data.organization.id);

    const portal = new OAuthTestFlow(TestClient.ORIGIN + '/portal/callback');
    await portal.registerClient();
    const portalURL = TestClient.ORIGIN + await portal.authorizeURL();
    const portalRedirect = await exports.default.fetch(new Request(portalURL, {
      headers: { cookie: cookie! }, redirect: 'manual',
    }));
    expect(portalRedirect.status, 'The trusted Portal must reuse the browser login').toBe(302);
    const portalTokens = await portal.exchangeCode(portalRedirect);
    const portalAccount = await client.call('GET', '/v2/account/status', { token: portalTokens.accessToken });
    expect(portalAccount.body.data.account.email).toBe(email);
    expect(portalAccount.body.data.organization.id).toBe(relayAccount.body.data.organization.id);

    const portalForced = await exports.default.fetch(new Request(portalURL + '&prompt=login', {
      headers: { cookie: cookie! }, redirect: 'manual',
    }));
    expect(portalForced.status, 'Explicit Portal sign-in must still allow account switching').toBe(200);

    const thirdParty = await exports.default.fetch(new Request(TestClient.ORIGIN + await studio.authorizeURL(), {
      headers: { cookie: cookie! }, redirect: 'manual',
    }));
    expect(thirdParty.status, 'Other OAuth clients still require an explicit login').toBe(200);
    const forced = await exports.default.fetch(new Request(managementURL + '&prompt=login', {
      headers: { cookie: cookie! }, redirect: 'manual',
    }));
    expect(forced.status, 'Account switching must show the login form').toBe(200);
  });

  it('requires matching registration passwords before creating an Account', async () => {
    const flow = new OAuthTestFlow();
    await flow.registerClient();
    const { oauthRequest } = await flow.openLoginPage();
    const email = `${TestClient.uniqueName('confirmation')}@example.com`;
    const organizationSlug = TestClient.uniqueName('confirmation');

    const mismatch = await flow.submitLogin({
      intent: 'signup', email, password,
      passwordConfirmation: 'a-different-private-password',
      organizationSlug, organizationDisplayName: 'Mismatch test organization',
      registrationKey: TestClient.REGISTRATION_KEY,
    }, oauthRequest);

    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain('Passwords do not match');
    expect(mismatch.headers.get('location')).toBeNull();

    const missing = await flow.submitLogin({
      intent: 'signup', email, password,
      organizationSlug, organizationDisplayName: 'Mismatch test organization',
      registrationKey: TestClient.REGISTRATION_KEY,
    }, oauthRequest);

    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain('Confirm your password');

    const success = await flow.submitLogin({
      intent: 'signup', email, password,
      passwordConfirmation: password,
      organizationSlug, organizationDisplayName: 'Registration test ' + organizationSlug,
      registrationKey: TestClient.REGISTRATION_KEY,
    }, oauthRequest);

    expect(success.status).toBe(302);
    expect(success.headers.get('location')).toContain('code=');
  });

  it('creates a named Organization atomically and rejects conflicting names and handles', async () => {
    const original = new OAuthTestFlow();
    await original.registerClient();
    const firstPage = await original.openLoginPage();
    const firstSlug = TestClient.uniqueName('registered');
    const firstEmail = `${TestClient.uniqueName('owner')}@example.com`;
    const organizationDisplayName = 'Nuwa testing ' + firstSlug;
    const first = await original.submitLogin({
      intent: 'signup', email: firstEmail, password, passwordConfirmation: password,
      organizationSlug: firstSlug, organizationDisplayName,
      registrationKey: TestClient.REGISTRATION_KEY,
    }, firstPage.oauthRequest);
    expect(first.status).toBe(302);

    const competing = new OAuthTestFlow();
    await competing.registerClient();
    const competingPage = await competing.openLoginPage();
    const secondEmail = `${TestClient.uniqueName('competitor')}@example.com`;
    const secondSlug = TestClient.uniqueName('other');

    for (const organization of [
      { organizationSlug: secondSlug, organizationDisplayName: '  ' + organizationDisplayName.toUpperCase() + '  ' },
      { organizationSlug: firstSlug.toUpperCase(), organizationDisplayName: 'Another ' + secondSlug },
    ]) {
      const conflict = await competing.submitLogin({
        intent: 'signup', email: secondEmail, password, passwordConfirmation: password,
        ...organization, registrationKey: TestClient.REGISTRATION_KEY,
      }, competingPage.oauthRequest);
      expect(conflict.status).toBe(400);
      expect(await conflict.text()).toContain('Organization name is already registered');
    }

    const account = await new TestClient().call('GET', '/v2/account/status', {
      token: (await original.exchangeCode(first)).accessToken,
    });
    expect(account.body.data.organization).toMatchObject({
      slug: firstSlug, displayName: organizationDisplayName,
    });

    // A collision must not leave behind an account row, even if it passed email validation.
    const orphan = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?')
      .bind(secondEmail).first();
    expect(orphan).toBeNull();
  });

  it('registers separate personal and team identities without choosing names', async () => {
    const seen = new Set<string>();

    for (const [organizationType, prefix] of [
      ['personal', 'personal'], ['personal', 'personal'], ['team', 'company'],
    ]) {
      const flow = new OAuthTestFlow();
      await flow.registerClient();
      const { oauthRequest } = await flow.openLoginPage();
      const email = `${TestClient.uniqueName('quick')}@example.com`;
      const signedUp = await flow.submitLogin({
        intent: 'signup', email, password, passwordConfirmation: password,
        organizationType, registrationKey: TestClient.REGISTRATION_KEY,
      }, oauthRequest);
      expect(signedUp.status).toBe(302);

      const { accessToken } = await flow.exchangeCode(signedUp);
      const account = await new TestClient().call('GET', '/v2/account/status', { token: accessToken });
      expect(account.status).toBe(200);
      const organization = account.body.data.organization;
      expect(organization.slug).toMatch(new RegExp('^' + prefix + '-[a-f0-9]{12}$'));
      expect(organization.displayName.toLowerCase()).toBe(organization.slug.replace('-', ' '));
      expect(seen.has(organization.slug)).toBe(false);
      seen.add(organization.slug);
      const saved = await env.DB.prepare('SELECT org_id FROM accounts WHERE email = ?')
        .bind(email).first<{ org_id: string }>();
      expect(saved?.org_id).toBe(organization.id);
    }
  });

  it('creates an account and issues tokens through the code flow', async () => {
    const tokens = await OAuthTestFlow.signUpAndGetToken();
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });

  it('keeps the authoritative grant identity stable across access-token refresh but isolates a new grant', async () => {
    const flow = new OAuthTestFlow();
    const email = `${TestClient.uniqueName('grant')}@example.com`;
    const first = await flow.authorizeAccount('signup', email, password);

    expect(first.refreshToken).toBeTruthy();

    const fingerprint = async (token: string) => {
      const response = await exports.default.fetch(new Request(
        `${TestClient.ORIGIN}/v2/account/grant`, {
          headers: { authorization: 'Bearer ' + token },
        },
      ));
      expect(response.status).toBe(200);
      const result = await response.json() as { data: { grantFingerprint: string } };
      expect(result.data.grantFingerprint).toMatch(/^[a-f0-9]{64}$/);

      return result.data.grantFingerprint;
    };

    const originalGrant = await fingerprint(first.accessToken);
    const refreshed = await flow.refresh(first.refreshToken!);

    expect(refreshed.accessToken).not.toBe(first.accessToken);
    expect(await fingerprint(refreshed.accessToken)).toBe(originalGrant);

    const otherFlow = new OAuthTestFlow();
    const other = await otherFlow.authorizeAccount('signin', email, password);

    expect(await fingerprint(other.accessToken)).not.toBe(originalGrant);

    const missing = await exports.default.fetch(new Request(
      `${TestClient.ORIGIN}/v2/account/grant`,
    ));
    expect(missing.status).toBe(401);
  });

  it('signs an existing account in', async () => {
    const { email } = await OAuthTestFlow.signUpAndGetToken();
    const tokens = await new OAuthTestFlow().authorizeAccount('signin', email, password);
    expect(tokens.accessToken).toBeTruthy();
  });

  it('rejects an unrecognized login intent instead of silently signing in', async () => {
    const flow = new OAuthTestFlow();
    await flow.registerClient();

    const { oauthRequest } = await flow.openLoginPage();
    const response = await flow.submitLogin({
      intent: 'unknown-operation',
      email: 'user@example.com',
      password: 'a-long-password',
    }, oauthRequest);

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: { code: string } })
      .toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('shows an error and issues no code for a wrong password', async () => {
    const { email } = await OAuthTestFlow.signUpAndGetToken();
    const flow = new OAuthTestFlow();
    await flow.registerClient();
    const { oauthRequest } = await flow.openLoginPage();

    const response = await flow.submitLogin({ intent: 'signin', email, password: 'wrong password!' }, oauthRequest);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Email or password is incorrect.');
  });

  it('rejects sign-up without the registration key', async () => {
    const flow = new OAuthTestFlow();
    await flow.registerClient();
    const { oauthRequest } = await flow.openLoginPage();

    const response = await flow.submitLogin(
      { intent: 'signup', email: `${TestClient.uniqueName('user')}@example.com`, password, passwordConfirmation: password },
      oauthRequest,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('registration key');
  });

  it('escapes hostile values in the rendered page', async () => {
    const flow = new OAuthTestFlow();
    await flow.registerClient();
    const { oauthRequest } = await flow.openLoginPage();

    const response = await flow.submitLogin(
      { intent: 'signin', email: '"><script>alert(1)</script>', password },
      oauthRequest,
    );
    expect(await response.text()).not.toContain('<script>alert(1)</script>');
  });

  it('rejects an unregistered redirect URI when completing the grant', async () => {
    const { email } = await OAuthTestFlow.signUpAndGetToken();
    const flow = new OAuthTestFlow();
    await flow.registerClient();
    const { oauthRequest } = await flow.openLoginPage();
    const tampered = JSON.stringify({ ...JSON.parse(oauthRequest), redirectUri: 'https://evil.example/cb' });

    const response = await flow.submitLogin({ intent: 'signin', email, password }, tampered);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get('location')).toBeNull();
  });
});
