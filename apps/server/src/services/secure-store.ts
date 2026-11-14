/**
 * 敏感字段加密存储（provider apiKey / LangSmith key）。
 *
 * 桌面模式：server 以 utilityProcess 运行，经 process.parentPort 向
 * Electron main 发 RPC，由 main 的 safeStorage（Windows=DPAPI，用户+机器绑定）
 * 加解密。存储格式带前缀，自描述：
 *   safe:v1:<base64>  = safeStorage 密文
 *   其他              = 明文（dev 模式写入 / 旧数据，启动时自动迁移）
 *
 * 开发模式（tsx 独立跑，无 parentPort）：透传明文，不加密。
 */

const PREFIX = 'safe:v1:';

/** parentPort 的最小接口（便于测试注入假端口）；message 事件带 { data } 包装 */
interface PortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data?: unknown }) => void): void;
}

/** utilityProcess 子进程才有的父进程端口 */
function getParentPort(): PortLike | null {
  const port = (process as { parentPort?: PortLike }).parentPort;
  return port && typeof port.postMessage === 'function' ? port : null;
}

let pendingSeq = 0;
const pendingRpc = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();

/** 挂一次监听；幂等 */
let wired = false;
function wirePort(port: PortLike): void {
  if (wired) return;
  wired = true;
  port.on('message', (event) => {
    // Electron MessagePortMain 的 message 事件带 { data } 包装（与主进程侧
    // utilityProcess.on('message') 直接给 payload 不对称，注意区分）
    const msg = (event as { data?: unknown }).data as
      | { __paRpc?: boolean; id?: number; ok?: boolean; result?: string; error?: string }
      | undefined;
    if (!msg?.__paRpc || typeof msg.id !== 'number') return;
    const entry = pendingRpc.get(msg.id);
    if (!entry) return;
    pendingRpc.delete(msg.id);
    if (msg.ok && typeof msg.result === 'string') entry.resolve(msg.result);
    else entry.reject(new Error(msg.error ?? 'safeStorage RPC 失败'));
  });
}

/** 与 Electron main（server-manager）之间的 RPC 约定：
 *  请求 { __paRpc, id, op: 'encrypt'|'decrypt', data }
 *  响应 { __paRpc, id, ok, result | error }
 *  data：encrypt 传明文 UTF-8；decrypt 传密文 base64；result 同理。
 */
function rpc(port: PortLike, op: 'encrypt' | 'decrypt', data: string, timeoutMs = 5_000): Promise<string> {
  wirePort(port);
  const id = ++pendingSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error(`safeStorage ${op} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    pendingRpc.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    port.postMessage({ __paRpc: true, id, op, data });
  });
}

export const secureStore = {
  /** 桌面模式（parentPort 存在）才为 true：设置页可据此提示存储形态 */
  get encrypted(): boolean {
    return getParentPort() !== null;
  },

  isEncrypted(stored: string): boolean {
    return stored.startsWith(PREFIX);
  },

  /** 加密为存储格式；不可用（dev / safeStorage 不可用）时回退明文并告警一次 */
  async encrypt(plain: string): Promise<string> {
    if (!plain) return plain;
    const port = getParentPort();
    if (!port) {
      warnPlaintextOnce();
      return plain;
    }
    try {
      const b64 = await rpc(port, 'encrypt', plain);
      return PREFIX + b64;
    } catch (err) {
      console.warn('[secure-store] 加密失败，回退明文存储:', err instanceof Error ? err.message : err);
      return plain;
    }
  },

  /**
   * 解密存储值：带前缀 → RPC 解密（失败返回空串并告警，调用方按 key 失效处理）；
   * 无前缀 → 原样返回（明文/dev/旧数据）。
   */
  async decrypt(stored: string): Promise<string> {
    if (!stored || !this.isEncrypted(stored)) return stored;
    const port = getParentPort();
    if (!port) {
      console.warn('[secure-store] 密文 key 需要桌面版环境解密，当前进程无法读取');
      return '';
    }
    try {
      return await rpc(port, 'decrypt', stored.slice(PREFIX.length));
    } catch (err) {
      console.warn('[secure-store] 解密失败（换机器/用户后 DPAPI 密文不可用）:', err instanceof Error ? err.message : err);
      return '';
    }
  },
};

let plaintextWarned = false;
function warnPlaintextOnce(): void {
  if (plaintextWarned) return;
  plaintextWarned = true;
  console.warn('[secure-store] 开发模式（无 Electron）——apiKey 以明文存储');
}
