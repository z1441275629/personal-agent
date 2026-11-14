import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CreateProviderRequest, ProviderPreset, ProviderSetting } from '@pa/shared';
import * as api from '../api/settings';

export const useSettingsStore = defineStore('settings', () => {
  const presets = ref<ProviderPreset[]>([]);
  const providers = ref<ProviderSetting[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const [presetRes, providerRes] = await Promise.all([
        api.fetchPresets(),
        api.fetchProviders(),
      ]);
      presets.value = presetRes.presets;
      providers.value = providerRes.providers;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function save(input: CreateProviderRequest, id?: string): Promise<ProviderSetting> {
    const saved = id ? await api.updateProvider(id, input) : await api.createProvider(input);
    await load();
    return saved;
  }

  async function remove(id: string): Promise<void> {
    await api.deleteProvider(id);
    await load();
  }

  async function test(id: string) {
    return api.testProvider(id);
  }

  return { presets, providers, loading, error, load, save, remove, test };
});
