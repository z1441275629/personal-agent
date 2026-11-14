import Router from '@koa/router';
import type { Context } from 'koa';
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
} from '@pa/shared';
import { taskService } from '../../services/task.service';

export const tasksRouter = new Router({ prefix: '/tasks' });

tasksRouter.get('/', (ctx: Context) => {
  ctx.body = { tasks: taskService.list() };
});

tasksRouter.post('/', (ctx: Context) => {
  const parsed = CreateTaskRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  ctx.status = 201;
  ctx.body = taskService.create(parsed.data);
});

tasksRouter.put('/:id', (ctx: Context) => {
  const parsed = UpdateTaskRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  ctx.body = taskService.update(ctx.params.id, parsed.data);
});

tasksRouter.del('/:id', (ctx: Context) => {
  taskService.remove(ctx.params.id);
  ctx.status = 204;
});

/** 立即执行一次：返回生成的通知（培训课程全文在 content 里） */
tasksRouter.post('/:id/run', async (ctx: Context) => {
  ctx.body = { notification: await taskService.run(ctx.params.id) };
});
