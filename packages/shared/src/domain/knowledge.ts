import { z } from 'zod';

/** 知识库文档（元信息；切片与向量不出库） */
export const KnowledgeDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  chars: z.number().int(),
  chunkCount: z.number().int(),
  /** 建立向量索引时使用的 embedding 模型；null = 仅关键词检索 */
  embeddingModel: z.string().nullable(),
  createdAt: z.number(),
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

/**
 * 知识库设置（settings.json 的 knowledge 段）。
 * embedding 单独配置：可指定任意 provider（含停用的）+ 模型名，
 * 与对话模型解耦；模型留空 = 关闭向量检索，走关键词兜底。
 */
export const KnowledgeSettingsSchema = z.object({
  /** 用于 embedding 的 provider id；null = 跟随第一个启用的 provider */
  embeddingProviderId: z.string().nullable().default(null),
  /** embedding 模型名（空 = 关键词检索） */
  embeddingModel: z.string().default(''),
  /** 检索返回条数 */
  topK: z.number().int().min(1).max(20).default(5),
});
export type KnowledgeSettings = z.infer<typeof KnowledgeSettingsSchema>;
