import type { CreateMemoryRequest, ListMemoriesResponse, Memory } from '@pa/shared';
import { request } from './http';

export const fetchMemories = (): Promise<Memory[]> =>
  request<ListMemoriesResponse>('/api/memories/').then((r) => r.memories);

export const createMemory = (body: CreateMemoryRequest): Promise<Memory> =>
  request<Memory>('/api/memories/', { method: 'POST', body: JSON.stringify(body) });

export const deleteMemory = (id: string): Promise<void> =>
  request<void>(`/api/memories/${id}`, { method: 'DELETE' });
