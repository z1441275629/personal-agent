import Router from '@koa/router';
import type { Context } from 'koa';
import {
  ApprovalDecisionRequestSchema,
  CreateConversationRequestSchema,
  SendMessageRequestSchema,
  type ChatStreamEvent,
} from '@pa/shared';
import { chatService } from '../../services/chat.service';
import { approvalService, type ApprovalRequest } from '../../services/approval.service';

export const chatRouter = new Router({ prefix: '/chat' });

chatRouter.get('/conversations', (ctx: Context) => {
  ctx.body = { conversations: chatService.listConversations() };
});

chatRouter.post('/conversations', (ctx: Context) => {
  const parsed = CreateConversationRequestSchema.safeParse(ctx.request.body ?? {});
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  ctx.status = 201;
  ctx.body = chatService.createConversation(parsed.data.title);
});

chatRouter.del('/conversations/:id', (ctx: Context) => {
  chatService.removeConversation(ctx.params.id);
  ctx.status = 204;
});

chatRouter.get('/conversations/:id/messages', (ctx: Context) => {
  ctx.body = { messages: chatService.listMessages(ctx.params.id) };
});

/**
 * 发送消息 —— SSE 流式响应。
 * body.conversationId 缺省时惰性创建新会话（真正开始聊天才落库，不产生空会话）。
 * 校验失败（404/400）走 JSON 错误；通过后切换为 event-stream 手写响应。
 */
chatRouter.post('/messages', async (ctx: Context) => {
  const parsed = SendMessageRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  // 先解析 provider：没有可用 provider 时直接 400，不留下空会话
  const provider = chatService.resolveProvider(parsed.data.providerId);
  const conversation = parsed.data.conversationId
    ? chatService.getConversation(parsed.data.conversationId)
    : chatService.createConversation();

  ctx.respond = false;
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (evt: ChatStreamEvent): void => {
    ctx.res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };

  // HITL 事件桥：confirm 级工具挂起时，把审批请求旁路直写 SSE。
  // （工具在 ToolNode 内执行，streamReply 生成器此刻阻塞，无法产出该事件）
  const onApprovalRequested = (req: ApprovalRequest): void => {
    if (req.conversationId !== conversation.id) return;
    send({
      type: 'approval_request',
      approvalId: req.approvalId,
      conversationId: req.conversationId,
      name: req.toolName,
      input: JSON.stringify(req.input),
      timeoutMs: req.timeoutMs,
    });
  };
  approvalService.onRequested(onApprovalRequested);

  try {
    for await (const evt of chatService.streamReply(conversation, parsed.data.content, provider)) {
      send(evt);
    }
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    approvalService.offRequested(onApprovalRequested);
    ctx.res.end();
  }
});

/**
 * HITL 决定端点：批准（可带修改后的参数）/拒绝挂起中的工具执行。
 * 404 = 审批不存在或已处理（含超时自动拒绝）。
 */
chatRouter.post('/approvals/:id', (ctx: Context) => {
  const parsed = ApprovalDecisionRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  const ok = approvalService.decide(
    ctx.params.id,
    parsed.data.approved,
    parsed.data.input,
  );
  if (!ok) {
    const err = new Error('该确认请求不存在或已处理（超时会自动拒绝）') as Error & {
      status: number;
    };
    err.status = 404;
    throw err;
  }
  ctx.status = 204;
});
