import Router from '@koa/router';
import type { Context } from 'koa';
import {
  CreateKnowledgeDocumentRequestSchema,
  KnowledgeSearchRequestSchema,
  UpdateKnowledgeDocumentRequestSchema,
  UpsertKnowledgeSettingsRequestSchema,
} from '@pa/shared';
import { knowledgeService } from '../../services/knowledge.service';
import { settingsService } from '../../services/settings.service';

export const knowledgeRouter = new Router({ prefix: '/knowledge' });

/** 参数校验失败的统一 400 */
function parseBody<T>(schema: { safeParse: (raw: unknown) => { success: true; data: T } | { success: false; error: { message: string } } }, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  return parsed.data;
}

knowledgeRouter.get('/documents', (ctx: Context) => {
  ctx.body = { documents: knowledgeService.listDocuments() };
});

/** 文档详情（含完整原文，编辑对话框用） */
knowledgeRouter.get('/documents/:id', (ctx: Context) => {
  ctx.body = { document: knowledgeService.getDocument(ctx.params.id) };
});

/** 纯文本摄取（前端读文件后发文本，服务端免 multipart） */
knowledgeRouter.post('/documents', async (ctx: Context) => {
  const body = parseBody(CreateKnowledgeDocumentRequestSchema, ctx.request.body);
  ctx.status = 201;
  ctx.body = await knowledgeService.ingest(body.name, body.content);
});

/** 更新：改名 / 替换内容（内容变更 = 重切分 + 重向量化） */
knowledgeRouter.put('/documents/:id', async (ctx: Context) => {
  const body = parseBody(UpdateKnowledgeDocumentRequestSchema, ctx.request.body);
  ctx.body = await knowledgeService.updateDocument(ctx.params.id, body);
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

knowledgeRouter.put('/settings', async (ctx: Context) => {
  const parsed = UpsertKnowledgeSettingsRequestSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    const err = new Error(`参数校验失败: ${parsed.error.message}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  await settingsService.saveKnowledge(parsed.data);
  ctx.body = await knowledgeService.getSettingsView();
});

/** 按当前 embedding 配置重建全部向量索引 */
knowledgeRouter.post('/reindex', async (ctx: Context) => {
  ctx.body = await knowledgeService.reindex();
});
