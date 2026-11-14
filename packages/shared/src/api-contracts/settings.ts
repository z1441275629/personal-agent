import { z } from 'zod';
import { ProviderSettingSchema, ProviderPresetSchema } from '../domain/provider';

/** GET /api/settings/presets */
export const ListPresetsResponseSchema = z.object({
  presets: z.array(ProviderPresetSchema),
});
export type ListPresetsResponse = z.infer<typeof ListPresetsResponseSchema>;

/** GET /api/settings/providers */
export const ListProvidersResponseSchema = z.object({
  providers: z.array(ProviderSettingSchema),
});
export type ListProvidersResponse = z.infer<typeof ListProvidersResponseSchema>;

/** POST /api/settings/providers */
export const CreateProviderRequestSchema = ProviderSettingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateProviderRequest = z.infer<typeof CreateProviderRequestSchema>;

/** PUT /api/settings/providers/:id */
export type UpdateProviderRequest = CreateProviderRequest;

/** POST /api/settings/providers/:id/test —— 用当前配置真实调用一次模型 */
export const TestConnectionResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type TestConnectionResponse = z.infer<typeof TestConnectionResponseSchema>;
