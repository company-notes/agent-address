import type {
  BaseRecord,
  CrudFilters,
  DataProvider,
  GetListParams,
  GetOneParams,
  UpdateParams,
} from '@refinedev/core';

type APIResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

type Page<T> = {
  items: T[];
  total: number;
};

export class AdminDataProvider {
  static readonly BASE_URL = '/admin/api';

  private static searchValue(filters?: CrudFilters): string {
    const filter = filters?.find((item) => 'field' in item && item.field === 'search');
    if (!filter || !('value' in filter) || typeof filter.value !== 'string') {
      return '';
    }

    return filter.value;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${AdminDataProvider.BASE_URL}${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
    const payload = (await response.json()) as APIResult<T>;

    if (!payload.ok) {
      throw new Error(payload.error.message);
    }

    if (!response.ok) {
      throw new Error(`Request failed (HTTP ${response.status})`);
    }

    return payload.data;
  }

  async updateOrganization(accountID: string, fields: { slug: string; displayName: string }) {
    return this.request<{ id: string; slug: string; displayName: string }>(
      `/accounts/${encodeURIComponent(accountID)}/organization`, {
        method: 'PATCH', body: JSON.stringify(fields),
      });
  }

  async resetPassword<T = BaseRecord>(accountId: string, password: string): Promise<T> {
    return this.request<T>(`/accounts/${encodeURIComponent(accountId)}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  }

  toRefineProvider(): DataProvider {
    return {
      getApiUrl: () => AdminDataProvider.BASE_URL,

      getList: async <TData extends BaseRecord = BaseRecord>({ resource, pagination, filters }: GetListParams) => {
        if (resource !== 'accounts') {
          throw new Error('Unsupported admin resource.');
        }

        const current = pagination?.currentPage ?? 1;
        const pageSize = pagination?.pageSize ?? 20;
        const query = new URLSearchParams({
          offset: String((current - 1) * pageSize),
          limit: String(pageSize),
          search: AdminDataProvider.searchValue(filters),
        });

        const page = await this.request<Page<TData>>(`/accounts?${query}`);

        return { data: page.items, total: page.total };
      },

      getOne: async <TData extends BaseRecord = BaseRecord>({ resource, id }: GetOneParams) => {
        if (resource !== 'accounts') {
          throw new Error('Unsupported admin resource.');
        }

        const data = await this.request<TData>(`/accounts/${encodeURIComponent(id)}`);

        return { data };
      },

      update: async <TData extends BaseRecord = BaseRecord, TVariables = {}>({
        resource,
        id,
        variables,
      }: UpdateParams<TVariables>) => {
        if (resource !== 'accounts' || !variables || typeof variables !== 'object' ||
            !('password' in variables) || typeof variables.password !== 'string') {
          throw new Error('Only account password reset is supported.');
        }

        const data = await this.resetPassword<TData>(String(id), variables.password);

        return { data };
      },

      create: async () => {
        throw new Error('Admin account creation is not available.');
      },

      deleteOne: async () => {
        throw new Error('Admin account deletion is not available.');
      },
    };
  }
}

export const adminAPI = new AdminDataProvider();
export const adminDataProvider = adminAPI.toRefineProvider();
