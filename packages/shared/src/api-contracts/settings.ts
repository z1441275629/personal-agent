import { z } from 'zod';
import { ProviderSettingSchema, ProviderPresetSchema } from '../domain/provider';

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
