import type { BaseRecord, DataProvider, CrudFilters, GetListParams, GetOneParams, UpdateParams } from '@refinedev/core';

type APIResult<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };
type Page<T> = { items: T[]; total: number };

export class AdminDataProvider {
  static readonly BASE_URL = '/v1/admin';

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${AdminDataProvider.BASE_URL}${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
    const payload = (await response.json()) as APIResult<T>;
    if (!response.ok || !payload.ok || payload.data === undefined) {
      throw new Error(payload.error?.message ?? `Request failed (HTTP ${response.status})`);
    }
    return payload.data;
  }

  private static searchValue(filters?: CrudFilters): string {
    const filter = filters?.find((item) => 'field' in item && item.field === 'search');
    return filter && 'value' in filter && typeof filter.value === 'string' ? filter.value : '';
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
        const result = await this.request<Page<TData>>(`/accounts?${query}`);
        return { data: result.items, total: result.total };
      },
      getOne: async <TData extends BaseRecord = BaseRecord>({ resource, id }: GetOneParams) => {
        if (resource !== 'accounts') {
          throw new Error('Unsupported admin resource.');
        }
        return { data: await this.request<TData>(`/accounts/${encodeURIComponent(id)}`) };
      },
      update: async <TData extends BaseRecord = BaseRecord, TVariables = {}>({ resource, id, variables }: UpdateParams<TVariables>) => {
        if (resource !== 'accounts' || !variables || typeof variables !== 'object' ||
            !('password' in variables) || typeof variables.password !== 'string') {
          throw new Error('Only account password reset is supported.');
        }
        return { data: await this.request<TData>(`/accounts/${encodeURIComponent(id)}/password`, {
          method: 'PUT',
          body: JSON.stringify({ password: variables.password }),
        }) };
      },
      create: async () => { throw new Error('Admin account creation is not available.'); },
      deleteOne: async () => { throw new Error('Admin account deletion is not available.'); },
    };
  }
}

export const adminDataProvider = new AdminDataProvider().toRefineProvider();
