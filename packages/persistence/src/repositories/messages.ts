import { randomUUID } from 'node:crypto';
import type { Message, MessageRole } from '@pa/shared';
import { getDb } from '../db';

interface MessageRow {
  id: unknown;
  conversation_id: unknown;
  role: unknown;
  content: unknown;
  created_at: unknown;
}

function toMessage(row: MessageRow): Message {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: String(row.role) as MessageRole,
    content: String(row.content),
    createdAt: Number(row.created_at),
  };
}

export const messagesRepo = {
  create(conversationId: string, role: MessageRole, content: string): Message {
    const msg: Message = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      createdAt: Date.now(),
    };
    getDb()
      .prepare(
        'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(msg.id, msg.conversationId, msg.role, msg.content, msg.createdAt);
    return msg;
  },

  listByConversation(conversationId: string): Message[] {
    const rows = getDb()
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at')
      .all(conversationId) as unknown as MessageRow[];
    return rows.map(toMessage);
  },
};
