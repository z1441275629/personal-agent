import Router from '@koa/router';
import { healthRouter } from './health';
import { settingsRouter } from './settings';
import { chatRouter } from './chat';
import { tasksRouter } from './tasks';
import { notificationsRouter } from './notifications';
import { memoriesRouter } from './memories';

/**
 * 路由汇总挂载。所有业务路由统一加 /api 前缀（web 端 vite proxy 已配置）。
 *
 * TODO(路线图)，逐步挂载：
 *   import { knowledgeRouter } from './knowledge';
 *   import { agentRouter } from './agent';
 */
export const rootRouter = new Router({ prefix: '/api' });

rootRouter.use(healthRouter.routes(), healthRouter.allowedMethods());
rootRouter.use(settingsRouter.routes(), settingsRouter.allowedMethods());
rootRouter.use(chatRouter.routes(), chatRouter.allowedMethods());
rootRouter.use(tasksRouter.routes(), tasksRouter.allowedMethods());
rootRouter.use(notificationsRouter.routes(), notificationsRouter.allowedMethods());
rootRouter.use(memoriesRouter.routes(), memoriesRouter.allowedMethods());
