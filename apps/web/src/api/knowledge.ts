import type {
  CreateKnowledgeDocumentRequest,
  KnowledgeDocument,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
  KnowledgeSettingsResponse,
  ListKnowledgeDocumentsResponse,
  ReindexResponse,
  UpsertKnowledgeSettingsRequest,
} from '@pa/shared';
import { request } from './http';

export const fetchDocuments = (): Promise<KnowledgeDocument[]> =>
  request<ListKnowledgeDocumentsResponse>('/api/knowledge/documents').then((r) => r.documents);

export const createDocument = (
  body: CreateKnowledgeDocumentRequest,
): Promise<{ document: KnowledgeDocument; warning: string | null }> =>
  request<{ document: KnowledgeDocument; warning: string | null }>('/api/knowledge/documents', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const deleteDocument = (id: string): Promise<void> =>
  request<void>(`/api/knowledge/documents/${id}`, { method: 'DELETE' });

export const searchKnowledge = (body: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> =>
  request<KnowledgeSearchResponse>('/api/knowledge/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const fetchKnowledgeSettings = (): Promise<KnowledgeSettingsResponse> =>
  request<KnowledgeSettingsResponse>('/api/knowledge/settings');

export const saveKnowledgeSettings = (
  body: UpsertKnowledgeSettingsRequest,
): Promise<KnowledgeSettingsResponse> =>
  request<KnowledgeSettingsResponse>('/api/knowledge/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const reindexKnowledge = (): Promise<ReindexResponse> =>
  request<ReindexResponse>('/api/knowledge/reindex', { method: 'POST' });
