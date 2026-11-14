import Koa from 'koa';
import cors from '@koa/cors';
import bodyParser from '@koa/bodyparser';
import { errorHandler } from './api/middleware/error';
import { rootRouter } from './api/routes';

/**
 * Koa 实例组装：中间件顺序 = 错误处理 → CORS → body 解析 → 路由。
 * 注意：不要在这里写业务逻辑，用例编排属于 services/。
 */
export function createApp(): Koa {
  const app = new Koa();

  app.use(errorHandler);
  app.use(cors());
  app.use(bodyParser());

  app.use(rootRouter.routes());
  app.use(rootRouter.allowedMethods());

  return app;
}
