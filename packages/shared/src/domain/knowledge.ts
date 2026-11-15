import { z } from 'zod';

/** 知识库文档（注册表元信息；原文与向量不出现在此类型） */
export const KnowledgeDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  chars: z.number().int(),
  chunkCount: z.number().int(),
  /** 建立向量索引时使用的 embedding 模型；null = 仅关键词检索 */
  embeddingModel: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

/** 文档详情（编辑对话框用）：元信息 + 完整原文 */
export const KnowledgeDocumentDetailSchema = KnowledgeDocumentSchema.extend({
  content: z.string(),
});
export type KnowledgeDocumentDetail = z.infer<typeof KnowledgeDocumentDetailSchema>;

/**
 * 知识库设置（settings.json 的 knowledge 段）。
 * embedding 是独立完整配置（baseURL + apiKey + 模型），不依赖对话 provider；
 * apiKey 存储层可为 safe:v1: 密文（同 provider/LangSmith），API 层只下发掩码。
 * 三项任一为空 = 关闭向量检索，走关键词兜底。
 */
export const KnowledgeEmbeddingSchema = z.object({
  baseURL: z.string().default(''),
  apiKey: z.string().default(''),
  model: z.string().default(''),
});
export type KnowledgeEmbedding = z.infer<typeof KnowledgeEmbeddingSchema>;

export const KnowledgeSettingsSchema = z.object({
  embedding: KnowledgeEmbeddingSchema,
  /** 检索返回条数 */
  topK: z.number().int().min(1).max(20).default(5),
});
export type KnowledgeSettings = z.infer<typeof KnowledgeSettingsSchema>;

/** 旧版 knowledge 段（provider 引用式）→ 新版独立配置的迁移：丢弃引用，保留 topK */
export function migrateKnowledgeSettings(raw: unknown): KnowledgeSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const parsed = KnowledgeSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const legacy = raw as { topK?: unknown };
  const topK = typeof legacy.topK === 'number' && legacy.topK >= 1 && legacy.topK <= 20 ? Math.floor(legacy.topK) : 5;
  return { embedding: { baseURL: '', apiKey: '', model: '' }, topK };
}
