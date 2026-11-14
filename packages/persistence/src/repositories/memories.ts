import { randomUUID } from 'node:crypto';
import type { Memory, MemoryType } from '@pa/shared';
import { getDb } from '../db';

interface MemoryRow {
  id: unknown;
  content: unknown;
  type: unknown;
  source_conversation_id: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: String(row.id),
    content: String(row.content),
    type: String(row.type) as MemoryType,
    sourceConversationId:
      row.source_conversation_id == null ? null : String(row.source_conversation_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export const memoriesRepo = {
  create(input: { content: string; type: MemoryType; sourceConversationId?: string | null }): Memory {
    const now = Date.now();
    const memory: Memory = {
      id: randomUUID(),
      content: input.content,
      type: input.type,
      sourceConversationId: input.sourceConversationId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    getDb()
      .prepare(
        'INSERT INTO memories (id, content, type, source_conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        memory.id,
        memory.content,
        memory.type,
        memory.sourceConversationId,
        memory.createdAt,
        memory.updatedAt,
      );
    return memory;
  },

  list(): Memory[] {
    const rows = getDb()
      .prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT 500')
      .all() as unknown as MemoryRow[];
    return rows.map(toMemory);
  },

  get(id: string): Memory | undefined {
    const row = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? toMemory(row) : undefined;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
  },
};
