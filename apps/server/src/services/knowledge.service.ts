import { embedTexts } from '@pa/llm';
import { chunkText, keywordScore } from '@pa/retrieval';
import { knowledgeRepo } from '@pa/persistence';
import type { VectorStore } from '@pa/infra';
import type {
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  KnowledgeSearchResponse,
  KnowledgeSettings,
  KnowledgeSettingsResponse,
} from '@pa/shared';
import { env } from '../config';
import { settingsService } from './settings.service';
import { secureStore } from './secure-store';

/**
 * 知识库（RAG）：文档全生命周期管理（增/删/改）+ 检索。
 *
 * 存储分工（主库与向量库分离）：
 *  - SQLite kb_documents：文档注册表 + 完整原文（source of truth，可随时重建索引）
 *  - 向量库（VectorStore 接口，当前为 Chroma）：已向量化切片（向量 + 切片文本 + 来源元数据），
 *    纯派生索引，随时可由原文重建；换 Milvus 等只需替换 adapter
 *  - 关键词检索：查询时对原文现切现算（不依赖向量库，向量库离线时仍可用）
 *
 * embedding 为独立完整配置（baseURL + apiKey + 模型），三项齐全才启用向量检索；
 * 向量化失败（端点错误 / 向量库离线）一律降级关键词模式，摄取与检索永不因向量失败而失败。
 */

/** 单次 embed 批量上限（openai 兼容接口的稳妥批量） */
const EMBED_BATCH = 32;

/** 与 settings.service 一致的 HTTP 错误约定 */
function httpError(status: number, message: string): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** embedding 端点（解密后的明文 key；任一项缺失返回 null = 关键词模式） */
async function resolveEmbedEndpoint(
  settings: KnowledgeSettings,
): Promise<{ baseURL: string; apiKey: string; model: string } | null> {
  const e = settings.embedding;
  if (!e.model.trim() || !e.baseURL.trim() || !e.apiKey) return null;
  const apiKey = await secureStore.decrypt(e.apiKey);
  if (!apiKey) return null;
  return { baseURL: e.baseURL.trim(), apiKey, model: e.model.trim() };
}

export interface IngestResult {
  document: KnowledgeDocumentDetail;
  /** 摄取向量化失败时的提示（文档已按关键词模式入库） */
  warning: string | null;
}

/** 把一篇文档的切片写入向量库（按当前 embedding 模型）；调用方保证向量已生成 */
async function upsertDocVectors(
  store: VectorStore,
  doc: { id: string; name: string; model: string },
  chunks: string[],
  vectors: Float32Array[],
): Promise<void> {
  await store.upsertChunks(
    chunks.map((text, idx) => ({
      id: `${doc.id}:${idx}`,
      text,
      metadata: { docId: doc.id, docName: doc.name, chunkIndex: idx, embeddingModel: doc.model },
      embedding: Array.from(vectors[idx] ?? vectors[0] ?? new Float32Array()),
    })),
  );
}

