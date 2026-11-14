import Router from '@koa/router';

export const healthRouter = new Router();

/** 健康检查：desktop 的 server-manager 靠它探测 server 是否就绪。 */
healthRouter.get('/health', (ctx) => {
  ctx.body = {
    status: 'ok',
    uptime: process.uptime(),
    ts: Date.now(),
  };
});
