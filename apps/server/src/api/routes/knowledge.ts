import Router from '@koa/router';
import type { Context } from 'koa';
import {
  CreateKnowledgeDocumentRequestSchema,
  KnowledgeSearchRequestSchema,
  UpsertKnowledgeSettingsRequestSchema,
} from '@pa/shared';
import { knowledgeService } from '../../services/knowledge.service';
import { settingsService } from '../../services/settings.service';

export const knowledgeRouter = new Router({ prefix: '/knowledge' });

knowledgeRouter.get('/documents', (ctx: Context) => {
  ctx.body = { documents: knowledgeService.listDocuments() };
});

/** 纯文本摄取（前端读文件后发文本，服务端免 multipart） */
knowledgeRouter.post('/documents', async (ctx: Context) => {
  const parsed = CreateKnowledgeDocumentRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  ctx.status = 201;
  ctx.body = await knowledgeService.ingest(parsed.data.name, parsed.data.content);
});

knowledgeRouter.del('/documents/:id', (ctx: Context) => {
  knowledgeService.removeDocument(ctx.params.id);
  ctx.status = 204;
});

knowledgeRouter.post('/search', async (ctx: Context) => {
  const parsed = KnowledgeSearchRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  ctx.body = await knowledgeService.search(parsed.data.query, parsed.data.topK);
});

knowledgeRouter.get('/settings', async (ctx: Context) => {
  ctx.body = await knowledgeService.getSettingsView();
});

knowledgeRouter.put('/settings', (ctx: Context) => {
  const parsed = UpsertKnowledgeSettingsRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  ctx.body = settingsService.saveKnowledge(parsed.data);
});

/** 按当前 embedding 配置重建全部向量索引 */
knowledgeRouter.post('/reindex', async (ctx: Context) => {
  ctx.body = await knowledgeService.reindex();
});
