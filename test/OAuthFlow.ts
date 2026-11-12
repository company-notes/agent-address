import { exports } from 'cloudflare:workers';

import { TestClient } from './Helpers';

export type OAuthTokens = { accessToken: string; refreshToken?: string };

// Drives the same OAuth 2.1 authorization-code + PKCE flow a real MCP client performs.
export class OAuthTestFlow {
  static readonly REDIRECT_URI = 'http://localhost:8123/callback';
  static readonly PASSWORD = 'correct horse battery';

  private static base64URL(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private static unescapeHTML(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  private static fetch(path: string, init?: RequestInit): Promise<Response> {
    return exports.default.fetch(new Request(`${TestClient.ORIGIN}${path}`, init));
  }

  static async signUpAndGetToken(): Promise<OAuthTokens & { email: string }> {
    const email = `${TestClient.uniqueName('user')}@example.com`;
    const tokens = await new OAuthTestFlow().authorizeAccount('signup', email, OAuthTestFlow.PASSWORD);

    return { ...tokens, email };
  }

  private readonly verifier = OAuthTestFlow.base64URL(crypto.getRandomValues(new Uint8Array(32)));

  clientId = '';

  async registerClient(): Promise<void> {
    const response = await OAuthTestFlow.fetch('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'test client',
        redirect_uris: [OAuthTestFlow.REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    this.clientId = ((await response.json()) as { client_id: string }).client_id;
  }

  private async authorizeURL(): Promise<string> {
    const challenge = OAuthTestFlow.base64URL(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.verifier))),
    );
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: OAuthTestFlow.REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    });
    return `/authorize?${query}`;
  }

  async openLoginPage(): Promise<{ response: Response; html: string; oauthRequest: string }> {
    const response = await OAuthTestFlow.fetch(await this.authorizeURL());
    const html = await response.text();
    const match = html.match(/name="oauthRequest" value="([^"]*)"/);
    return { response, html, oauthRequest: match ? OAuthTestFlow.unescapeHTML(match[1]) : '' };
  }

  submitLogin(fields: Record<string, string>, oauthRequest: string): Promise<Response> {
    return OAuthTestFlow.fetch('/authorize', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ oauthRequest, ...fields }),
    });
  }

  async exchangeCode(redirect: Response): Promise<OAuthTokens> {
    const location = new URL(redirect.headers.get('location') ?? '');
    const response = await OAuthTestFlow.fetch('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: location.searchParams.get('code') ?? '',
        redirect_uri: OAuthTestFlow.REDIRECT_URI,
        client_id: this.clientId,
        code_verifier: this.verifier,
      }),
    });
    const tokens = (await response.json()) as { access_token: string; refresh_token?: string };
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
  }

  async refresh(refreshToken: string): Promise<OAuthTokens> {
    if (!this.clientId) {
      throw new Error('Register the OAuth client before exchanging a refresh token.');
    }

    const response = await OAuthTestFlow.fetch('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
      }),
    });
    const tokens = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!response.ok || !tokens.access_token) {
      throw new Error('OAuth refresh did not return a valid access token.');
    }

    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
  }

  async authorizeAccount(intent: 'signin' | 'signup', email: string, password: string): Promise<OAuthTokens> {
    await this.registerClient();
    const { oauthRequest } = await this.openLoginPage();
    const fields: Record<string, string> = { intent, email, password };
    if (intent === 'signup') {
      fields.registrationKey = TestClient.REGISTRATION_KEY;
      fields.passwordConfirmation = password;
    }
    return this.exchangeCode(await this.submitLogin(fields, oauthRequest));
  }
}
