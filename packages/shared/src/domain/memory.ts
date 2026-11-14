import { z } from 'zod';

/** 长期记忆类型：事实 / 偏好 / 笔记 */
export const MemoryTypeSchema = z.enum(['fact', 'preference', 'note']);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  note: '笔记',
};

/** 长期记忆（跨会话保留，注入 system prompt 供 agent 使用） */
export const MemorySchema = z.object({
  id: z.string(),
  content: z.string(),
  type: MemoryTypeSchema,
  /** 产生该记忆的会话（agent 工具写入时记录；手动创建为空） */
  sourceConversationId: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Memory = z.infer<typeof MemorySchema>;
