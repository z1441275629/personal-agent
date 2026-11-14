// LangSmith 追踪必须最先加载（在所有 LangChain 模块运行前就位）
import './infra/tracing';
import { createApp } from './app';
import { chatService } from './services/chat.service';
import { settingsService } from './services/settings.service';
import { mcpService } from './services/mcp.service';
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
// 密钥迁移 + LangSmith 设置生效（须在 listen 前；桌面模式经 safeStorage 加密）
void (async () => {
  await settingsService.init();
  await settingsService.applyLangsmith();
})();
taskScheduler.start(); // 注册定时任务（提醒 / 每日培训）
// MCP 服务器异步连接（不阻塞监听；失败仅记录状态，设置页可见）
void mcpService.sync().catch((err) =>
  console.warn('[mcp] 启动同步失败:', err instanceof Error ? err.message : err),
);

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`[@pa/server] listening on http://${env.HOST}:${env.PORT}`);
  console.log(`[@pa/server] chroma  → ${env.CHROMA_URL}`);
  console.log(`[@pa/server] dataDir → ${env.DATA_DIR}`);
});

// 优雅退出：desktop 关闭或容器 stop 时收尾
function shutdown(): void {
  taskScheduler.stop();
  void mcpService.closeAll(); // 断开 MCP 子进程
  server.close(() => process.exit(0));
  // 兜底：3 秒后强制退出
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
