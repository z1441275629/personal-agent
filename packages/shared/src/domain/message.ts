import { z } from 'zod';

/** 会话 */
export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageRoleSchema = z.enum(['system', 'user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** 单条消息（存储与传输统一形状） */
export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  createdAt: z.number().int(),
});
export type Message = z.infer<typeof MessageSchema>;
