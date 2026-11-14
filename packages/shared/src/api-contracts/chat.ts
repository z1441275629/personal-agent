import { z } from 'zod';
import { ConversationSchema, MessageSchema } from '../domain/message';

export const ListConversationsResponseSchema = z.object({
  conversations: z.array(ConversationSchema),
});
export type ListConversationsResponse = z.infer<typeof ListConversationsResponseSchema>;

export const CreateConversationRequestSchema = z.object({
  title: z.string().min(1).max(100).optional(),
});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const ListMessagesResponseSchema = z.object({
  messages: z.array(MessageSchema),
});
export type ListMessagesResponse = z.infer<typeof ListMessagesResponseSchema>;

/** POST /api/chat/messages（SSE 流式响应） */
export const SendMessageRequestSchema = z.object({
  content: z.string().min(1).max(20_000),
  /** 不传则惰性创建新会话（首条消息才落库）；传了必须是未删除的会话 id */
  conversationId: z.string().optional(),
  /** 不传则用第一个启用的 provider */
  providerId: z.string().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

/** SSE 流事件（data: 行的 JSON 载荷） */
export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta'), conversationId: z.string(), userMessageId: z.string() }),
  z.object({ type: z.literal('chunk'), text: z.string() }),
  z.object({ type: z.literal('done'), assistantMessageId: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
