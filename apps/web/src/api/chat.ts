import type {
  ApprovalDecisionRequest,
  ChatStreamEvent,
  Conversation,
  ListConversationsResponse,
  ListMessagesResponse,
  Message,
  SendMessageRequest,
} from '@pa/shared';
import { request } from './http';

export const fetchConversations = (): Promise<Conversation[]> =>
  request<ListConversationsResponse>('/api/chat/conversations').then((r) => r.conversations);

export const deleteConversation = (id: string): Promise<void> =>
  request<void>(`/api/chat/conversations/${id}`, { method: 'DELETE' });

export const fetchMessages = (conversationId: string): Promise<Message[]> =>
  request<ListMessagesResponse>(`/api/chat/conversations/${conversationId}/messages`).then(
    (r) => r.messages,
  );

/** HITL 确认卡片：批准（可带修改后的参数）/拒绝 */
export const decideApproval = (approvalId: string, body: ApprovalDecisionRequest): Promise<void> =>
  request<void>(`/api/chat/approvals/${approvalId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/**
 * 发送消息并解析 SSE 流：`data: {json}\n\n`
 * body.conversationId 缺省 = 服务端惰性创建新会话（首条消息才落库）。
 * 非 2xx 时服务端返回 JSON 错误，在建立流之前抛出。
 */
export async function* sendMessage(
  body: SendMessageRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch('/api/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = raw.split('\n').find((l) => l.startsWith('data: '));
      if (line) yield JSON.parse(line.slice(6)) as ChatStreamEvent;
    }
  }
}