export const knowledgeService = {
  /** 注入向量库并执行旧数据迁移（main 启动时调用，异步不阻塞监听） */
  async init(store: VectorStore): Promise<void> {
    (knowledgeService as { store?: VectorStore }).store = store;
    if (!knowledgeRepo.legacyTableExists()) return;
    // 旧 kb_chunks 表在库：需向量库在线才搬运（有向量的切片推入向量库，随后删表）。
    // 向量库不在线则保留，下次启动重试 —— 期间新写入走新链路不受影响。
    const legacy = knowledgeRepo.legacyChunks();
    const vectorized = legacy.filter((c) => c.embedding);
    if (vectorized.length) {
      if (!(await store.health())) {
        console.warn(
          `[knowledge] 检测到旧版切片数据（${vectorized.length} 块含向量），但向量库（${store.kind}）不在线，迁移推迟到下次启动`,
        );
        return;
      }
      const byDoc = new Map<string, typeof legacy>();
      for (const c of vectorized) {
        const list = byDoc.get(c.docId) ?? [];
        list.push(c);
        byDoc.set(c.docId, list);
      }
      for (const [docId, chunks] of byDoc) {
        const doc = knowledgeRepo.getDoc(docId);
        const model = doc?.embeddingModel;
        if (!doc || !model) continue;
        await store.upsertChunks(
          chunks.map((c) => ({
            id: `${docId}:${c.idx}`,
            text: c.content,
            metadata: {
              docId,
              docName: doc.name,
              chunkIndex: c.idx,
              embeddingModel: model,
            },
            embedding: Array.from(c.embedding ?? new Float32Array()),
          })),
        );
      }
      console.log(`[knowledge] 旧版向量已迁移至 ${store.kind}（${vectorized.length} 块）`);
    }
    knowledgeRepo.backfillLegacyContent();
    knowledgeRepo.dropLegacyTable();
    console.log('[knowledge] 旧版 kb_chunks 表迁移完成并移除');
  },

  get vectorStore(): VectorStore {
    const store = (knowledgeService as { store?: VectorStore }).store;
    if (!store) throw new Error('knowledgeService 未初始化（缺少向量库注入）');
    return store;
  },

  listDocuments(): KnowledgeDocument[] {
    return knowledgeRepo.listDocs();
  },

  getDocument(id: string): KnowledgeDocumentDetail {
    const doc = knowledgeRepo.getDoc(id);
    if (!doc) throw httpError(404, `文档不存在: ${id}`);
    return doc;
  },

  async ingest(name: string, content: string): Promise<IngestResult> {
    if (knowledgeRepo.findByName(name)) {
      throw httpError(409, `同名文档已存在：${name}（可编辑替换，或换个名称）`);
    }
    const { document, warning } = await knowledgeService.writeDoc({
      id: null,
      name,
      content,
    });
    if (warning) console.warn(`[knowledge] ${name}: ${warning}`);
    return { document, warning };
  },

  /**
   * 更新文档：改名（同步向量库元数据）/ 替换内容（重切分 + 重向量化）。
   * 与 ingest 共用写入路径，但保留原名查重等细节差异。
   */
  async updateDocument(
    id: string,
    patch: { name?: string; content?: string },
  ): Promise<IngestResult> {
    const current = knowledgeRepo.getDoc(id);
    if (!current) throw httpError(404, `文档不存在: ${id}`);
    const nextName = patch.name?.trim() || current.name;
    if (nextName !== current.name) {
      const clash = knowledgeRepo.findByName(nextName);
      if (clash && clash.id !== id) throw httpError(409, `同名文档已存在：${nextName}`);
    }
    const contentChanged = patch.content !== undefined && patch.content !== current.content;
    const nameChanged = nextName !== current.name;
    if (!contentChanged && !nameChanged) return { document: current, warning: null };

    // 仅改名：注册表更新 + 向量库元数据同步（不动向量）
    if (!contentChanged) {
      const document = knowledgeRepo.updateDoc(id, { name: nextName });
      try {
        await knowledgeService.vectorStore.updateDocName(id, nextName);
      } catch (err) {
        console.warn(
          '[knowledge] 向量库改名同步失败（不影响检索，重建索引可修复）:',
          err instanceof Error ? err.message : err,
        );
      }
      return { document: document ?? current, warning: null };
    }

    // 内容变更：清旧向量 → 重切分 → 重向量化 → 注册表更新
    try {
      await knowledgeService.vectorStore.deleteDocChunks(id);
    } catch (err) {
      console.warn(
        '[knowledge] 清理旧向量失败（继续更新，重建索引可修复）:',
        err instanceof Error ? err.message : err,
      );
    }
    const { document, warning } = await knowledgeService.writeDoc({
      id,
      name: nextName,
      content: patch.content ?? current.content,
    });
    if (warning) console.warn(`[knowledge] ${nextName}: ${warning}`);
    return { document, warning };
  },

  removeDocument(id: string): void {
    if (!knowledgeRepo.removeDoc(id)) throw httpError(404, `文档不存在: ${id}`);
    // 注册表已删（source of truth）；向量库清理失败仅留下孤儿向量，
    // 检索侧按注册表过滤不会露出，重建索引亦可清理。
    void knowledgeService.vectorStore
      .deleteDocChunks(id)
      .catch((err: unknown) =>
        console.warn('[knowledge] 向量库清理失败（孤儿向量会在检索时被过滤）:', err instanceof Error ? err.message : err),
      );
  },

  /**
   * 检索：embedding 配置齐全且向量库在线时走向量（同模型向量才参与比较），
   * 否则/失败降级关键词（对原文现切现算，不依赖向量库）。
   */
  async search(query: string, topK?: number): Promise<KnowledgeSearchResponse> {
    const settings = settingsService.getKnowledge();
    const k = topK ?? settings.topK;
    const docs = knowledgeRepo.listDocDetails();
    if (!docs.length) return { mode: 'keyword', results: [] };

    const endpoint = await resolveEmbedEndpoint(settings);
    if (endpoint) {
      try {
        const store = knowledgeService.vectorStore;
        if (!(await store.health())) throw new Error('向量库不在线');
        const [qv] = await embedAll(endpoint, endpoint.model, [query]);
        if (qv) {
          const docIds = new Set(docs.map((d) => d.id));
          const docNames = new Map(docs.map((d) => [d.id, d.name]));
          // 多取一些再过滤（孤儿向量剔除 + 跨模型向量剔除）
          const matches = await store.querySimilar(Array.from(qv), k * 3);
          const results = matches
            .filter((m) => docIds.has(m.metadata.docId) && m.metadata.embeddingModel === endpoint.model)
            .map((m) => ({
              docId: m.metadata.docId,
              docName: docNames.get(m.metadata.docId) ?? m.metadata.docName,
              chunkIndex: m.metadata.chunkIndex,
              text: m.text,
              score: m.similarity,
            }))
            .slice(0, k);
          return { mode: 'vector', results };
        }
      } catch (err) {
        console.warn(
          '[knowledge] 向量检索失败，降级关键词检索:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    // 关键词兜底：原文现切现算（个人规模毫秒级，无需预存切片）
    const scored: KnowledgeSearchResponse['results'] = [];
    for (const doc of docs) {
      for (const [idx, text] of chunkText(doc.content).entries()) {
        const score = keywordScore(query, text);
        if (score > 0) scored.push({ docId: doc.id, docName: doc.name, chunkIndex: idx, text, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return { mode: 'keyword', results: scored.slice(0, k) };
  },

  /** 按当前 embedding 配置，从原文重建全部文档的向量索引 */
  async reindex(): Promise<{
    ok: boolean;
    embeddedChunks: number;
    totalChunks: number;
    error: string | null;
  }> {
    const docs = knowledgeRepo.listDocDetails();
    const totalChunks = docs.reduce((sum, d) => sum + d.chunkCount, 0);
    const endpoint = await resolveEmbedEndpoint(settingsService.getKnowledge());
    if (!endpoint) {
      return {
        ok: false,
        embeddedChunks: 0,
        totalChunks,
        error: 'embedding 未配置完整（需 baseURL、API Key、模型名）',
      };
    }
    const store = knowledgeService.vectorStore;
    if (!(await store.health())) {
      return { ok: false, embeddedChunks: 0, totalChunks, error: `向量库（${store.kind}）不在线` };
    }
    let embedded = 0;
    try {
      for (const doc of docs) {
        // 全量重建：清旧向量（含孤儿），再按当前模型重新切块向量化
        await store.deleteDocChunks(doc.id);
        const chunks = chunkText(doc.content);
        const vectors = await embedAll(endpoint, endpoint.model, chunks);
        await upsertDocVectors(store, { id: doc.id, name: doc.name, model: endpoint.model }, chunks, vectors);
        knowledgeRepo.updateDoc(doc.id, { chunkCount: chunks.length, embeddingModel: endpoint.model });
        embedded += vectors.length;
      }
      return { ok: true, embeddedChunks: embedded, totalChunks, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, embeddedChunks: embedded, totalChunks, error: message };
    }
  },

  /** 设置 + 统计 + 掩码 + 向量库状态（设置对话框展示） */
  async getSettingsView(): Promise<KnowledgeSettingsResponse> {
    const settings = settingsService.getKnowledge();
    const stats = knowledgeRepo.stats();
    const key = await secureStore.decrypt(settings.embedding.apiKey);
    const store = knowledgeService.vectorStore;
    return {
      embedding: {
        baseURL: settings.embedding.baseURL,
        model: settings.embedding.model,
        apiKey: '',
        apiKeyMasked: key ? maskKey(key) : '',
        storage: secureStore.encrypted ? 'encrypted' : 'plaintext',
      },
      topK: settings.topK,
      ...stats,
      chroma: { kind: store.kind, url: env.CHROMA_URL, healthy: await store.health() },
    };
  },

  /** 文档名列表（system prompt 引导模型用） */
  docNames(): string[] {
    return knowledgeRepo.listDocs().map((d) => d.name).slice(0, 50);
  },

  // ---------- 内部 ----------

  /** 统一写入路径：新建（id=null）或内容替换；向量化失败降级关键词并返回 warning */
  async writeDoc(input: { id: string | null; name: string; content: string }): Promise<IngestResult> {
    const settings = settingsService.getKnowledge();
    const chunks = chunkText(input.content);
    if (!chunks.length) throw httpError(400, '文档内容为空（或只有空白字符）');

    let warning: string | null = null;
    let embeddingModel: string | null = null;
    const docId = input.id ?? crypto.randomUUID();
    const endpoint = await resolveEmbedEndpoint(settings);
    if (endpoint) {
      try {
        const store = knowledgeService.vectorStore;
        await store.ensureReady();
        const vectors = await embedAll(endpoint, endpoint.model, chunks);
        await upsertDocVectors(store, { id: docId, name: input.name, model: endpoint.model }, chunks, vectors);
        embeddingModel = endpoint.model;
      } catch (err) {
        warning = `向量化失败（${
          err instanceof Error ? err.message : String(err)
        }），已按关键词模式保存；可在「检索设置」中修正后重建索引`;
        embeddingModel = null;
      }
    }

    const document = input.id
      ? knowledgeRepo.updateDoc(input.id, {
          name: input.name,
          content: input.content,
          chars: input.content.length,
          chunkCount: chunks.length,
          embeddingModel,
        })
      : knowledgeRepo.createDoc({
          id: docId,
          name: input.name,
          content: input.content,
          chars: input.content.length,
          chunkCount: chunks.length,
          embeddingModel,
        });
    if (!document) throw httpError(404, `文档不存在: ${input.id}`);
    return { document, warning };
  },
};

/** sk-very-long-key-abcd → sk-***abcd（同 settings.service 约定） */
function maskKey(key: string): string {
  return key.length <= 8 ? '***' : `${key.slice(0, 3)}***${key.slice(-4)}`;
}

/** 分批 embed，返回与输入同序的向量 */
async function embedAll(
  endpoint: { baseURL: string; apiKey: string },
  model: string,
  texts: string[],
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(endpoint, model, batch);
    out.push(...vectors.map((v) => Float32Array.from(v)));
  }
  return out;
}
