import { embedTexts } from '@pa/llm';
import { chunkText, cosineSimilarity, keywordScore } from '@pa/retrieval';
import { knowledgeRepo } from '@pa/persistence';
import type {
  KnowledgeDocument,
  KnowledgeSearchResponse,
  KnowledgeSettings,
  KnowledgeSettingsResponse,
} from '@pa/shared';
import { settingsService } from './settings.service';
import { secureStore } from './secure-store';

/**
 * 知识库（RAG）：文档摄取 → 切分 → 向量化（可选）→ 检索。
 *
 * 向量方案：SQLite 内嵌 Float32 BLOB + JS 余弦暴力扫（个人规模千级切片，
 * 无外部向量库依赖）。embedding 为独立完整配置（baseURL + apiKey + 模型），
 * 三项齐全才启用向量；失败或未配置时降级关键词检索（CJK 2-gram），
 * 摄取与检索永不失败。
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
  document: KnowledgeDocument;
  /** 摄取向量化失败时的提示（文档已按关键词模式入库） */
  warning: string | null;
}

export const knowledgeService = {
  listDocuments(): KnowledgeDocument[] {
    return knowledgeRepo.listDocs();
  },

  async ingest(name: string, content: string): Promise<IngestResult> {
    const settings = settingsService.getKnowledge();
    const chunks = chunkText(content);
    if (!chunks.length) throw httpError(400, '文档内容为空（或只有空白字符）');

    let warning: string | null = null;
    let embeddingModel: string | null = null;
    let vectors: Float32Array[] | null = null;
    const endpoint = await resolveEmbedEndpoint(settings);
    if (endpoint) {
      try {
        vectors = await embedAll(endpoint, endpoint.model, chunks);
        embeddingModel = endpoint.model;
      } catch (err) {
        warning = `向量化失败（${
          err instanceof Error ? err.message : String(err)
        }），已按关键词模式入库；可在「检索设置」中修正后重建索引`;
      }
    }

    const document = knowledgeRepo.createDoc({
      name,
      chars: content.length,
      embeddingModel,
      chunks: chunks.map((content, idx) => ({
        idx,
        content,
        embedding: vectors ? (vectors[idx] ?? null) : null,
      })),
    });
    if (warning) console.warn(`[knowledge] ${name}: ${warning}`);
    return { document, warning };
  },

  removeDocument(id: string): void {
    if (!knowledgeRepo.removeDoc(id)) throw httpError(404, `文档不存在: ${id}`);
  },

  /**
   * 检索：embedding 配置齐全且切片已向量化时走余弦；
   * 未配置/无向量切片/查询向量化失败一律降级关键词打分。
   */
  async search(query: string, topK?: number): Promise<KnowledgeSearchResponse> {
    const settings = settingsService.getKnowledge();
    const k = topK ?? settings.topK;
    const all = knowledgeRepo.allChunks();
    if (!all.length) return { mode: 'keyword', results: [] };

    const endpoint = await resolveEmbedEndpoint(settings);
    if (endpoint) {
      const candidates = all.filter(
        (c) => c.docEmbeddingModel === endpoint.model && c.embedding,
      );
      if (candidates.length) {
        try {
          const [qv] = await embedAll(endpoint, endpoint.model, [query]);
          if (qv) {
            return {
              mode: 'vector',
              results: candidates
                .map((c) => ({
                  docId: c.docId,
                  docName: c.docName,
                  chunkIndex: c.idx,
                  text: c.content,
                  score: cosineSimilarity(qv, c.embedding!),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, k),
            };
          }
        } catch (err) {
          console.warn(
            '[knowledge] 查询向量化失败，降级关键词检索:',
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    return {
      mode: 'keyword',
      results: all
        .map((c) => ({
          docId: c.docId,
          docName: c.docName,
          chunkIndex: c.idx,
          text: c.content,
          score: keywordScore(query, c.content),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k),
    };
  },

  /** 按当前 embedding 配置重建全部文档的向量索引 */
  async reindex(): Promise<{ ok: boolean; embeddedChunks: number; totalChunks: number; error: string | null }> {
    const { totalChunks } = knowledgeRepo.stats();
    const endpoint = await resolveEmbedEndpoint(settingsService.getKnowledge());
    if (!endpoint) {
      return { ok: false, embeddedChunks: 0, totalChunks, error: 'embedding 未配置完整（需 baseURL、API Key、模型名）' };
    }
    let embedded = 0;
    try {
      for (const doc of knowledgeRepo.listDocs()) {
        const chunks = knowledgeRepo
          .allChunks()
          .filter((c) => c.docId === doc.id)
          .sort((a, b) => a.idx - b.idx);
        const vectors = await embedAll(endpoint, endpoint.model, chunks.map((c) => c.content));
        knowledgeRepo.updateDocEmbeddings(
          doc.id,
          endpoint.model,
          chunks.map((c, i) => ({ idx: c.idx, embedding: vectors[i] ?? null })),
        );
        embedded += vectors.length;
      }
      return { ok: true, embeddedChunks: embedded, totalChunks, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, embeddedChunks: embedded, totalChunks, error: message };
    }
  },

  /** 设置 + 统计 + 掩码（设置对话框展示） */
  async getSettingsView(): Promise<KnowledgeSettingsResponse> {
    const settings = settingsService.getKnowledge();
    const stats = knowledgeRepo.stats();
    const key = await secureStore.decrypt(settings.embedding.apiKey);
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
    };
  },

  /** 文档名列表（system prompt 引导模型用） */
  docNames(): string[] {
    return knowledgeRepo.listDocs().map((d) => d.name).slice(0, 50);
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
