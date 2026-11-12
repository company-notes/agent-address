type OAuthRegistration = { client_id: string };
type OAuthTokenResponse = { access_token: string };

export class PortalOAuth {
  private static readonly TOKEN_KEY = 'agentAddressAccessToken';
  private static readonly VERIFIER_KEY = 'agentAddressPKCEVerifier';
  private static readonly CLIENT_KEY = 'agentAddressOAuthClient';
  private static readonly STATE_KEY = 'agentAddressOAuthState';
  private static completePromise: Promise<string | null> | null = null;

  private static base64URL(bytes: Uint8Array): string {
    let binary = '';

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private static redirectURI(): string {
    return window.location.origin + '/portal/callback';
  }

  static getToken(): string | null {
    return sessionStorage.getItem(this.TOKEN_KEY);
  }

  static signOut(): void {
    sessionStorage.removeItem(this.TOKEN_KEY);
    this.completePromise = null;
  }

  static async signIn(): Promise<void> {
    const verifier = this.base64URL(crypto.getRandomValues(new Uint8Array(32)));
    const state = this.base64URL(crypto.getRandomValues(new Uint8Array(16)));
    const redirectURI = this.redirectURI();

    const registered = await fetch('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Agent Address Organization Portal',
        redirect_uris: [redirectURI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });

    if (!registered.ok) {
      throw new Error('Unable to register the Portal OAuth client.');
    }

    const client = await registered.json() as OAuthRegistration;

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = this.base64URL(new Uint8Array(digest));

    sessionStorage.setItem(this.VERIFIER_KEY, verifier);
    sessionStorage.setItem(this.CLIENT_KEY, client.client_id);
    sessionStorage.setItem(this.STATE_KEY, state);

    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectURI,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    window.location.assign('/authorize?' + query);
  }

  static completeSignIn(): Promise<string | null> {
    if (!this.completePromise) {
      this.completePromise = this.exchangeCallback();
    }

    return this.completePromise;
  }

  private static async exchangeCallback(): Promise<string | null> {
    if (window.location.pathname !== '/portal/callback') {
      return this.getToken();
    }

    const query = new URLSearchParams(window.location.search);
    const code = query.get('code');
    const state = query.get('state');
    const expectedState = sessionStorage.getItem(this.STATE_KEY);
    const verifier = sessionStorage.getItem(this.VERIFIER_KEY);
    const clientID = sessionStorage.getItem(this.CLIENT_KEY);

    if (!code || !expectedState || state !== expectedState || !verifier || !clientID) {
      throw new Error('OAuth authorization callback is incomplete or invalid.');
    }

    const response = await fetch('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectURI(),
        client_id: clientID,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      throw new Error('Unable to exchange OAuth authorization code.');
    }

    const result = await response.json() as OAuthTokenResponse;
    sessionStorage.setItem(this.TOKEN_KEY, result.access_token);
    sessionStorage.removeItem(this.STATE_KEY);
    sessionStorage.removeItem(this.VERIFIER_KEY);
    sessionStorage.removeItem(this.CLIENT_KEY);

    window.history.replaceState({}, '', '/portal/');

    return result.access_token;
  }
}
