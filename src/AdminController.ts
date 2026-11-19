import { AdminAuthenticator } from './AdminAuth';
import { AdminService } from './AdminService';
import { Env } from './Env';
import { ApplicationError } from './ApplicationError';
import { RequestData, ResponseData } from './HTTP';
import { Services } from './Services';

export class AdminController {
  private readonly admin: AdminService;

  constructor(private readonly env: Env) {
    const services = new Services(env);
    this.admin = new AdminService(env.DB, services.accounts, services.organizations);
  }

  private static boundedInteger(raw: string | null, fallback: number, minimum: number, maximum: number): number {
    if (raw === null) {
      return fallback;
    }

    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new ApplicationError(400, 'invalid_pagination', 'Invalid pagination value.');
    }

    return value;
  }

  async handle(request: Request): Promise<Response> {
    const actorEmail = await new AdminAuthenticator().authenticate(request, this.env);
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const resource = segments[2];
    const accountID = segments[3];
    const method = request.method;

    if (segments[0] !== 'admin' || segments[1] !== 'api') {
      throw new ApplicationError(404, 'not_found', 'Administrator resource not found.');
    }

    if (resource === 'accounts' && segments.length === 3 && method === 'GET') {
      const offset = AdminController.boundedInteger(url.searchParams.get('offset'), 0, 0, 1000000);
      const limit = AdminController.boundedInteger(url.searchParams.get('limit'), 20, 1, 100);
      const search = url.searchParams.get('search') ?? '';

      if (search.length > 80) {
        throw new ApplicationError(400, 'invalid_search', 'Search is too long.');
      }

      return ResponseData.ok(await this.admin.listAccounts(search, offset, limit));
    }

    if (resource === 'accounts' && accountID && segments.length === 4 && method === 'GET') {
      return ResponseData.ok(await this.admin.getAccount(accountID));
    }

    if (resource === 'accounts' && accountID && segments[4] === 'organization' &&
        segments.length === 5 && method === 'PATCH') {
      AdminAuthenticator.assertSafeMutation(request);

      const changes = RequestData.organizationChanges(await RequestData.readJSON(request));
      return ResponseData.ok(await this.admin.updateOrganization(accountID, changes, actorEmail));
    }

    if (resource === 'accounts' && accountID && segments[4] === 'password' &&
        segments.length === 5 && method === 'PUT') {
      AdminAuthenticator.assertSafeMutation(request);

      const data = await RequestData.readJSON(request);
      if (typeof data.password !== 'string' || data.password.length > 256) {
        throw new ApplicationError(400, 'invalid_password', 'A new password is required (maximum 256 characters).');
      }

      return ResponseData.ok(await this.admin.resetPassword(accountID, data.password, actorEmail));
    }

    throw new ApplicationError(404, 'not_found', 'Administrator resource not found.');
  }
}
