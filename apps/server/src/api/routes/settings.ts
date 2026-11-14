import Router from '@koa/router';
import type { Context } from 'koa';
import { pingProvider, listPresets } from '@pa/llm';
import { settingsService } from '../../services/settings.service';

export const settingsRouter = new Router({ prefix: '/settings' });

/** 预置模板（OpenAI/Anthropic/豆包/DeepSeek/Qwen/自定义） */
settingsRouter.get('/presets', (ctx: Context) => {
  ctx.body = { presets: listPresets() };
});

settingsRouter.get('/providers', (ctx: Context) => {
  ctx.body = { providers: settingsService.list() };
});

settingsRouter.post('/providers', (ctx: Context) => {
  ctx.status = 201;
  ctx.body = settingsService.create(ctx.request.body);
});

settingsRouter.put('/providers/:id', (ctx: Context) => {
  ctx.body = settingsService.update(ctx.params.id, ctx.request.body);
});

settingsRouter.del('/providers/:id', (ctx: Context) => {
  settingsService.remove(ctx.params.id);
  ctx.status = 204;
});

/** 真实调用一次模型验证配置（key 是否有效、模型名是否存在、网络是否通） */
settingsRouter.post('/providers/:id/test', async (ctx: Context) => {
  const setting = settingsService.get(ctx.params.id);
  ctx.body = await pingProvider(setting);
});
