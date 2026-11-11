import { AccountService } from './Accounts';
import { APIError, JSONRecord, RequestData } from './HTTP';
import { RegistryService } from './RegistryService';

export class WorkDirectory {
  private static readonly defaultLimit = 50;
  private static readonly maximumLimit = 100;
  private static readonly maximumSearchLength = 64;

  constructor(
    private readonly accounts: AccountService,
    private readonly registry: RegistryService,
  ) {}

  private static pageLimit(value: string | null): number {
    if (value === null) {
      return this.defaultLimit;
    }

    if (!/^[1-9][0-9]{0,2}$/.test(value)) {
      throw new APIError(400, 'invalid_page_limit', 'limit must be an integer between 1 and 100.');
    }

    const limit = Number(value);
    if (limit > this.maximumLimit) {
      throw new APIError(400, 'invalid_page_limit', 'limit must be an integer between 1 and 100.');
    }

    return limit;
  }

  private static cursor(value: string | null): string {
    if (value === null) {
      return '';
    }

    if (value.length > 255) {
      throw new APIError(400, 'invalid_cursor', 'Work directory cursor is invalid.');
    }

    const path = RequestData.normalizePath(value);
    if (path !== value || path.split('/').length !== 2) {
      throw new APIError(400, 'invalid_cursor', 'Work directory cursor must be an exact Work path.');
    }

    return path;
  }

  private static searchTerm(value: string | null): string {
    if (value === null) {
      return '';
    }

    const search = value.trim();
    if (!search || search.length > this.maximumSearchLength) {
      throw new APIError(400, 'invalid_search', 'search must contain 1–64 characters.');
    }

    return search;
  }

  async list(
    accountID: string,
    options: { limit: string | null; cursor: string | null; search: string | null },
  ): Promise<JSONRecord> {
    const limit = WorkDirectory.pageLimit(options.limit);
    const cursor = WorkDirectory.cursor(options.cursor);
    const search = WorkDirectory.searchTerm(options.search);

    const account = await this.accounts.getAccount(accountID);
    const organization = await this.accounts.requireOrganization(account);
    const results = await this.registry.listActiveWorks(
      organization.id, cursor, search, limit + 1,
    );

    const hasMore = results.length > limit;
    const page = results.slice(0, limit);

    return {
      items: page.map((address) => RegistryService.publicAddress(organization.slug, address)),
      nextCursor: hasMore ? page[page.length - 1].path : null,
    };
  }
}
