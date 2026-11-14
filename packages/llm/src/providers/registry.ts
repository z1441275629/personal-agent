import { PROVIDER_PRESETS, type ProviderPreset } from '@pa/shared';

/**
 * Provider 预置注册表。模板本体定义在 @pa/shared（前后端共用），
 * 这里提供解析与默认值填充。
 */
export function listPresets(): ProviderPreset[] {
  return PROVIDER_PRESETS;
}

export function resolvePreset(presetId: string): ProviderPreset {
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    throw new Error(`未知 provider 预置模板: ${presetId}`);
  }
  return preset;
}
