import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { jsonSchemaToZod, type PaToolEntry } from '@pa/tools';
import type { McpConnectionStatus, McpServerSetting } from '@pa/shared';
import { settingsService } from './settings.service';
import { approvalService } from './approval.service';
import { withApproval } from './agent-tools.service';

/**
 * MCP 外部工具接入：按 settings.json 的 mcpServers 配置以 stdio
 * 启动子进程，listTools 后桥接为 LangChain 工具（走既有 HITL 审批）。
 *
 * 生命周期：
 *   - 启动时 / 配置变更后 sync()：对账启停（enabled/删除的断开，新增的连接，
 *     command/args/env 变化的重连）
 *   - 工具按对话请求构建（闭包携带 conversationId，HITL 审批要用）
 *
 * 命名：MCP 原始工具名可能与内置工具或其他服务器冲突，
 * 统一改写为 mcp__{服务器名}__{工具名}（模型可见），内部保留原名调用。
 */

/** 连接握手超时 */
const CONNECT_TIMEOUT_MS = 20_000;

interface McpToolDef {
  serverId: string;
  serverName: string;
  /** MCP 服务器上的原始工具名（callTool 用） */
  originalName: string;
  /** 模型可见的改写名 mcp__{server}__{tool} */
  exposedName: string;
  description: string;
  schema: ReturnType<typeof jsonSchemaToZod>;
}

interface LiveConnection {
  client: Client;
  transport: StdioClientTransport;
  /** 配置签名：command/args/env 变化时需要重连 */
  signature: string;
  tools: McpToolDef[];
}

const live = new Map<string, LiveConnection>();
const statusMap = new Map<
  string,
  { status: 'connecting' | 'connected' | 'error'; toolCount: number; lastError: string | null }
>();

function signatureOf(s: McpServerSetting): string {
  const { command, args } = normalizeCommand(s.command, s.args);
  return JSON.stringify([command, args, s.env]);
}

/**
 * 命令字段容错：用户常把整条命令行（"node E:/xx/server.ts"）填进 command。
 * 规则：command 含空白且整串不是已存在的文件路径时，按空白拆分
 * （双引号包裹的段视为一个 token），拆出的尾部并入 args。
 * 整串是存在的路径（如 "C:\Program Files\tool\run.exe"）则原样保留。
 */
export function normalizeCommand(
  rawCommand: string,
  rawArgs: string[],
): { command: string; args: string[] } {
  const command = rawCommand.trim();
  if (!command.includes(' ') && !command.includes('\t')) return { command, args: rawArgs };
  if (existsSync(command)) return { command, args: rawArgs };
  // 按空白拆分，双引号内的空白不拆
  const tokens: string[] = [];
  for (const part of command.match(/"[^"]*"|\S+/g) ?? []) {
    tokens.push(part.startsWith('"') && part.endsWith('"') && part.length >= 2 ? part.slice(1, -1) : part);
  }
  if (tokens.length < 2) return { command, args: rawArgs };
  return { command: tokens[0]!, args: [...tokens.slice(1), ...rawArgs] };
}

/** OpenAI function-name 兼容：字母数字下划线连字符，≤64 字符 */
function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.length > 64 ? cleaned.slice(0, 56) + '_' + hashSuffix(cleaned) : cleaned;
}

function hashSuffix(raw: string): string {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = ((h * 31) + raw.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 7);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 从 callTool 结果中提取文本（text 块拼接，其余 JSON 化） */
function extractResultText(result: unknown): string {
  const content = (result as { content?: unknown[] })?.content;
  if (!Array.isArray(content)) return JSON.stringify(result).slice(0, 400);
  const parts = content.map((block) => {
    const b = block as { type?: string; text?: string };
    if (b.type === 'text' && typeof b.text === 'string') return b.text;
    return JSON.stringify(block);
  });
  return parts.join('\n').slice(0, 2_000) || '（MCP 工具没有返回内容）';
}

/** 建立单个服务器连接（spawn + initialize + listTools） */
async function connect(server: McpServerSetting): Promise<void> {
  statusMap.set(server.id, { status: 'connecting', toolCount: 0, lastError: null });
  const { command, args } = normalizeCommand(server.command, server.args);
  // 继承当前进程环境再覆盖用户配置（npx/node/python 需要 PATH 等）；
  // Windows 下裸命令（npx 等）是 .cmd，必须 shell 才能拉起
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) childEnv[k] = v;
  }
  Object.assign(childEnv, server.env);
  const transport = new StdioClientTransport({
    command,
    args,
    env: childEnv,
    stderr: 'pipe', // 子进程 stderr 收集进 lastError（"Connection closed" 才有线索）
    ...(process.platform === 'win32' ? { spawn: { shell: true } } : {}),
  });
  // stderr 头部缓冲（PassThrough 在 start 前就可挂监听，早期报错不丢）。
  // 失败诊断看开头几行（如 "Cannot find module ..."），保留前 2KB。
  let stderrHead = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    const text = String(chunk);
    console.error(`[mcp:${server.name}] ${text.trimEnd()}`);
    if (stderrHead.length < 2_000) stderrHead = (stderrHead + text).slice(0, 2_000);
  });
  const client = new Client({ name: 'personal-agent', version: '0.1.0' });
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `连接 MCP 服务器 ${server.name}`);
    const res = await withTimeout(
      client.listTools(),
      CONNECT_TIMEOUT_MS,
      `获取 ${server.name} 工具列表`,
    );
    const tools: McpToolDef[] = (res.tools ?? []).map((t) => {
      const originalName = t.name ?? 'tool';
      return {
        serverId: server.id,
        serverName: server.name,
        originalName,
        exposedName: `mcp__${sanitizeName(server.name)}__${sanitizeName(originalName)}`,
        description: t.description ?? `MCP 工具 ${originalName}（来自 ${server.name}）`,
        schema: jsonSchemaToZod(t.inputSchema),
      };
    });
    live.set(server.id, {
      client,
      transport,
      signature: signatureOf(server),
      tools,
    });
    statusMap.set(server.id, { status: 'connected', toolCount: tools.length, lastError: null });
    console.log(`[mcp] 已连接 ${server.name} → ${tools.length} 个工具`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = stderrHead.trim()
      ? `${message} | 子进程输出: ${stderrHead.trim().slice(0, 500)}`
      : message;
    // 失败也要收掉子进程（close 内部会 kill transport）
    await client.close().catch(() => undefined);
    statusMap.set(server.id, { status: 'error', toolCount: 0, lastError: detail });
    console.warn(`[mcp] 连接 ${server.name} 失败: ${detail}`);
  }
}

