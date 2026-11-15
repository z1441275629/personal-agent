import type {
  VectorChunkInput,
  VectorMatch,
  VectorStore,
} from './vector-store';

/**
 * Chroma 1.x v2 REST 适配器（原生 fetch，零 SDK 依赖）。
 *
 * 只封装知识库用到的 6 个操作；集合使用 cosine 空间（similarity = 1 - distance）。
 * 接口契约见 vector-store.ts —— 迁移其他向量库时新增 adapter 即可。
 */

interface ChromaOptions {
  /** 服务地址，如 http://127.0.0.1:8000 */
  url: string;
  /** 集合名（一个业务一个集合） */
  collectionName: string;
  /** 单请求超时（毫秒） */
  timeoutMs?: number;
}

interface ChromaQueryResponse {
  ids: string[][];
  documents: (string | null)[][];
  metadatas: ({
    docId?: unknown;
    docName?: unknown;
    chunkIndex?: unknown;
    embeddingModel?: unknown;
  } | null)[][];
  distances: number[][];
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ChromaVectorStore implements VectorStore {
  readonly kind = 'chroma';
  private readonly url: string;
  private readonly collectionName: string;
  private readonly timeoutMs: number;
  /** 集合 id 缓存（ensureReady 后有效） */
  private collectionId: string | null = null;

  constructor(options: ChromaOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.collectionName = options.collectionName;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/api/v2/heartbeat`, {
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureReady(): Promise<void> {
    if (this.collectionId) return;
    // get_or_create：首次创建 cosine 空间，重复调用幂等
    const res = await this.request('POST', '/collections', {
      name: this.collectionName,
      get_or_create: true,
      metadata: { 'hnsw:space': 'cosine' },
    });
    const id = (res as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) throw new Error('Chroma 返回的集合缺少 id');
    this.collectionId = id;
  }

  async upsertChunks(chunks: VectorChunkInput[]): Promise<void> {
    if (!chunks.length) return;
    const id = await this.collectionIdOrThrow();
    await this.request('POST', `/collections/${id}/upsert`, {
      ids: chunks.map((c) => c.id),
      embeddings: chunks.map((c) => c.embedding),
      documents: chunks.map((c) => c.text),
      metadatas: chunks.map((c) => ({
        docId: c.metadata.docId,
        docName: c.metadata.docName,
        chunkIndex: c.metadata.chunkIndex,
        embeddingModel: c.metadata.embeddingModel,
      })),
    });
  }

  async deleteDocChunks(docId: string): Promise<void> {
    const id = await this.collectionIdOrThrow();
    // 无命中时 Chroma 正常返回 {deleted: 0}，不算错误
    await this.request('POST', `/collections/${id}/delete`, { where: { docId } });
  }

  async updateDocName(docId: string, newDocName: string): Promise<void> {
    const id = await this.collectionIdOrThrow();
    // 取回该文档切片的 id 与原元数据（改名需整份回写，不能只给 docName）
    const got = (await this.request('POST', `/collections/${id}/get`, {
      where: { docId },
      include: ['metadatas'],
    })) as {
      ids?: string[];
      metadatas?: ({ chunkIndex?: unknown; embeddingModel?: unknown } | null)[];
    };
    const ids = got.ids ?? [];
    if (!ids.length) return;
    await this.request('POST', `/collections/${id}/update`, {
      ids,
      metadatas: ids.map((_, i) => ({
        docId,
        docName: newDocName,
        chunkIndex: Number(got.metadatas?.[i]?.chunkIndex ?? 0),
        embeddingModel: String(got.metadatas?.[i]?.embeddingModel ?? ''),
      })),
    });
  }

  async querySimilar(embedding: number[], k: number): Promise<VectorMatch[]> {
    const id = await this.collectionIdOrThrow();
    const res = (await this.request('POST', `/collections/${id}/query`, {
      query_embeddings: [embedding],
      n_results: k,
      include: ['documents', 'metadatas', 'distances'],
    })) as ChromaQueryResponse;
    const ids = res.ids?.[0] ?? [];
    const docs = res.documents?.[0] ?? [];
    const metas = res.metadatas?.[0] ?? [];
    const dists = res.distances?.[0] ?? [];
    return ids.map((cid, i) => ({
      id: cid,
      text: docs[i] ?? '',
      metadata: {
        docId: String(metas[i]?.docId ?? ''),
        docName: String(metas[i]?.docName ?? ''),
        chunkIndex: Number(metas[i]?.chunkIndex ?? 0),
        embeddingModel: String(metas[i]?.embeddingModel ?? ''),
      },
      // cosine 空间：distance ∈ [0,2]，相似度 = 1 - distance
      similarity: 1 - Number(dists[i] ?? 1),
    }));
  }

  async countChunks(): Promise<number | null> {
    try {
      const id = await this.collectionIdOrThrow();
      const res = await this.request('GET', `/collections/${id}/count`);
      const n = Number(res);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  // ---------- 内部 ----------

  private async collectionIdOrThrow(): Promise<string> {
    await this.ensureReady();
    if (!this.collectionId) throw new Error('Chroma 集合未初始化');
    return this.collectionId;
  }

  private get base(): string {
    // v2 API 的租户/数据库段固定用默认值（chroma run 默认即此）
    return `${this.url}/api/v2/tenants/default_tenant/databases/default_database`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Chroma 连接失败（${this.url}）：${reason}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
        message = String(parsed.message ?? parsed.error ?? message);
      } catch {
        /* 非 JSON 错误体，保留原文 */
      }
      throw new Error(`Chroma ${method} ${path} 失败（HTTP ${res.status}）：${message}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
