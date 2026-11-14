import { randomUUID } from 'node:crypto';
import type { Notification, NotificationType } from '@pa/shared';
import { getDb } from '../db';

interface NotificationRow {
  id: unknown;
  task_id: unknown;
  type: unknown;
  title: unknown;
  body: unknown;
  content: unknown;
  read_at: unknown;
  created_at: unknown;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: String(row.id),
    taskId: row.task_id == null ? null : String(row.task_id),
    type: String(row.type) as NotificationType,
    title: String(row.title),
    body: String(row.body),
    content: row.content == null ? null : String(row.content),
    readAt: row.read_at == null ? null : Number(row.read_at),
    createdAt: Number(row.created_at),
  };
}

/** 通知草稿：job 执行的产出，由仓储补 id/createdAt/readAt */
export interface NotificationDraft {
  taskId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  content?: string | null;
}

export const notificationsRepo = {
  create(draft: NotificationDraft): Notification {
    const n: Notification = {
      id: randomUUID(),
      taskId: draft.taskId,
      type: draft.type,
      title: draft.title,
      body: draft.body,
      content: draft.content ?? null,
      readAt: null,
      createdAt: Date.now(),
    };
    getDb()
      .prepare(
        'INSERT INTO notifications (id, task_id, type, title, body, content, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(n.id, n.taskId, n.type, n.title, n.body, n.content, null, n.createdAt);
    return n;
  },

  /** 时间倒序，最近 limit 条（默认 50） */
  list(limit = 50): Notification[] {
    const rows = getDb()
      .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as NotificationRow[];
    return rows.map(toNotification);
  },

  unreadCount(): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM notifications WHERE read_at IS NULL')
      .get() as { c: number };
    return Number(row.c);
  },

  markRead(ids: string[]): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(', ');
    getDb()
      .prepare(`UPDATE notifications SET read_at = ? WHERE id IN (${placeholders}) AND read_at IS NULL`)
      .run(Date.now(), ...ids);
  },

  markAllRead(): void {
    getDb().prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(Date.now());
  },
};
