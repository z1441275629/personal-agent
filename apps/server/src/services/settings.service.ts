import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CreateProviderRequestSchema,
  ProviderSettingSchema,
  type CreateProviderRequest,
  type ProviderSetting,
} from '@pa/shared';
import { env } from '../config';

/**
 * Provider 配置存储：DATA_DIR/settings.json。
 *
 * TODO(业务后续)：apiKey 目前明文存储。desktop 模式下应经 Electron safeStorage
 * 加密——需要 main↔utilityProcess IPC 桥（server 运行在 utilityProcess 中，
 * 无法直接访问主进程的 safeStorage）。
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

export const settingsService = {
  list(): ProviderSetting[] {
    return readFile();
  },

  get(id: string): ProviderSetting {
    const found = readFile().find((p) => p.id === id);
    if (!found) throw httpError(404, `provider 不存在: ${id}`);
    return found;
  },

  create(input: unknown): ProviderSetting {
    const parsed = CreateProviderRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const req = parsed.data as CreateProviderRequest;
    const now = Date.now();
    const setting: ProviderSetting = { ...req, id: randomUUID(), createdAt: now, updatedAt: now };
    const list = readFile();
    list.push(setting);
    writeFile(list);
    return setting;
  },

  update(id: string, input: unknown): ProviderSetting {
    const parsed = CreateProviderRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw httpError(400, `参数校验失败: ${parsed.error.message}`);
    }
    const list = readFile();
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) throw httpError(404, `provider 不存在: ${id}`);
    list[idx] = { ...list[idx]!, ...parsed.data, id, updatedAt: Date.now() };
    writeFile(list);
    return list[idx]!;
  },

  remove(id: string): void {
    const list = readFile();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) throw httpError(404, `provider 不存在: ${id}`);
    writeFile(next);
  },
};
