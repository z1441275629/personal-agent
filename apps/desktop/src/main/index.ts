import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { ServerManager } from './server-manager';

/**
 * Electron 主进程入口。
 *
 * 开发模式（electron-vite dev）：直接加载 Vite dev server（5173），
 *   server/web 由 `pnpm dev` 手动启动，职责清晰。
 * 生产模式：server-manager 以 utilityProcess 拉起打包好的 server，
 *   窗口加载 http://127.0.0.1:8787（server 同时托管 web 静态资源）。
 *
 * TODO(路线图)：
 *   - chroma-manager.ts   Chroma sidecar 进程管理（RAG 阶段）
 *   - tray.ts             托盘常驻（关闭窗口不退出）
 *   - auto-launch.ts      开机自启
 *   - notifications.ts    原生通知（接收 server events 桥的事件）
 */
const manager = new ServerManager();

function createWindow(targetUrl: string): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadURL(targetUrl);
}

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    createWindow(process.env.PA_DEV_URL ?? 'http://localhost:5173');
    return;
  }

  try {
    await manager.start();
    createWindow(manager.url);
  } catch (err) {
    console.error('[desktop] server 启动失败:', err);
    dialog.showErrorBox(
      'Personal Agent 启动失败',
      `后端服务未能启动：\n${err instanceof Error ? err.message : String(err)}`,
    );
    app.quit();
  }
}

app.whenReady().then(() => {
  void bootstrap();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(process.env.NODE_ENV === 'development'
        ? (process.env.PA_DEV_URL ?? 'http://localhost:5173')
        : manager.url);
    }
  });
});

app.on('before-quit', () => manager.stop());

app.on('window-all-closed', () => {
  // 个人助理应常驻：托盘实现之前暂随窗口退出，tray.ts 完成后改为隐藏
  if (process.platform !== 'darwin') app.quit();
});
