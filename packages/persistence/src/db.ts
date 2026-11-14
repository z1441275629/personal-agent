import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * SQLite 数据库（Node 内置 node:sqlite，无原生依赖 ——
 * esbuild 单文件打包与 Electron utilityProcess 均可直接使用）。
 * 模块级单例，由宿主（apps/server main.ts）启动时 initDb。
 */
let db: DatabaseSync | null = null;

export function initDb(dataDir: string): DatabaseSync {
  if (db) return db;
  mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(path.join(dataDir, 'personal-agent.db'));
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
  `);
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('persistence 未初始化：请先在启动入口调用 initDb(dataDir)');
  return db;
}

/** 测试用：重置单例 */
export function resetDb(): void {
  db = null;
}
