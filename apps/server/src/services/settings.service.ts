import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ProviderSettingSchema,
  UpsertProviderRequestSchema,
  CreateMcpServerRequestSchema,
  UpdateMcpServerRequestSchema,
  McpServerSettingSchema,
  LangsmithSettingSchema,
  UpsertLangsmithRequestSchema,
  LANGSMITH_ENDPOINT_DEFAULT,
  type ProviderPublic,
  type ProviderSetting,
  type UpsertProviderRequest,
  type McpServerSetting,
  type LangsmithSetting,
  type LangsmithPublic,
} from '@pa/shared';
import { env } from '../config';
import { applyLangsmithEnv } from '../infra/tracing';
import { secureStore } from './secure-store';

/**
 * 配置存储：DATA_DIR/settings.json。
 *
 * 文件结构：{ providers: [...], mcpServers: [...], langsmith: {...} }（各段可缺省）。
 *
 * 安全约定：
 *   - apiKey 桌面模式经 Electron safeStorage 加密存储（safe:v1: 前缀，见 secure-store）；
 *     开发模式无 parentPort 时保持明文。启动时 init() 自动把旧明文迁移为密文。
 *   - 对外（HTTP 响应）只给 ProviderPublic（apiKeyMasked），真实 apiKey 永不下发前端
 *   - 更新时 apiKey 留空/缺省 = 保持原值（前端编辑表单不回填 key）
 *   - provider 方法均为 async（加解密可能走 parentPort RPC）
 */
const FILE_NAME = 'settings.json';

function settingsFile(): string {
  return path.resolve(env.DATA_DIR, FILE_NAME);
}

/** 整份配置文件（各段容错：解析失败/缺失时回退为空） */
function readAll(): {
  providers: ProviderSetting[];
  mcpServers: McpServerSetting[];
  langsmith?: LangsmithSetting;
} {
  const file = settingsFile();
  if (!existsSync(file)) return { providers: [], mcpServers: [] };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as {
      providers?: unknown[];
      mcpServers?: unknown[];
      langsmith?: unknown;
    };
    return {
      providers: raw.providers?.map((p) => ProviderSettingSchema.parse(p)) ?? [],
      mcpServers: raw.mcpServers?.map((s) => McpServerSettingSchema.parse(s)) ?? [],
      langsmith: raw.langsmith ? LangsmithSettingSchema.parse(raw.langsmith) : undefined,
    };
  } catch (err) {
    console.error('[settings] settings.json 解析失败，忽略:', err);
    return { providers: [], mcpServers: [] };
  }
}

function writeAll(settings: {
  providers: ProviderSetting[];
  mcpServers: McpServerSetting[];
  langsmith?: LangsmithSetting;
}): void {
  mkdirSync(path.resolve(env.DATA_DIR), { recursive: true });
  writeFileSync(
    settingsFile(),
    JSON.stringify(
      {
        providers: settings.providers,
        mcpServers: settings.mcpServers,
        ...(settings.langsmith ? { langsmith: settings.langsmith } : {}),
      },
      null,
      2,
    ),
    'utf-8',
  );
}

