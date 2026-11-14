import Router from '@koa/router';
import type { Context } from 'koa';
import {
  CreateConversationRequestSchema,
  SendMessageRequestSchema,
  type ChatStreamEvent,
} from '@pa/shared';
import { chatService } from '../../services/chat.service';

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
 * 校验失败（404/400）走 JSON 错误；通过后切换为 event-stream 手写响应。
 */
chatRouter.post('/conversations/:id/messages', async (ctx: Context) => {
  const parsed = SendMessageRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  const conversation = chatService.getConversation(ctx.params.id);
  const provider = chatService.resolveProvider(parsed.data.providerId);

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

  try {
    for await (const evt of chatService.streamReply(conversation, parsed.data.content, provider)) {
      send(evt);
    }
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    ctx.res.end();
  }
});
