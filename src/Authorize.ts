import type { AuthRequest } from '@cloudflare/workers-oauth-provider';

import { AccountRow } from './Accounts';
import { Env } from './Env';
import { APIError } from './HTTP';
import { Services } from './Services';

type FormValues = {
  intent: 'signin' | 'signup';
  email: string;
  error: string | null;
  needsRegistrationKey: boolean;
};

export type AccountProps = {
  accountId: string;
  authVersion?: number;
};

class AuthorizePage {
  static readonly HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  };

  private static escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private static readonly STYLE = `
    :root {
      color-scheme: light dark;
      font-family: system-ui, sans-serif;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: Canvas;
      color: CanvasText;
    }

    main {
      width: min(26rem, 92vw);
      padding: 1.5rem 0;
    }

    h1 {
      font-size: 1.3rem;
      margin: 0 0 .25rem;
    }

    p.lead {
      margin: 0 0 1.25rem;
      opacity: .75;
    }

    form {
      border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
      border-radius: .6rem;
      padding: 1rem;
      margin-bottom: 1rem;
    }

    h2 {
      font-size: 1rem;
      margin: 0 0 .75rem;
    }

    label {
      display: block;
      font-size: .85rem;
      margin: .6rem 0 .2rem;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: .5rem;
      font: inherit;
    }

    button {
      margin-top: .9rem;
      padding: .5rem 1rem;
      font: inherit;
      cursor: pointer;
    }

    .error {
      color: #b00020;
      margin: 0 0 1rem;
    }

    details {
      margin-top: .6rem;
      font-size: .9rem;
    }
  `;

  constructor(private readonly oauthRequest: AuthRequest) {}

  private hiddenFields(intent: string): string {
    const encoded = AuthorizePage.escape(JSON.stringify(this.oauthRequest));

    return `<input type="hidden" name="oauthRequest" value="${encoded}"><input type="hidden" name="intent" value="${intent}">`;
  }

  private signInForm(values: FormValues): string {
    return `<form method="post" action="/authorize">
      <h2>Sign in</h2>${this.hiddenFields('signin')}
      <label for="si-email">Email</label>
      <input id="si-email" name="email" type="email" autocomplete="username" required value="${
        values.intent === 'signin' ? AuthorizePage.escape(values.email) : ''
      }">
      <label for="si-password">Password</label>
      <input id="si-password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>`;
  }

  private signUpForm(values: FormValues): string {
    const registrationKey = values.needsRegistrationKey
      ? `<label for="su-key">Registration key</label>
         <input id="su-key" name="registrationKey" type="password" autocomplete="off" required>`
      : '';

    return `<form method="post" action="/authorize">
      <h2>Create an account</h2>${this.hiddenFields('signup')}
      <label for="su-email">Email</label>
      <input id="su-email" name="email" type="email" autocomplete="username" required value="${
        values.intent === 'signup' ? AuthorizePage.escape(values.email) : ''
      }">
      <label for="su-password">Password (10+ characters)</label>
      <input id="su-password" name="password" type="password" autocomplete="new-password" minlength="10" required>
      ${registrationKey}
      <details>
        <summary>Already have an organization token?</summary>
        <label for="su-org">Organization</label>
        <input id="su-org" name="linkOrganization" autocomplete="off">
        <label for="su-token">Organization token</label>
        <input id="su-token" name="linkToken" type="password" autocomplete="off">
      </details>
      <button type="submit">Create account</button>
    </form>`;
  }

  render(values: FormValues): Response {
    const error = values.error ? `<p class="error" role="alert">${AuthorizePage.escape(values.error)}</p>` : '';
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Address</title><style>${AuthorizePage.STYLE}</style></head>
<body><main>
  <h1>Agent Address</h1>
  <p class="lead">Sign in to let this MCP client name your agent sessions.</p>
  ${error}${this.signInForm(values)}${this.signUpForm(values)}
</main></body></html>`;

    return new Response(html, { status: values.error ? 400 : 200, headers: AuthorizePage.HEADERS });
  }
}

// Serves the OAuth authorization page where an account signs in or signs up, then completes the grant.
export class AuthorizeController {
  static readonly PATH = '/authorize';

  private readonly services: Services;

  constructor(private readonly env: Env) {
    this.services = new Services(env);
  }

  private static field(form: FormData, name: string): string {
    const value = form.get(name);

    return typeof value === 'string' ? value : '';
  }

  private static parseOAuthRequest(serialized: string): AuthRequest {
    try {
      return JSON.parse(serialized) as AuthRequest;
    } catch (error) {
      console.debug('Malformed OAuth authorization form:', error);
      throw new APIError(400, 'invalid_request', 'The authorization request is malformed.');
    }
  }

  private static parseIntent(value: string): 'signin' | 'signup' {
    if (value !== 'signin' && value !== 'signup') {
      throw new APIError(400, 'invalid_request', 'Unknown authorization form intent.');
    }

    return value;
  }

  private formValues(intent: 'signin' | 'signup', email: string, error: string | null): FormValues {
    return { intent, email, error, needsRegistrationKey: Boolean(this.env.REGISTRATION_KEY) };
  }

  private async authenticate(form: FormData, intent: string): Promise<AccountRow> {
    const email = AuthorizeController.field(form, 'email');
    const password = AuthorizeController.field(form, 'password');

    if (intent === 'signin') {
      return this.services.accounts.logIn(email, password);
    }

    const registrationKey = AuthorizeController.field(form, 'registrationKey') || null;
    const linkSlug = AuthorizeController.field(form, 'linkOrganization').trim();
    const linkedOrganization = linkSlug
      ? await this.services.accounts.verifyOrganizationToken(linkSlug, AuthorizeController.field(form, 'linkToken').trim())
      : null;

    return this.services.accounts.signUp(email, password, registrationKey, linkedOrganization);
  }

  private async parseAuthRequest(request: Request): Promise<AuthRequest> {
    try {
      return await this.env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch (error) {
      console.debug('Invalid OAuth authorization request:', error);
      throw new APIError(400, 'invalid_request', error instanceof Error ? error.message : 'Invalid authorization request.');
    }
  }

  async showForm(request: Request): Promise<Response> {
    return new AuthorizePage(await this.parseAuthRequest(request)).render(this.formValues('signin', '', null));
  }

  async submitForm(request: Request): Promise<Response> {
    const form = await request.formData();
    const oauthRequest = AuthorizeController.parseOAuthRequest(AuthorizeController.field(form, 'oauthRequest'));
    const intent = AuthorizeController.parseIntent(AuthorizeController.field(form, 'intent'));
    const email = AuthorizeController.field(form, 'email');

    let account: AccountRow;
    try {
      account = await this.authenticate(form, intent);
    } catch (error) {
      if (!(error instanceof APIError)) {
        throw error;
      }

      console.debug('OAuth account authentication rejected:', error.code);
      return new AuthorizePage(oauthRequest).render(this.formValues(intent, email, error.message));
    }

    const props: AccountProps = { accountId: account.id, authVersion: account.authVersion };
    const { redirectTo } = await this.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthRequest,
      userId: account.id,
      metadata: { email: account.email },
      scope: oauthRequest.scope,
      props,
    });

    return Response.redirect(redirectTo, 302);
  }

  async handle(request: Request): Promise<Response> {
    return request.method === 'POST' ? this.submitForm(request) : this.showForm(request);
  }
}
