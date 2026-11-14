import { createApp } from './app';
import { env } from './config';

/**
 * server 启动入口。
 *
 * desktop 模式：由 apps/desktop 的 server-manager 作为子进程拉起。
 * 开发模式：pnpm dev:server。
 *
 * TODO(路线图)：
 *   - scheduler/index.ts 注册 cron 任务（每日培训、提醒）
 *   - infra/chroma.ts 建立 Chroma 连接与健康检查
 *   - events/index.ts 启动事件桥（→ desktop 原生通知）
 */
const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`[@pa/server] listening on http://${env.HOST}:${env.PORT}`);
  console.log(`[@pa/server] chroma  → ${env.CHROMA_URL}`);
  console.log(`[@pa/server] dataDir → ${env.DATA_DIR}`);
});

// desktop 子进程模式下，父进程关闭 stdin 时常意味着要退出
process.stdin.on('end', () => {
  server.close(() => process.exit(0));
});
