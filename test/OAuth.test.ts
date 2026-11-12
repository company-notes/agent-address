import { exports } from 'cloudflare:workers';
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
    expect(html).toContain('name="passwordConfirmation"');
    expect(html).toContain('Registration key');
    expect(JSON.parse(oauthRequest).clientId).toBe(flow.clientId);
  });

  it('requires matching registration passwords before creating an Account', async () => {
    const flow = new OAuthTestFlow();
    await flow.registerClient();
    const { oauthRequest } = await flow.openLoginPage();
    const email = `${TestClient.uniqueName('confirmation')}@example.com`;

    const mismatch = await flow.submitLogin({
      intent: 'signup', email, password,
      passwordConfirmation: 'a-different-private-password',
      registrationKey: TestClient.REGISTRATION_KEY,
    }, oauthRequest);

    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain('Passwords do not match');
    expect(mismatch.headers.get('location')).toBeNull();

    const missing = await flow.submitLogin({
      intent: 'signup', email, password,
      registrationKey: TestClient.REGISTRATION_KEY,
    }, oauthRequest);

    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain('Confirm your password');

    const success = await flow.submitLogin({
      intent: 'signup', email, password,
      passwordConfirmation: password,
      registrationKey: TestClient.REGISTRATION_KEY,
    }, oauthRequest);

    expect(success.status).toBe(302);
    expect(success.headers.get('location')).toContain('code=');
  });

  it('creates an account and issues tokens through the code flow', async () => {
    const tokens = await OAuthTestFlow.signUpAndGetToken();
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
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
      { intent: 'signup', email: `${TestClient.uniqueName('user')}@example.com`, password },
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
