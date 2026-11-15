import { randomUUID } from 'node:crypto';
import type { KnowledgeDocument, KnowledgeDocumentDetail } from '@pa/shared';
import { getDb } from '../db';

/**
 * 知识库仓储：只管「文档注册表 + 完整原文」（SQLite）。
 * 切片与向量是可重建的派生索引，存外部向量库（Chroma，经 @pa/infra VectorStore），
 * 不再落主库 —— 主库与向量库职责分离。
 *
 * 旧版 kb_chunks 表（向量 BLOB 内嵌）由 migrateLegacy* 在启动时一次性搬运进
 * 向量库后删除；搬运需要向量库在线，不在线则保留待下次启动重试。
 */

interface DocRow {
  id: unknown;
  name: unknown;
  chars: unknown;
  chunk_count: unknown;
  embedding_model: unknown;
  content: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function toDoc(row: DocRow): KnowledgeDocument {
  return {
    id: String(row.id),
    name: String(row.name),
    chars: Number(row.chars),
    chunkCount: Number(row.chunk_count),
    embeddingModel: row.embedding_model == null ? null : String(row.embedding_model),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toDetail(row: DocRow): KnowledgeDocumentDetail {
  return { ...toDoc(row), content: String(row.content ?? '') };
}

/** 旧版切片行（迁移期读取；embedding 为 Float32 BLOB） */
export interface LegacyChunkRow {
  docId: string;
  idx: number;
  content: string;
  embedding: Float32Array | null;
}

function toEmbedding(blob: unknown): Float32Array | null {
  if (!(blob instanceof Uint8Array) || blob.byteLength === 0) return null;
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

/**
 * 由旧切片重建原文：按序直接拼接；若下一块的开头与已拼文本的结尾重合
 * （旧切块器的硬切分 overlap 特征），则跳过重复前缀，避免重建文本含重复段落。
 */
function reconstructContent(chunks: string[]): string {
  if (!chunks.length) return '';
  let out = chunks[0] ?? '';
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i] ?? '';
    // 最长可跳过前缀 ≤ 200（旧 overlap 为 120，留余量）
    const max = Math.min(200, c.length, out.length);
    let skip = 0;
    for (let len = max; len > 0; len--) {
      if (out.endsWith(c.slice(0, len))) {
        skip = len;
        break;
      }
    }
    out += skip > 0 ? c.slice(skip) : c;
  }
  return out;
}

export const knowledgeRepo = {
  createDoc(input: {
    /** 显式 id（与向量库切片 id 前缀保持一致）；缺省时生成 */
    id?: string;
    name: string;
    content: string;
    chars: number;
    chunkCount: number;
    embeddingModel: string | null;
  }): KnowledgeDocumentDetail {
    const now = Date.now();
    const doc: KnowledgeDocumentDetail = {
      id: input.id ?? randomUUID(),
      name: input.name,
      chars: input.chars,
      chunkCount: input.chunkCount,
      embeddingModel: input.embeddingModel,
      createdAt: now,
      updatedAt: now,
      content: input.content,
    };
    getDb()
      .prepare(
        `INSERT INTO kb_documents (id, name, chars, chunk_count, embedding_model, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(doc.id, doc.name, doc.chars, doc.chunkCount, doc.embeddingModel, doc.content, doc.createdAt, doc.updatedAt);
    return doc;
  },

  listDocs(): KnowledgeDocument[] {
    const rows = getDb()
      .prepare('SELECT * FROM kb_documents ORDER BY created_at DESC')
      .all() as unknown as DocRow[];
    return rows.map(toDoc);
  },

  /** 全部文档详情（关键词检索现切现算 / 重建索引的原料） */
  listDocDetails(): KnowledgeDocumentDetail[] {
    const rows = getDb()
      .prepare('SELECT * FROM kb_documents ORDER BY created_at DESC')
      .all() as unknown as DocRow[];
    return rows.map(toDetail);
  },

  getDoc(id: string): KnowledgeDocumentDetail | null {
    const row = getDb()
      .prepare('SELECT * FROM kb_documents WHERE id = ?')
      .get(id) as unknown as DocRow | undefined;
    return row ? toDetail(row) : null;
  },

  findByName(name: string): KnowledgeDocument | null {
    const row = getDb()
      .prepare('SELECT * FROM kb_documents WHERE name = ?')
      .get(name) as unknown as DocRow | undefined;
    return row ? toDoc(row) : null;
  },

  /** 局部更新（name / content 变更必然伴随 chunkCount·chars·embeddingModel 重算），刷新 updated_at */
  updateDoc(
    id: string,
    patch: {
      name?: string;
      content?: string;
      chars?: number;
      chunkCount?: number;
      embeddingModel?: string | null;
    },
  ): KnowledgeDocumentDetail | null {
    const current = knowledgeRepo.getDoc(id);
    if (!current) return null;
    const next = {
      name: patch.name ?? current.name,
      chars: patch.chars ?? current.chars,
      chunkCount: patch.chunkCount ?? current.chunkCount,
      embeddingModel: patch.embeddingModel !== undefined ? patch.embeddingModel : current.embeddingModel,
      content: patch.content ?? current.content,
    };
    getDb()
      .prepare(
        `UPDATE kb_documents SET name = ?, chars = ?, chunk_count = ?, embedding_model = ?, content = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(next.name, next.chars, next.chunkCount, next.embeddingModel, next.content, Date.now(), id);
    return knowledgeRepo.getDoc(id);
  },

  removeDoc(id: string): boolean {
    const res = getDb().prepare('DELETE FROM kb_documents WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  },

  // ---------- 旧版 kb_chunks 迁移（一次性搬运进向量库） ----------

  /** 旧表是否存在（存在 = 有迁移待做，或迁移未完成） */
  legacyTableExists(): boolean {
    const row = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kb_chunks'")
      .get() as unknown as { name?: unknown } | undefined;
    return row != null;
  },

  legacyChunks(): LegacyChunkRow[] {
    const rows = getDb()
      .prepare('SELECT doc_id, idx, content, embedding FROM kb_chunks ORDER BY doc_id, idx')
      .all() as unknown as { doc_id: unknown; idx: unknown; content: unknown; embedding: unknown }[];
    return rows.map((r) => ({
      docId: String(r.doc_id),
      idx: Number(r.idx),
      content: String(r.content),
      embedding: toEmbedding(r.embedding),
    }));
  },

  /** 补齐存量文档的原文与 updated_at（原文按序拼接，并裁掉硬切分重叠的前缀避免重复） */
  backfillLegacyContent(): void {
    const docs = getDb()
      .prepare("SELECT id FROM kb_documents WHERE content = ''")
      .all() as unknown as { id: unknown }[];
    const update = getDb().prepare(
      'UPDATE kb_documents SET content = ?, updated_at = CASE WHEN updated_at = 0 THEN created_at ELSE updated_at END WHERE id = ?',
    );
    for (const d of docs) {
      const id = String(d.id);
      const chunks = knowledgeRepo
        .legacyChunks()
        .filter((c) => c.docId === id)
        .map((c) => c.content);
      if (chunks.length) update.run(reconstructContent(chunks), id);
    }
    // 无切片文档（理论不存在，防御）与 updated_at 归一
    getDb()
      .prepare('UPDATE kb_documents SET updated_at = created_at WHERE updated_at = 0')
      .run();
  },

  dropLegacyTable(): void {
    getDb().exec('DROP TABLE IF EXISTS kb_chunks');
  },

  /** 统计（设置页展示）：已向量化块数 = 已建向量索引文档的切块数合计 */
  stats(): { documentCount: number; totalChunks: number; embeddedChunks: number } {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS docs,
                COALESCE(SUM(chunk_count), 0) AS chunks,
                COALESCE(SUM(CASE WHEN embedding_model IS NOT NULL THEN chunk_count ELSE 0 END), 0) AS embedded
         FROM kb_documents`,
      )
      .get() as unknown as { docs: unknown; chunks: unknown; embedded: unknown };
    return {
      documentCount: Number(row?.docs ?? 0),
      totalChunks: Number(row?.chunks ?? 0),
      embeddedChunks: Number(row?.embedded ?? 0),
    };
  },
};
