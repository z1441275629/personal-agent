import type {
  UpsertProviderRequest,
  ListPresetsResponse,
  ListProvidersResponse,
  ProviderPublic,
  TestConnectionResponse,
  McpServerPublic,
  ListMcpServersResponse,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  LangsmithPublic,
  UpsertLangsmithRequest,
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

export const createProvider = (body: UpsertProviderRequest): Promise<ProviderPublic> =>
  request<ProviderPublic>('/api/settings/providers', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateProvider = (
  id: string,
  body: UpsertProviderRequest,
): Promise<ProviderPublic> =>
  request<ProviderPublic>(`/api/settings/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteProvider = (id: string): Promise<void> =>
  request<void>(`/api/settings/providers/${id}`, { method: 'DELETE' });

export const testProvider = (id: string): Promise<TestConnectionResponse> =>
  request<TestConnectionResponse>(`/api/settings/providers/${id}/test`, { method: 'POST' });

// ---- MCP 服务器 ----

export const fetchMcpServers = (): Promise<McpServerPublic[]> =>
  request<ListMcpServersResponse>('/api/settings/mcp').then((r) => r.servers);

export const createMcpServer = (body: CreateMcpServerRequest): Promise<McpServerPublic> =>
  request<McpServerPublic>('/api/settings/mcp', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateMcpServer = (
  id: string,
  body: UpdateMcpServerRequest,
): Promise<McpServerPublic> =>
  request<McpServerPublic>(`/api/settings/mcp/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteMcpServer = (id: string): Promise<void> =>
  request<void>(`/api/settings/mcp/${id}`, { method: 'DELETE' });

// ---- LangSmith 追踪 ----

export const fetchLangsmith = (): Promise<LangsmithPublic> =>
  request<LangsmithPublic>('/api/settings/langsmith');

export const saveLangsmith = (body: UpsertLangsmithRequest): Promise<LangsmithPublic> =>
  request<LangsmithPublic>('/api/settings/langsmith', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
