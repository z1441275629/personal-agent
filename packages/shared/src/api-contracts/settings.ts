import { z } from 'zod';
import { ProviderSettingSchema, ProviderPresetSchema } from '../domain/provider';
import {
  McpServerSettingSchema,
  McpConnectionStatusSchema,
} from '../domain/mcp';
import { LangsmithSettingSchema, LANGSMITH_ENDPOINT_DEFAULT } from '../domain/langsmith';

/** GET /api/settings/presets */
export const ListPresetsResponseSchema = z.object({
  presets: z.array(ProviderPresetSchema),
});
export type ListPresetsResponse = z.infer<typeof ListPresetsResponseSchema>;

/**
 * 对外暴露的 provider —— 不含 apiKey（真实 key 永不下发前端），
 * apiKeyMasked 仅用于展示（如 sk-***abcd）。
 */
export const ProviderPublicSchema = ProviderSettingSchema.omit({ apiKey: true }).extend({
  apiKeyMasked: z.string(),
});
export type ProviderPublic = z.infer<typeof ProviderPublicSchema>;

/** GET /api/settings/providers */
export const ListProvidersResponseSchema = z.object({
  providers: z.array(ProviderPublicSchema),
});
export type ListProvidersResponse = z.infer<typeof ListProvidersResponseSchema>;

/**
 * POST /api/settings/providers（创建）与 PUT /api/settings/providers/:id（更新）。
 * apiKey：创建时必填（服务端校验）；更新时留空/缺省 = 保持原值。
 */
export const UpsertProviderRequestSchema = ProviderSettingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  apiKey: true,
}).extend({ apiKey: z.string().optional() });
export type UpsertProviderRequest = z.infer<typeof UpsertProviderRequestSchema>;

/** POST /api/settings/providers/:id/test —— 用当前配置真实调用一次模型 */
export const TestConnectionResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type TestConnectionResponse = z.infer<typeof TestConnectionResponseSchema>;

// ---- MCP 服务器（stdio 外部工具）----

/** 对外暴露的 MCP 服务器（配置 + 实时连接状态） */
export const McpServerPublicSchema = McpServerSettingSchema.extend({
  status: McpConnectionStatusSchema,
  /** 已连接并注册的工具数量 */
  toolCount: z.number().int(),
  lastError: z.string().nullable(),
});
export type McpServerPublic = z.infer<typeof McpServerPublicSchema>;

/** GET /api/settings/mcp */
export const ListMcpServersResponseSchema = z.object({
  servers: z.array(McpServerPublicSchema),
});
export type ListMcpServersResponse = z.infer<typeof ListMcpServersResponseSchema>;

/** POST /api/settings/mcp（创建） */
export const CreateMcpServerRequestSchema = McpServerSettingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateMcpServerRequest = z.infer<typeof CreateMcpServerRequestSchema>;

/** PUT /api/settings/mcp/:id（更新，字段可选） */
export const UpdateMcpServerRequestSchema = CreateMcpServerRequestSchema.partial();
export type UpdateMcpServerRequest = z.infer<typeof UpdateMcpServerRequestSchema>;

// ---- LangSmith 追踪 ----

/** GET /api/settings/langsmith —— apiKey 只给掩码 */
export const LangsmithPublicSchema = z.object({
  tracing: z.boolean(),
  endpoint: z.string(),
  project: z.string(),
  apiKeyMasked: z.string(),
  /** 存储形态：encrypted=safeStorage 密文（桌面模式）/ plaintext=明文（开发模式） */
  storage: z.enum(['encrypted', 'plaintext']),
});
export type LangsmithPublic = z.infer<typeof LangsmithPublicSchema>;

/** PUT /api/settings/langsmith —— apiKey 留空/缺省 = 保持原值 */
export const UpsertLangsmithRequestSchema = z.object({
  tracing: z.boolean(),
  endpoint: z.string().url().default(LANGSMITH_ENDPOINT_DEFAULT),
  project: z.string().max(100).default(''),
  apiKey: z.string().optional(),
});
export type UpsertLangsmithRequest = z.infer<typeof UpsertLangsmithRequestSchema>;
