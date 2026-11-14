import Router from '@koa/router';
import type { Context } from 'koa';
import { CreateMemoryRequestSchema } from '@pa/shared';
import { memoryService } from '../../services/memory.service';

export const memoriesRouter = new Router({ prefix: '/memories' });

memoriesRouter.get('/', (ctx: Context) => {
  ctx.body = { memories: memoryService.list() };
});

memoriesRouter.post('/', (ctx: Context) => {
  const parsed = CreateMemoryRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  ctx.status = 201;
  ctx.body = memoryService.create(parsed.data);
});

memoriesRouter.del('/:id', (ctx: Context) => {
  memoryService.remove(ctx.params.id);
  ctx.status = 204;
});
