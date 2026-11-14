import { z } from 'zod';

/**
 * MCP 服务器配置（settings.json 的 mcpServers 段）。
 * 通过 stdio 启动子进程：command + args（如 npx -y @some/mcp-server）。
 * env 仅注入该服务器需要的环境变量（如 API key），随子进程环境下发。
 */
export const McpServerSettingSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  /** 可执行命令，如 npx / node / python / uvx */
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type McpServerSetting = z.infer<typeof McpServerSettingSchema>;

/** 连接状态（进程内实时，不持久化） */
export const McpConnectionStatusSchema = z.enum([
  'connecting',
  'connected',
  'error',
  'disabled',
]);
export type McpConnectionStatus = z.infer<typeof McpConnectionStatusSchema>;
