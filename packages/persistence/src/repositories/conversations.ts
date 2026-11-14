import { randomUUID } from 'node:crypto';
import type { Conversation } from '@pa/shared';
import { getDb } from '../db';

interface ConversationRow {
  id: unknown;
  title: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export const conversationsRepo = {
  create(title?: string): Conversation {
    const now = Date.now();
    const conv: Conversation = {
      id: randomUUID(),
      title: title ?? '新对话',
      createdAt: now,
      updatedAt: now,
    };
    getDb()
      .prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(conv.id, conv.title, conv.createdAt, conv.updatedAt);
    return conv;
  },

  get(id: string): Conversation | undefined {
    const row = getDb()
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as ConversationRow | undefined;
    return row ? toConversation(row) : undefined;
  },

  /** 按最近活跃排序 */
  list(): Conversation[] {
    const rows = getDb()
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all() as unknown as ConversationRow[];
    return rows.map(toConversation);
  },

  touch(id: string): void {
    getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  },

  rename(id: string, title: string): void {
    getDb()
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
  },
};
