import { z } from 'zod';
import {
  KnowledgeDocumentDetailSchema,
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

export const CreateKnowledgeDocumentResponseSchema = z.object({
  document: KnowledgeDocumentSchema,
  /** 摄取向量化失败时的提示（文档已按关键词模式入库） */
  warning: z.string().nullable(),
});
export type CreateKnowledgeDocumentResponse = z.infer<typeof CreateKnowledgeDocumentResponseSchema>;

/** GET /api/knowledge/documents/:id —— 详情（含完整原文） */
export const GetKnowledgeDocumentResponseSchema = z.object({
  document: KnowledgeDocumentDetailSchema,
});
export type GetKnowledgeDocumentResponse = z.infer<typeof GetKnowledgeDocumentResponseSchema>;

/** PUT /api/knowledge/documents/:id —— 改名 / 替换内容（内容变更 = 重切分 + 重向量化） */
export const UpdateKnowledgeDocumentRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(2_000_000).optional(),
  })
  .refine((v) => v.name !== undefined || v.content !== undefined, {
    message: 'name 与 content 至少提供一项',
  });
export type UpdateKnowledgeDocumentRequest = z.infer<typeof UpdateKnowledgeDocumentRequestSchema>;

export const UpdateKnowledgeDocumentResponseSchema = z.object({
  document: KnowledgeDocumentDetailSchema,
  /** 重向量化失败时的提示（文档已按关键词模式更新） */
  warning: z.string().nullable(),
});
export type UpdateKnowledgeDocumentResponse = z.infer<typeof UpdateKnowledgeDocumentResponseSchema>;

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

/** GET /api/knowledge/settings —— 附统计、掩码与向量库状态，设置页一屏展示 */
export const KnowledgeSettingsResponseSchema = KnowledgeSettingsSchema.extend({
  embedding: KnowledgeSettingsSchema.shape.embedding.extend({
    apiKeyMasked: z.string(),
    /** 存储形态：encrypted=safeStorage 密文（桌面模式）/ plaintext=明文（开发模式） */
    storage: z.enum(['encrypted', 'plaintext']),
  }),
  documentCount: z.number().int(),
  totalChunks: z.number().int(),
  embeddedChunks: z.number().int(),
  /** 向量库状态：未连接时向量检索/向量化不可用，关键词检索不受影响 */
  chroma: z.object({
    kind: z.string(),
    url: z.string(),
    healthy: z.boolean(),
  }),
});
export type KnowledgeSettingsResponse = z.infer<typeof KnowledgeSettingsResponseSchema>;

/** PUT /api/knowledge/settings —— apiKey 留空/缺省 = 保持原值 */
export const UpsertKnowledgeSettingsRequestSchema = KnowledgeSettingsSchema.extend({
  embedding: KnowledgeSettingsSchema.shape.embedding.extend({
    apiKey: z.string().optional(),
  }),
});
export type UpsertKnowledgeSettingsRequest = z.infer<typeof UpsertKnowledgeSettingsRequestSchema>;

/** POST /api/knowledge/reindex —— 按当前 embedding 配置重建全部向量 */
export const ReindexResponseSchema = z.object({
  ok: z.boolean(),
  embeddedChunks: z.number().int(),
  totalChunks: z.number().int(),
  error: z.string().nullable(),
});
export type ReindexResponse = z.infer<typeof ReindexResponseSchema>;
