import Koa from 'koa';
import cors from '@koa/cors';
import bodyParser from '@koa/bodyparser';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler } from './api/middleware/error';
import { rootRouter } from './api/routes';
import { spaStatic } from './infra/static';
import { env } from './config';

/**
 * 兼容 ESM（tsx 开发）与 CJS（esbuild 打包）两种运行形态的当前目录。
 */
const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

/**
 * Koa 实例组装：错误处理 → CORS → body 解析 → API 路由 → web 静态资源（生产模式）。
 * 注意：不要在这里写业务逻辑，用例编排属于 services/。
 */
export function createApp(): Koa {
  const app = new Koa();

  app.use(errorHandler);
  app.use(cors());
  app.use(bodyParser());

  app.use(rootRouter.routes());
  app.use(rootRouter.allowedMethods());

  // web 静态资源：优先 env 注入；否则尝试 monorepo 相对路径
  // （apps/server/src 与 apps/server/dist 距离 apps/web/dist 都是两级）
  const webDistDir = env.WEB_DIST_DIR ?? path.resolve(currentDir, '../../web/dist');
  if (existsSync(webDistDir)) {
    app.use(spaStatic(webDistDir));
  }

  return app;
}
