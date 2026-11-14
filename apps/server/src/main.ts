import { createApp } from './app';
import { chatService } from './services/chat.service';
import { env } from './config';

/**
 * server 启动入口。
 *
 * 运行形态：
 *   - 开发：pnpm dev:server（tsx）
 *   - 生产：由 apps/desktop 的 server-manager 以 utilityProcess 拉起 dist/server.cjs
 *
 * TODO(路线图)：
 *   - scheduler/index.ts 注册 cron 任务（每日培训、提醒）
 *   - infra/chroma.ts 建立 Chroma 连接与健康检查
 *   - events/index.ts 启动事件桥（→ desktop 原生通知）
 */
chatService.init(); // 初始化 SQLite（DATA_DIR/personal-agent.db）

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`[@pa/server] listening on http://${env.HOST}:${env.PORT}`);
  console.log(`[@pa/server] chroma  → ${env.CHROMA_URL}`);
  console.log(`[@pa/server] dataDir → ${env.DATA_DIR}`);
});

// 优雅退出：desktop 关闭或容器 stop 时收尾
function shutdown(): void {
  server.close(() => process.exit(0));
  // 兜底：3 秒后强制退出
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