async function disconnect(serverId: string): Promise<void> {
  const conn = live.get(serverId);
  if (!conn) return;
  live.delete(serverId);
  await conn.client.close().catch(() => undefined); // close 会终止子进程
  console.log(`[mcp] 已断开 ${serverId}`);
}

export const mcpService = {
  /** 全量对账：断开已删除/禁用的，连接新增的，重连配置变化的 */
  async sync(): Promise<void> {
    const servers = settingsService.listMcp();
    const byId = new Map(servers.map((s) => [s.id, s]));

    // 1) 清理：已删除或禁用的连接
    for (const id of [...live.keys()]) {
      const s = byId.get(id);
      if (!s || !s.enabled) {
        await disconnect(id);
        if (!s) statusMap.delete(id);
      }
    }

    // 2) 连接/重连
    await Promise.all(
      servers
        .filter((s) => s.enabled)
        .map(async (s) => {
          const conn = live.get(s.id);
          if (conn && conn.signature === signatureOf(s)) return; // 无变化
          if (conn) await disconnect(s.id);
          await connect(s);
        }),
    );
    // 禁用态不入 statusMap：publicList 以 enabled=false 推导展示
  },

  /** 单服务器重连（配置变更后调用，等待完成以返回真实状态） */
  async syncServer(id: string): Promise<void> {
    const s = settingsService.listMcp().find((v) => v.id === id);
    await disconnect(id);
    if (s && s.enabled) await connect(s);
    // 禁用/已删除：断开即可，状态由 publicList 推导
  },

  /** 退出时收尾：断开全部子进程 */
  async closeAll(): Promise<void> {
    for (const id of [...live.keys()]) await disconnect(id);
  },

  /** 配置 + 实时状态（设置页列表用） */
  publicList(): Array<
    McpServerSetting & { status: McpConnectionStatus; toolCount: number; lastError: string | null }
  > {
    return settingsService.listMcp().map((s) => {
      const st = statusMap.get(s.id);
      return {
        ...s,
        status: (!s.enabled ? 'disabled' : (st?.status ?? 'connecting')) as McpConnectionStatus,
        toolCount: st?.toolCount ?? 0,
        lastError: st?.lastError ?? null,
      };
    });
  },

  /**
   * 按对话构建工具条目（confirm 级 HITL：外部工具一律先经用户批准）。
   * 定义来自连接时缓存的 listTools 结果；调用时实时走对应 client。
   */
  listToolEntries(conversationId: string): PaToolEntry[] {
    const entries: PaToolEntry[] = [];
    for (const conn of live.values()) {
      for (const def of conn.tools) {
        const callOriginal = async (args: Record<string, unknown>): Promise<string> => {
          const result = await conn.client.callTool({
            name: def.originalName,
            arguments: args,
          });
          const text = extractResultText(result);
          if ((result as { isError?: boolean })?.isError) {
            throw new Error(`MCP 工具执行失败: ${text}`);
          }
          return text;
        };
        const wrapped: StructuredToolInterface = tool(
          withApproval(conversationId, def.exposedName, callOriginal),
          {
            name: def.exposedName,
            description: `[MCP:${def.serverName}] ${def.description}`.slice(0, 1_000),
            schema: def.schema,
          },
        );
        entries.push({ tool: wrapped, hitl: 'confirm', source: 'mcp' });
      }
    }
    return entries;
  },
};
