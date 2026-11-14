import { z } from 'zod';
import {
  KnowledgeDocumentSchema,
  KnowledgeSettingsSchema,
} from '../domain/knowledge';

/** GET /api/knowledge/documents */
export const ListKnowledgeDocumentsResponseSchema = z.object({
  documents: z.array(KnowledgeDocumentSchema),
});
export type ListKnowledgeDocumentsResponse = z.infer<typeof ListKnowledgeDocumentsResponseSchema>;

/** POST /api/knowledge/documents —— 纯文本摄取（前端读文件后发文本） */
export const CreateKnowledgeDocumentRequestSchema = z.object({
  name: z.string().min(1).max(200),
  content: z.string().min(1).max(2_000_000),
});
export type CreateKnowledgeDocumentRequest = z.infer<typeof CreateKnowledgeDocumentRequestSchema>;

/** POST /api/knowledge/search */
export const KnowledgeSearchRequestSchema = z.object({
  query: z.string().min(1).max(2_000),
  topK: z.number().int().min(1).max(20).optional(),
});
export type KnowledgeSearchRequest = z.infer<typeof KnowledgeSearchRequestSchema>;

export const KnowledgeSearchResultSchema = z.object({
  docId: z.string(),
  docName: z.string(),
  chunkIndex: z.number().int(),
  text: z.string(),
  /** 相关度（余弦或关键词，域不同，仅排序展示用） */
  score: z.number(),
});
export const KnowledgeSearchResponseSchema = z.object({
  /** 实际使用的检索模式（向量模型未配置/调用失败时降级 keyword） */
  mode: z.enum(['vector', 'keyword']),
  results: z.array(KnowledgeSearchResultSchema),
});
export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponseSchema>;

/** GET /api/knowledge/settings —— 附统计，设置页一屏展示 */
export const KnowledgeSettingsResponseSchema = KnowledgeSettingsSchema.extend({
  documentCount: z.number().int(),
  totalChunks: z.number().int(),
  embeddedChunks: z.number().int(),
});
export type KnowledgeSettingsResponse = z.infer<typeof KnowledgeSettingsResponseSchema>;

/** PUT /api/knowledge/settings */
export const UpsertKnowledgeSettingsRequestSchema = KnowledgeSettingsSchema;
export type UpsertKnowledgeSettingsRequest = z.infer<typeof UpsertKnowledgeSettingsRequestSchema>;

/** POST /api/knowledge/reindex —— 按当前 embedding 配置重建全部向量 */
export const ReindexResponseSchema = z.object({
  ok: z.boolean(),
  embeddedChunks: z.number().int(),
  totalChunks: z.number().int(),
  error: z.string().nullable(),
});
export type ReindexResponse = z.infer<typeof ReindexResponseSchema>;
