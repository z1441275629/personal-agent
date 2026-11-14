import Router from '@koa/router';
import type { Context } from 'koa';
import { MarkNotificationsReadRequestSchema } from '@pa/shared';
import { notificationService } from '../../services/notification.service';

export const notificationsRouter = new Router({ prefix: '/notifications' });

/** 前端轮询入口：最近通知 + 未读数 */
notificationsRouter.get('/', (ctx: Context) => {
  ctx.body = notificationService.list();
});

notificationsRouter.post('/read', (ctx: Context) => {
  const parsed = MarkNotificationsReadRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  notificationService.markRead(parsed.data);
  ctx.status = 204;
});
