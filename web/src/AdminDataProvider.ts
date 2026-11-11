import type { DataProvider, CrudFilters } from '@refinedev/core';

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
      getList: async ({ resource, pagination, filters }) => {
        if (resource !== 'accounts') {
          throw new Error('Unsupported admin resource.');
        }
        const current = pagination?.current ?? 1;
        const pageSize = pagination?.pageSize ?? 20;
        const query = new URLSearchParams({
          offset: String((current - 1) * pageSize),
          limit: String(pageSize),
          search: AdminDataProvider.searchValue(filters),
        });
        const result = await this.request<Page<Record<string, unknown>>>(`/accounts?${query}`);
        return { data: result.items, total: result.total };
      },
      getOne: async ({ resource, id }) => {
        if (resource !== 'accounts') {
          throw new Error('Unsupported admin resource.');
        }
        return { data: await this.request<Record<string, unknown>>(`/accounts/${encodeURIComponent(id)}`) };
      },
      update: async ({ resource, id, variables }) => {
        if (resource !== 'accounts' || typeof variables.password !== 'string') {
          throw new Error('Only account password reset is supported.');
        }
        return { data: await this.request<Record<string, unknown>>(`/accounts/${encodeURIComponent(id)}/password`, {
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
