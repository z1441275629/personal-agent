import { randomUUID } from 'node:crypto';
import type { KnowledgeDocument } from '@pa/shared';
import { getDb } from '../db';

/**
 * 知识库仓储：文档 + 切片（embedding 存 Float32Array 的 BLOB）。
 * 向量检索为个人规模（千级切片）设计，余弦相似度 JS 暴力扫即可，无外部向量库依赖。
 */

interface DocRow {
  id: unknown;
  name: unknown;
  chars: unknown;
  chunk_count: unknown;
  embedding_model: unknown;
  created_at: unknown;
}

interface ChunkRow {
  id: unknown;
  doc_id: unknown;
  idx: unknown;
  content: unknown;
  embedding: unknown;
}

function toDoc(row: DocRow): KnowledgeDocument {
  return {
    id: String(row.id),
    name: String(row.name),
    chars: Number(row.chars),
    chunkCount: Number(row.chunk_count),
    embeddingModel: row.embedding_model == null ? null : String(row.embedding_model),
    createdAt: Number(row.created_at),
  };
}

function toEmbedding(blob: unknown): Float32Array | null {
  if (!(blob instanceof Uint8Array) || blob.byteLength === 0) return null;
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

export interface KnowledgeChunkRow {
  chunkId: string;
  docId: string;
  docName: string;
  docEmbeddingModel: string | null;
  idx: number;
  content: string;
  embedding: Float32Array | null;
}

export const knowledgeRepo = {
  createDoc(input: {
    name: string;
    chars: number;
    embeddingModel: string | null;
    chunks: Array<{ idx: number; content: string; embedding: Float32Array | null }>;
  }): KnowledgeDocument {
    const now = Date.now();
    const doc: KnowledgeDocument = {
      id: randomUUID(),
      name: input.name,
      chars: input.chars,
      chunkCount: input.chunks.length,
      embeddingModel: input.embeddingModel,
      createdAt: now,
    };
    const db = getDb();
    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO kb_documents (id, name, chars, chunk_count, embedding_model, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(doc.id, doc.name, doc.chars, doc.chunkCount, doc.embeddingModel, doc.createdAt);
      const stmt = db.prepare(
        'INSERT INTO kb_chunks (id, doc_id, idx, content, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const c of input.chunks) {
        stmt.run(
          randomUUID(),
          doc.id,
          c.idx,
          c.content,
          c.embedding ? Buffer.from(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength) : null,
          now,
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return doc;
  },

  listDocs(): KnowledgeDocument[] {
    const rows = getDb()
      .prepare('SELECT * FROM kb_documents ORDER BY created_at DESC')
      .all() as unknown as DocRow[];
    return rows.map(toDoc);
  },

  removeDoc(id: string): boolean {
    const res = getDb().prepare('DELETE FROM kb_documents WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  },

  /** 全量切片（含文档名与文档级 embedding 模型），检索扫描用 */
  allChunks(): KnowledgeChunkRow[] {
    const rows = getDb()
      .prepare(
        `SELECT c.id, c.doc_id, c.idx, c.content, c.embedding,
                d.name AS doc_name, d.embedding_model AS doc_embedding_model
         FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
         ORDER BY d.created_at DESC, c.idx`,
      )
      .all() as unknown as (ChunkRow & { doc_name: unknown; doc_embedding_model: unknown })[];
    return rows.map((r) => ({
      chunkId: String(r.id),
      docId: String(r.doc_id),
      docName: String(r.doc_name),
      docEmbeddingModel: r.doc_embedding_model == null ? null : String(r.doc_embedding_model),
      idx: Number(r.idx),
      content: String(r.content),
      embedding: toEmbedding(r.embedding),
    }));
  },

  /** 重建向量索引：按 idx 批量回填 embedding 并更新文档级模型标记 */
  updateDocEmbeddings(
    docId: string,
    embeddingModel: string | null,
    vectors: Array<{ idx: number; embedding: Float32Array | null }>,
  ): void {
    const db = getDb();
    db.exec('BEGIN');
    try {
      const stmt = db.prepare('UPDATE kb_chunks SET embedding = ? WHERE doc_id = ? AND idx = ?');
      for (const v of vectors) {
        stmt.run(
          v.embedding
            ? Buffer.from(v.embedding.buffer, v.embedding.byteOffset, v.embedding.byteLength)
            : null,
          docId,
          v.idx,
        );
      }
      db.prepare('UPDATE kb_documents SET embedding_model = ? WHERE id = ?').run(
        embeddingModel,
        docId,
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  /** 统计（设置页展示） */
  stats(): { documentCount: number; totalChunks: number; embeddedChunks: number } {
    const row = getDb()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM kb_documents) AS docs,
                (SELECT COUNT(*) FROM kb_chunks) AS chunks,
                (SELECT COUNT(*) FROM kb_chunks WHERE embedding IS NOT NULL) AS embedded`,
      )
      .get() as unknown as { docs: unknown; chunks: unknown; embedded: unknown };
    return {
      documentCount: Number(row?.docs ?? 0),
      totalChunks: Number(row?.chunks ?? 0),
      embeddedChunks: Number(row?.embedded ?? 0),
    };
  },
};
