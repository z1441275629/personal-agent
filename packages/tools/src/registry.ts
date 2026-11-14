import type { PaToolEntry } from './base';

/**
 * 工具注册表：全局工具（内置 + 阶段二的 MCP）统一登记，
 * agent 执行时按需取用。进程内单例。
 */
const entries = new Map<string, PaToolEntry>();

export const toolRegistry = {
  register(entry: PaToolEntry): void {
    entries.set(entry.tool.name, entry);
  },

  /** 按名称替换（MCP 重连后更新工具定义用） */
  upsertMany(list: PaToolEntry[]): void {
    for (const entry of list) entries.set(entry.tool.name, entry);
  },

  get(name: string): PaToolEntry | undefined {
    return entries.get(name);
  },

  list(): PaToolEntry[] {
    return [...entries.values()];
  },

  remove(name: string): void {
    entries.delete(name);
  },

  clear(): void {
    entries.clear();
  },
};
