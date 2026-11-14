import { randomUUID } from 'node:crypto';
import type { Task, TaskPayload } from '@pa/shared';
import { getDb } from '../db';

interface TaskRow {
  id: unknown;
  type: unknown;
  name: unknown;
  cron: unknown;
  payload: unknown;
  enabled: unknown;
  last_run_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function toTask(row: TaskRow): Task {
  return {
    id: String(row.id),
    type: String(row.type) as Task['type'],
    name: String(row.name),
    cron: String(row.cron),
    payload: JSON.parse(String(row.payload)) as TaskPayload,
    enabled: Number(row.enabled) === 1,
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export interface TaskUpdate {
  name?: string;
  cron?: string;
  payload?: TaskPayload;
  enabled?: boolean;
}

export const tasksRepo = {
  create(input: Omit<Task, 'lastRunAt' | 'createdAt' | 'updatedAt'>): Task {
    const now = Date.now();
    const task: Task = { ...input, lastRunAt: null, createdAt: now, updatedAt: now };
    getDb()
      .prepare(
        'INSERT INTO tasks (id, type, name, cron, payload, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        task.id,
        task.type,
        task.name,
        task.cron,
        JSON.stringify(task.payload),
        task.enabled ? 1 : 0,
        task.createdAt,
        task.updatedAt,
      );
    return task;
  },

  get(id: string): Task | undefined {
    const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? toTask(row) : undefined;
  },

  list(): Task[] {
    const rows = getDb()
      .prepare('SELECT * FROM tasks ORDER BY created_at DESC')
      .all() as unknown as TaskRow[];
    return rows.map(toTask);
  },

  update(id: string, patch: TaskUpdate): void {
    const sets: string[] = ['updated_at = ?'];
    const args: (string | number)[] = [Date.now()];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      args.push(patch.name);
    }
    if (patch.cron !== undefined) {
      sets.push('cron = ?');
      args.push(patch.cron);
    }
    if (patch.payload !== undefined) {
      sets.push('payload = ?');
      args.push(JSON.stringify(patch.payload));
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?');
      args.push(patch.enabled ? 1 : 0);
    }
    getDb()
      .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args, id);
  },

  setLastRun(id: string): void {
    getDb().prepare('UPDATE tasks SET last_run_at = ? WHERE id = ?').run(Date.now(), id);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  },
};
