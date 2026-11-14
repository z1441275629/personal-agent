import type {
  CreateProviderRequest,
  ListPresetsResponse,
  ListProvidersResponse,
  ProviderSetting,
  TestConnectionResponse,
} from '@pa/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const fetchPresets = (): Promise<ListPresetsResponse> =>
  request<ListPresetsResponse>('/api/settings/presets');

export const fetchProviders = (): Promise<ListProvidersResponse> =>
  request<ListProvidersResponse>('/api/settings/providers');

export const createProvider = (body: CreateProviderRequest): Promise<ProviderSetting> =>
  request<ProviderSetting>('/api/settings/providers', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateProvider = (
  id: string,
  body: CreateProviderRequest,
): Promise<ProviderSetting> =>
  request<ProviderSetting>(`/api/settings/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteProvider = (id: string): Promise<void> =>
  request<void>(`/api/settings/providers/${id}`, { method: 'DELETE' });

export const testProvider = (id: string): Promise<TestConnectionResponse> =>
  request<TestConnectionResponse>(`/api/settings/providers/${id}/test`, { method: 'POST' });
