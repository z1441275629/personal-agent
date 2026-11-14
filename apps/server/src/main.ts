// LangSmith 追踪必须最先加载（在所有 LangChain 模块运行前就位）
import './infra/tracing';
import { createApp } from './app';
import { chatService } from './services/chat.service';
import { taskScheduler } from './scheduler';
import { env } from './config';

/**
 * server 启动入口。
 *
 * 运行形态：
 *   - 开发：pnpm dev:server（tsx）
 *   - 生产：由 apps/desktop 的 server-manager 以 utilityProcess 拉起 dist/server.cjs
 *
 * TODO(路线图）：
 *   - infra/chroma.ts 建立 Chroma 连接与健康检查
 */
chatService.init(); // 初始化 SQLite（DATA_DIR/personal-agent.db）
taskScheduler.start(); // 注册定时任务（提醒 / 每日培训）

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`[@pa/server] listening on http://${env.HOST}:${env.PORT}`);
  console.log(`[@pa/server] chroma  → ${env.CHROMA_URL}`);
  console.log(`[@pa/server] dataDir → ${env.DATA_DIR}`);
});

// 优雅退出：desktop 关闭或容器 stop 时收尾
function shutdown(): void {
  taskScheduler.stop();
  server.close(() => process.exit(0));
  // 兜底：3 秒后强制退出
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
