import type { AuthRequest } from '@cloudflare/workers-oauth-provider';

import { AccountRow } from './Accounts';
import { AuthorizePage, FormValues } from './AuthorizePage';
import { Env } from './Env';
import { APIError } from './HTTP';
import { Services } from './Services';

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
