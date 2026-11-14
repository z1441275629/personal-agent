import { contextBridge } from 'electron';

/**
 * preload：以最小面积向 renderer 暴露能力。
 * 后续在此追加：通知触发、设置读写（safeStorage 加密）等 IPC 桥。
 */
contextBridge.exposeInMainWorld('pa', {
  versions: process.versions,
  platform: process.platform,
});