/** 校验失败抛 400（errorHandler 读 .status） */
function httpError(status: number, message: string): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** sk-very-long-key-abcd → sk-***abcd（过短则全遮蔽） */
function maskApiKey(key: string): string {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

function toPublic(setting: ProviderSetting): ProviderPublic {
  const { apiKey, ...rest } = setting;
  return { ...rest, apiKeyMasked: maskApiKey(apiKey) };
}

/** 请求体 → 存储实体：apiKey 为空时沿用旧值（创建则必须非空） */
function resolveApiKey(input: UpsertProviderRequest, existing?: ProviderSetting): string {
  const incoming = input.apiKey?.trim();
  if (incoming) return incoming;
  if (existing) return existing.apiKey;
  throw httpError(400, '创建 provider 时必须填写 API Key');
}

/** 明文才加密；已加密（safe:v1:）原样返回 */
async function encryptIfNeeded(value: string): Promise<string> {
  return secureStore.isEncrypted(value) ? value : secureStore.encrypt(value);
}

export const settingsService = {
  /**
   * 启动初始化：把历史明文 apiKey 迁移为 safeStorage 密文（仅桌面模式生效）。
   * main.ts 在 listen 前调用。
   */
  async init(): Promise<void> {
    const settings = readAll();
    let changed = false;
    for (const p of settings.providers) {
      if (p.apiKey && !secureStore.isEncrypted(p.apiKey)) {
        const enc = await secureStore.encrypt(p.apiKey);
        if (enc !== p.apiKey) {
          p.apiKey = enc;
          changed = true;
        }
      }
    }
    if (settings.langsmith?.apiKey && !secureStore.isEncrypted(settings.langsmith.apiKey)) {
      const enc = await secureStore.encrypt(settings.langsmith.apiKey);
      if (enc !== settings.langsmith.apiKey) {
        settings.langsmith = { ...settings.langsmith, apiKey: enc };
        changed = true;
      }
    }
    if (changed) {
      writeAll(settings);
      console.log('[settings] 已将明文 apiKey 迁移为加密存储');
    }
  },

  /** 对外：provider 列表（脱敏） */
  async list(): Promise<ProviderPublic[]> {
    const out: ProviderPublic[] = [];
    for (const p of readAll().providers) {
      out.push(toPublic({ ...p, apiKey: await secureStore.decrypt(p.apiKey) }));
    }
    return out;
  },

  /** 对内：含真实 key 的完整列表（chat.service 选模型用） */
  async listFull(): Promise<ProviderSetting[]> {
    const out: ProviderSetting[] = [];
    for (const p of readAll().providers) {
      out.push({ ...p, apiKey: await secureStore.decrypt(p.apiKey) });
    }
    return out;
  },

  /** 对内：单条完整配置（测试连接用） */
  async getFull(id: string): Promise<ProviderSetting> {
    const found = readAll().providers.find((p) => p.id === id);
    if (!found) throw httpError(404, `provider 不存在: ${id}`);
    return { ...found, apiKey: await secureStore.decrypt(found.apiKey) };
  },

  async create(input: unknown): Promise<ProviderPublic> {
    const parsed = UpsertProviderRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const now = Date.now();
    const plainKey = resolveApiKey(parsed.data);
    const setting: ProviderSetting = {
      ...parsed.data,
      apiKey: await encryptIfNeeded(plainKey),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const settings = readAll();
    settings.providers.push(setting);
    writeAll(settings);
    return toPublic({ ...setting, apiKey: plainKey });
  },

  async update(id: string, input: unknown): Promise<ProviderPublic> {
    const parsed = UpsertProviderRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const settings = readAll();
    const idx = settings.providers.findIndex((p) => p.id === id);
    if (idx === -1) throw httpError(404, `provider 不存在: ${id}`);
    const existing = settings.providers[idx]!;
    const plainKey = resolveApiKey(parsed.data, existing);
    settings.providers[idx] = {
      ...existing,
      ...parsed.data,
      apiKey: await encryptIfNeeded(plainKey),
      id,
      updatedAt: Date.now(),
    };
    writeAll(settings);
    return toPublic({ ...settings.providers[idx]!, apiKey: plainKey });
  },

  remove(id: string): void {
    const settings = readAll();
    const next = settings.providers.filter((p) => p.id !== id);
    if (next.length === settings.providers.length) {
      throw httpError(404, `provider 不存在: ${id}`);
    }
    writeAll({ ...settings, providers: next });
  },

  // ---- MCP 服务器 ----

  listMcp(): McpServerSetting[] {
    return readAll().mcpServers;
  },

  createMcp(input: unknown): McpServerSetting {
    const parsed = CreateMcpServerRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const now = Date.now();
    const setting: McpServerSetting = {
      ...parsed.data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const settings = readAll();
    settings.mcpServers.push(setting);
    writeAll(settings);
    return setting;
  },

  updateMcp(id: string, input: unknown): McpServerSetting {
    const parsed = UpdateMcpServerRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const settings = readAll();
    const idx = settings.mcpServers.findIndex((s) => s.id === id);
    if (idx === -1) throw httpError(404, `MCP 服务器不存在: ${id}`);
    settings.mcpServers[idx] = {
      ...settings.mcpServers[idx]!,
      ...parsed.data,
      id,
      updatedAt: Date.now(),
    };
    writeAll(settings);
    return settings.mcpServers[idx]!;
  },

  removeMcp(id: string): void {
    const settings = readAll();
    const next = settings.mcpServers.filter((s) => s.id !== id);
    if (next.length === settings.mcpServers.length) {
      throw httpError(404, `MCP 服务器不存在: ${id}`);
    }
    writeAll({ ...settings, mcpServers: next });
  },

  // ---- LangSmith 追踪 ----

  /** 对外（API）：脱敏视图 */
  async getLangsmithPublic(): Promise<LangsmithPublic> {
    const s = readAll().langsmith;
    const key = s ? await secureStore.decrypt(s.apiKey) : '';
    return {
      tracing: s?.tracing ?? false,
      endpoint: s?.endpoint ?? LANGSMITH_ENDPOINT_DEFAULT,
      project: s?.project ?? '',
      apiKeyMasked: key ? maskApiKey(key) : '',
      storage: secureStore.encrypted ? 'encrypted' : 'plaintext',
    };
  },

  /** 保存 + 立即生效（写 LANGSMITH_* 环境变量，无需重启）。apiKey 留空 = 保持原值 */
  async saveLangsmith(input: unknown): Promise<LangsmithPublic> {
    const parsed = UpsertLangsmithRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const settings = readAll();
    const incomingKey = parsed.data.apiKey?.trim();
    const storedKey = incomingKey
      ? await encryptIfNeeded(incomingKey)
      : (settings.langsmith?.apiKey ?? '');
    const section: LangsmithSetting = {
      tracing: parsed.data.tracing,
      endpoint: parsed.data.endpoint,
      project: parsed.data.project,
      apiKey: storedKey,
    };
    writeAll({ ...settings, langsmith: section });
    applyLangsmithEnv({ ...section, apiKey: await secureStore.decrypt(storedKey) });
    return this.getLangsmithPublic();
  },

  /** 启动时把 settings.json 的 langsmith 段映射为环境变量（main.ts 在 listen 前调用） */
  async applyLangsmith(): Promise<void> {
    const s = readAll().langsmith;
    if (!s) return; // 未在设置页配置 → 维持 .env/环境变量行为
    applyLangsmithEnv({ ...s, apiKey: await secureStore.decrypt(s.apiKey) });
  },
};
