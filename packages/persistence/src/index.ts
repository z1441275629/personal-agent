// @pa/persistence — 持久化：SQLite（node:sqlite）+ 仓储
// 依赖方向：只允许向下引用（见 docs/architecture.md）
// 实体类型统一来自 @pa/shared（单一事实来源），本包只负责存储映射
export { initDb, getDb, resetDb } from './db';
export { conversationsRepo } from './repositories/conversations';
export { messagesRepo } from './repositories/messages';
