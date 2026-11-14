import { app, safeStorage, utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import http from 'node:http';
import { existsSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 20_000;
const RESTART_DELAY_MS = 2_000;

/**
 * server-manager：以 Electron utilityProcess 拉起打包好的 @pa/server（dist/server.cjs），
 * 健康检查确认就绪，崩溃后退避重启。app 退出时统一 kill。
 */
export class ServerManager {
  private child: UtilityProcess | null = null;
  private stopped = false;
  private restartTimer: NodeJS.Timeout | null = null;

  private get serverBundlePath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'server.cjs')
      : path.join(app.getAppPath(), '..', 'server', 'dist', 'server.cjs');
  }

  private get webDistDir(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'web-dist')
      : path.join(app.getAppPath(), '..', 'web', 'dist');
  }

  get url(): string {
    return `http://${HOST}:${PORT}`;
  }

  async start(): Promise<void> {
    const bundle = this.serverBundlePath;
    if (!existsSync(bundle)) {
      throw new Error(`server bundle 不存在：${bundle}（先执行 pnpm --filter @pa/server bundle）`);
    }
    this.fork();
    await this.waitForHealth();
  }

  private fork(): void {
    this.child = utilityProcess.fork(this.serverBundlePath, [], {
      serviceName: 'pa-server',
      stdio: 'pipe',
      env: {
        ...process.env,
        HOST,
        PORT: String(PORT),
        DATA_DIR: app.getPath('userData'),
        WEB_DIST_DIR: this.webDistDir,
      },
    });

    this.child.stdout?.on('data', (d: Buffer) => console.log(`[pa-server] ${String(d).trimEnd()}`));
    this.child.stderr?.on('data', (d: Buffer) => console.error(`[pa-server] ${String(d).trimEnd()}`));

    // safeStorage RPC：server（utilityProcess）经 parentPort 请求加解密敏感字段
    // （provider/LangSmith apiKey，Windows 底层 DPAPI，用户+机器绑定）。
    // 协议与 server 端 secure-store 对齐：请求 { __paRpc, id, op, data } → 响应 { __paRpc, id, ok, result|error }
    this.child.on('message', (message: unknown) => {
      void this.handleSecureStoreRpc(message);
    });

    this.child.on('exit', (code) => {
      this.child = null;
      if (!this.stopped) {
        console.error(`[pa-server] exited with code ${code}, restarting in ${RESTART_DELAY_MS}ms`);
        this.restartTimer = setTimeout(() => this.fork(), RESTART_DELAY_MS);
      }
    });
  }

  private async handleSecureStoreRpc(message: unknown): Promise<void> {
    const msg = message as { __paRpc?: boolean; id?: number; op?: string; data?: string };
    if (!msg?.__paRpc || typeof msg.id !== 'number') return;
    const reply = (payload: Record<string, unknown>): void => {
      this.child?.postMessage({ __paRpc: true, id: msg.id, ...payload });
    };
    try {
      if (msg.op === 'encrypt') {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error('safeStorage 不可用（系统加密未就绪）');
        }
        const cipher = safeStorage.encryptString(msg.data ?? '');
        reply({ ok: true, result: cipher.toString('base64') });
      } else if (msg.op === 'decrypt') {
        const plain = safeStorage.decryptString(Buffer.from(msg.data ?? '', 'base64'));
        reply({ ok: true, result: plain });
      } else {
        throw new Error(`未知 safeStorage op: ${msg.op}`);
      }
    } catch (err) {
      reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private waitForHealth(): Promise<void> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const poll = (): void => {
        if (this.stopped) {
          reject(new Error('server manager already stopped'));
          return;
        }
        const req = http.get(`${this.url}/api/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
          } else {
            retryOrReject();
          }
        });
        req.on('error', retryOrReject);
        function retryOrReject(): void {
          if (Date.now() - started > START_TIMEOUT_MS) {
            reject(new Error(`server 健康检查超时（${START_TIMEOUT_MS}ms）`));
          } else {
            setTimeout(poll, 300);
          }
        }
      };
      poll();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.child?.kill();
    this.child = null;
  }
}
