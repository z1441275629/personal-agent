import { randomUUID } from 'node:crypto';
import type { Conversation } from '@pa/shared';
import { getDb } from '../db';

interface ConversationRow {
  id: unknown;
  title: unknown;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
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

  /** 未删除的会话；已软删除的（deleted_at 非空）对外不可见 */
  get(id: string): Conversation | undefined {
    const row = getDb()
      .prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL')
      .get(id) as ConversationRow | undefined;
    return row ? toConversation(row) : undefined;
  },

  /** 按最近活跃排序（不含已软删除） */
  list(): Conversation[] {
    const rows = getDb()
      .prepare('SELECT * FROM conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC')
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

  /** 软删除：只打删除标记，行与消息都保留在库里 */
  softRemove(id: string): void {
    getDb().prepare('UPDATE conversations SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
  },
};
