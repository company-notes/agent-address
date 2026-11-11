import { AdminAuthenticator } from './AdminAuth';
import { AdminService } from './AdminService';
import { Env } from './Env';
import { APIError, RequestData, ResponseData } from './HTTP';
import { Services } from './Services';

export class AdminController {
  private readonly admin: AdminService;

  constructor(private readonly env: Env) {
    const services = new Services(env);
    this.admin = new AdminService(env.DB, services.accounts, services.registry);
  }

  private static boundedInteger(raw: string | null, fallback: number, minimum: number, maximum: number): number {
    if (raw === null) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new APIError(400, 'invalid_pagination', 'Invalid pagination value.');
    }
    return value;
  }

  async handle(request: Request): Promise<Response> {
    const actorEmail = await new AdminAuthenticator().authenticate(request, this.env);
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const method = request.method;
    const resource = segments[2];
    const id = segments[3];

    if (resource === 'accounts' && segments.length === 3 && method === 'GET') {
      const offset = AdminController.boundedInteger(url.searchParams.get('offset'), 0, 0, 1000000);
      const limit = AdminController.boundedInteger(url.searchParams.get('limit'), 20, 1, 100);
      const search = url.searchParams.get('search') ?? '';
      if (search.length > 80) {
        throw new APIError(400, 'invalid_search', 'Search is too long.');
      }
      return ResponseData.ok(await this.admin.listAccounts(search, offset, limit));
    }

    if (resource === 'accounts' && segments.length === 4 && id && method === 'GET') {
      return ResponseData.ok(await this.admin.getAccount(id));
    }

    if (resource === 'accounts' && segments.length === 5 && id &&
        segments[4] === 'password' && method === 'PUT') {
      AdminAuthenticator.assertSafeMutation(request);
      const data = await RequestData.readJSON(request);
      if (typeof data.password !== 'string' || data.password.length > 256) {
        throw new APIError(400, 'invalid_password', 'A new password is required (maximum 256 characters).');
      }
      return ResponseData.ok(await this.admin.resetPassword(id, data.password, actorEmail));
    }

    throw new APIError(404, 'not_found', 'Administrator resource not found.');
  }
}
