import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ProviderSettingSchema,
  UpsertProviderRequestSchema,
  type ProviderPublic,
  type ProviderSetting,
  type UpsertProviderRequest,
} from '@pa/shared';
import { env } from '../config';

/**
 * Provider 配置存储：DATA_DIR/settings.json。
 *
 * 安全约定：
 *   - 对外（HTTP 响应）只给 ProviderPublic（apiKeyMasked），真实 apiKey 永不下发前端
 *   - 更新时 apiKey 留空/缺省 = 保持原值（前端编辑表单不回填 key）
 *
 * TODO(业务后续)：apiKey 目前明文存储。desktop 模式下应经 Electron safeStorage
 * 加密——需要 main↔utilityProcess IPC 桥。
 */
const FILE_NAME = 'settings.json';

function settingsFile(): string {
  return path.resolve(env.DATA_DIR, FILE_NAME);
}

function readFile(): ProviderSetting[] {
  const file = settingsFile();
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { providers?: unknown[] };
    return raw.providers?.map((p) => ProviderSettingSchema.parse(p)) ?? [];
  } catch (err) {
    console.error('[settings] settings.json 解析失败，忽略:', err);
    return [];
  }
}

function writeFile(providers: ProviderSetting[]): void {
  mkdirSync(path.resolve(env.DATA_DIR), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify({ providers }, null, 2), 'utf-8');
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

export const settingsService = {
  /** 对外：列表（脱敏） */
  list(): ProviderPublic[] {
    return readFile().map(toPublic);
  },

  /** 对内：含真实 key 的完整列表（chat.service 选模型用） */
  listFull(): ProviderSetting[] {
    return readFile();
  },

  /** 对内：单条完整配置（测试连接用） */
  getFull(id: string): ProviderSetting {
    const found = readFile().find((p) => p.id === id);
    if (!found) throw httpError(404, `provider 不存在: ${id}`);
    return found;
  },

  create(input: unknown): ProviderPublic {
    const parsed = UpsertProviderRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const now = Date.now();
    const setting: ProviderSetting = {
      ...parsed.data,
      apiKey: resolveApiKey(parsed.data),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const list = readFile();
    list.push(setting);
    writeFile(list);
    return toPublic(setting);
  },

  update(id: string, input: unknown): ProviderPublic {
    const parsed = UpsertProviderRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const list = readFile();
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) throw httpError(404, `provider 不存在: ${id}`);
    const existing = list[idx]!;
    list[idx] = {
      ...existing,
      ...parsed.data,
      apiKey: resolveApiKey(parsed.data, existing),
      id,
      updatedAt: Date.now(),
    };
    writeFile(list);
    return toPublic(list[idx]!);
  },

  remove(id: string): void {
    const list = readFile();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) throw httpError(404, `provider 不存在: ${id}`);
    writeFile(next);
  },
};
