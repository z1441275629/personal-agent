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
  /** agent 工具调用开始（input 为参数 JSON 字符串，展示用） */
  z.object({
    type: z.literal('tool_start'),
    toolCallId: z.string(),
    name: z.string(),
    input: z.string(),
  }),
  /** agent 工具调用结束（output 截断到 200 字，展示用） */
  z.object({
    type: z.literal('tool_result'),
    toolCallId: z.string(),
    name: z.string(),
    ok: z.boolean(),
    output: z.string(),
  }),
  /**
   * HITL 确认请求：confirm 级工具执行前挂起，等待用户批准/拒绝。
   * input 为参数 JSON 字符串；批准时可通过 /approvals/:id 提交修改后的参数。
   * 注意：本事件由路由层（approvalService 事件桥）直接写入 SSE，
   * 不经过 chatService.streamReply 生成器——工具在循环内部执行时生成器正阻塞等待。
   */
  z.object({
    type: z.literal('approval_request'),
    approvalId: z.string(),
    conversationId: z.string(),
    name: z.string(),
    input: z.string(),
    /** 超时毫秒数，超时未决定自动拒绝 */
    timeoutMs: z.number().int().positive(),
  }),
  z.object({ type: z.literal('done'), assistantMessageId: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

/** POST /api/chat/approvals/:id —— 用户对确认卡片的决定 */
export const ApprovalDecisionRequestSchema = z.object({
  approved: z.boolean(),
  /** 批准时可携带修改后的参数（缺省 = 按原始参数执行）；拒绝时忽略 */
  input: z.record(z.string(), z.unknown()).optional(),
});
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequestSchema>;
