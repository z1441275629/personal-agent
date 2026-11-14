import Router from '@koa/router';
import type { Context } from 'koa';
import { pingProvider, listPresets } from '@pa/llm';
import { settingsService } from '../../services/settings.service';
import { mcpService } from '../../services/mcp.service';

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
  const setting = settingsService.getFull(ctx.params.id);
  ctx.body = await pingProvider(setting);
});

// ---- MCP 服务器（stdio 外部工具）----
// 变更后立即重连该服务器（等待握手完成），响应携带实时连接状态；
// 连接失败不影响保存——状态里带 lastError 供前端展示。

settingsRouter.get('/mcp', (ctx: Context) => {
  ctx.body = { servers: mcpService.publicList() };
});

settingsRouter.post('/mcp', async (ctx: Context) => {
  const created = settingsService.createMcp(ctx.request.body);
  await mcpService.syncServer(created.id);
  ctx.status = 201;
  ctx.body = mcpService.publicList().find((s) => s.id === created.id) ?? created;
});

settingsRouter.put('/mcp/:id', async (ctx: Context) => {
  settingsService.updateMcp(ctx.params.id, ctx.request.body);
  await mcpService.syncServer(ctx.params.id);
  ctx.body = mcpService.publicList().find((s) => s.id === ctx.params.id);
});

settingsRouter.del('/mcp/:id', async (ctx: Context) => {
  settingsService.removeMcp(ctx.params.id);
  await mcpService.syncServer(ctx.params.id);
  ctx.status = 204;
});
