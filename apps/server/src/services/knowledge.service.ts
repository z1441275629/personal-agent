import { embedTexts } from '@pa/llm';
import { chunkText, cosineSimilarity, keywordScore } from '@pa/retrieval';
import { knowledgeRepo } from '@pa/persistence';
import type {
  KnowledgeDocument,
  KnowledgeSearchResponse,
  KnowledgeSettings,
  KnowledgeSettingsResponse,
  ProviderSetting,
} from '@pa/shared';
import { settingsService } from './settings.service';

/**
 * 知识库（RAG）：文档摄取 → 切分 → 向量化（可选）→ 检索。
 *
 * 向量方案：SQLite 内嵌 Float32 BLOB + JS 余弦暴力扫（个人规模千级切片，
 * 无外部向量库依赖）。embedding 单独配置（provider + 模型），失败或未配置
 * 时降级关键词检索（CJK 2-gram），功能始终可用。
 */

/** 单次 embed 批量上限（openai 兼容接口的稳妥批量） */
const EMBED_BATCH = 32;

/** 与 settings.service 一致的 HTTP 错误约定 */
function httpError(status: number, message: string): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** 解析 embedding 用的 provider：显式 id（含停用）优先，缺省跟第一个启用的 */
async function resolveEmbedProvider(settings: KnowledgeSettings): Promise<ProviderSetting | null> {
  const all = await settingsService.listFull();
  if (settings.embeddingProviderId) {
    return all.find((p) => p.id === settings.embeddingProviderId) ?? null;
  }
  return all.find((p) => p.enabled) ?? null;
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
    if (settings.embeddingModel) {
      const provider = await resolveEmbedProvider(settings);
      if (!provider) {
        warning = '未找到可用的 embedding provider，已按关键词模式入库';
      } else {
        try {
          vectors = await embedAll(provider, settings.embeddingModel, chunks);
          embeddingModel = settings.embeddingModel;
        } catch (err) {
          warning = `向量化失败（${
            err instanceof Error ? err.message : String(err)
          }），已按关键词模式入库；可在设置中修正后点「重建索引」`;
        }
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
   * 检索：当前模型已向量的切片走余弦；未配置/无向量切片/查询向量化失败
   * 一律降级关键词打分。返回带实际使用的 mode。
   */
  async search(query: string, topK?: number): Promise<KnowledgeSearchResponse> {
    const settings = settingsService.getKnowledge();
    const k = topK ?? settings.topK;
    const all = knowledgeRepo.allChunks();
    if (!all.length) return { mode: 'keyword', results: [] };

    if (settings.embeddingModel) {
      const candidates = all.filter(
        (c) => c.docEmbeddingModel === settings.embeddingModel && c.embedding,
      );
      if (candidates.length) {
        const provider = await resolveEmbedProvider(settings);
        if (provider) {
          try {
            const [qv] = await embedAll(provider, settings.embeddingModel, [query]);
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
    const settings = settingsService.getKnowledge();
    if (!settings.embeddingModel) {
      return { ok: false, embeddedChunks: 0, totalChunks, error: '未配置 embedding 模型' };
    }
    const provider = await resolveEmbedProvider(settings);
    if (!provider) {
      return { ok: false, embeddedChunks: 0, totalChunks, error: '未找到可用的 embedding provider' };
    }
    let embedded = 0;
    try {
      for (const doc of knowledgeRepo.listDocs()) {
        const chunks = knowledgeRepo
          .allChunks()
          .filter((c) => c.docId === doc.id)
          .sort((a, b) => a.idx - b.idx);
        const vectors = await embedAll(provider, settings.embeddingModel, chunks.map((c) => c.content));
        knowledgeRepo.updateDocEmbeddings(
          doc.id,
          settings.embeddingModel,
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

  /** 设置 + 统计（设置页一屏展示） */
  async getSettingsView(): Promise<KnowledgeSettingsResponse> {
    const settings = settingsService.getKnowledge();
    const stats = knowledgeRepo.stats();
    // provider 可能已删除 → 置空提示
    if (settings.embeddingProviderId) {
      const all = await settingsService.listFull();
      if (!all.some((p) => p.id === settings.embeddingProviderId)) {
        settings.embeddingProviderId = null;
      }
    }
    return { ...settings, ...stats };
  },

  /** 文档名列表（system prompt 引导模型用） */
  docNames(): string[] {
    return knowledgeRepo.listDocs().map((d) => d.name).slice(0, 50);
  },
};

/** 分批 embed，返回与输入同序的向量 */
async function embedAll(
  provider: ProviderSetting,
  model: string,
  texts: string[],
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(provider, model, batch);
    out.push(...vectors.map((v) => Float32Array.from(v)));
  }
  return out;
}
