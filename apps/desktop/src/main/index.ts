import { app, BrowserWindow } from 'electron';
import path from 'node:path';

/**
 * Electron 主进程入口。
 *
 * TODO(路线图，见同目录占位文件)：
 *   - server-manager.ts   拉起并守护 @pa/server 子进程（健康检查 /api/health）
 *   - chroma-manager.ts   Chroma sidecar 进程管理
 *   - tray.ts             托盘常驻（关闭窗口不退出）
 *   - auto-launch.ts      开机自启
 *   - notifications.ts    原生通知（接收 server events 桥的事件）
 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发模式（electron-vite dev）默认加载 Vite dev server；
  // 生产模式加载本地 server（server 托管前端静态文件，业务阶段实现）
  const devUrl = process.env.PA_DEV_URL ?? 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development') {
    void win.loadURL(devUrl);
  } else {
    void win.loadURL('http://127.0.0.1:8787');
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 个人助理应常驻：托盘实现之前暂随窗口退出，tray.ts 完成后改为隐藏
  if (process.platform !== 'darwin') app.quit();
});
