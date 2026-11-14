<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type {
  CreateProviderRequest,
  ProviderProtocol,
  ProviderSetting,
  TestConnectionResponse,
} from '@pa/shared';
import { useSettingsStore } from '../stores/settings';

const store = useSettingsStore();
onMounted(() => void store.load());

// ---------- 列表 ----------
type TestState = 'loading' | TestConnectionResponse;
const testing = ref<Record<string, TestState>>({});

function presetLabel(p: ProviderSetting): string {
  return store.presets.find((x) => x.id === p.presetId)?.label ?? p.presetId;
}

/** 模板里对联合类型做 narrowing 不可靠，统一走这些取值函数 */
function isTesting(id: string): boolean {
  return testing.value[id] === 'loading';
}
function tested(id: string): boolean {
  const t = testing.value[id];
  return t !== undefined && t !== 'loading';
}
function testOk(id: string): boolean {
  const t = testing.value[id];
  return t !== undefined && t !== 'loading' && t.ok;
}
function testLatency(id: string): string {
  const t = testing.value[id];
  return t !== undefined && t !== 'loading' ? String(t.latencyMs ?? '-') : '';
}
function testError(id: string): string {
  const t = testing.value[id];
  return t !== undefined && t !== 'loading' ? (t.error ?? '') : '';
}

async function doTest(p: ProviderSetting): Promise<void> {
  testing.value = { ...testing.value, [p.id]: 'loading' };
  try {
    testing.value = { ...testing.value, [p.id]: await store.test(p.id) };
  } catch (e) {
    testing.value = {
      ...testing.value,
      [p.id]: { ok: false, latencyMs: null, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

async function doRemove(p: ProviderSetting): Promise<void> {
  if (!window.confirm(`删除 provider「${p.name}」？`)) return;
  if (editingId.value === p.id) closeForm();
  await store.remove(p.id);
}

// ---------- 表单 ----------
const showForm = ref(false);
const editingId = ref<string | null>(null);

const form = reactive({
  presetId: 'openai',
  name: '',
  protocol: 'openai-compatible' as ProviderProtocol,
  baseURL: '',
  apiKey: '',
  model: '',
  enabled: true,
});

const currentPreset = computed(() => store.presets.find((p) => p.id === form.presetId));

function onPresetChange(): void {
  const preset = currentPreset.value;
  if (preset) {
    form.protocol = preset.protocol;
    form.baseURL = preset.baseURL;
    form.model = preset.defaultModel;
  }
}

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, {
    presetId: 'openai',
    name: '',
    protocol: 'openai-compatible',
    baseURL: '',
    apiKey: '',
    model: '',
    enabled: true,
  });
  onPresetChange();
  showForm.value = true;
}

function openEdit(p: ProviderSetting): void {
  editingId.value = p.id;
  Object.assign(form, {
    presetId: p.presetId,
    name: p.name,
    protocol: p.protocol,
    baseURL: p.baseURL,
    apiKey: p.apiKey,
    model: p.model,
    enabled: p.enabled,
  });
  showForm.value = true;
}

function closeForm(): void {
  showForm.value = false;
  editingId.value = null;
}

const submitting = ref(false);
const formError = ref<string | null>(null);

async function submit(): Promise<void> {
  formError.value = null;
  if (!form.name.trim() || !form.baseURL || !form.apiKey || !form.model.trim()) {
    formError.value = '请完整填写：名称 / baseURL / API Key / 模型';
    return;
  }
  submitting.value = true;
  try {
    const body: CreateProviderRequest = { ...form, name: form.name.trim(), model: form.model.trim() };
    await store.save(body, editingId.value ?? undefined);
    closeForm();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="settings-page">
    <header class="page-header">
      <h1>模型服务配置</h1>
      <button class="btn primary" @click="openCreate">＋ 添加 Provider</button>
    </header>

    <p v-if="store.error" class="banner error">加载失败：{{ store.error }}</p>
    <p v-if="store.loading" class="banner">加载中…</p>

    <!-- 列表 -->
    <section v-if="store.providers.length" class="provider-list">
      <article v-for="p in store.providers" :key="p.id" class="provider-card" :class="{ disabled: !p.enabled }">
        <div class="provider-main">
          <div class="provider-title">
            <strong>{{ p.name }}</strong>
            <span class="tag">{{ presetLabel(p) }}</span>
            <span class="tag" :class="p.enabled ? 'ok' : 'muted'">{{ p.enabled ? '已启用' : '已停用' }}</span>
          </div>
          <div class="provider-meta">
            <code>{{ p.model }}</code>
            <span class="muted">{{ p.baseURL }}</span>
          </div>
          <p v-if="tested(p.id)" class="test-result" :class="{ ok: testOk(p.id) }">
            <template v-if="testOk(p.id)">✓ 连接成功（{{ testLatency(p.id) }}ms）</template>
            <template v-else>✗ {{ testError(p.id) }}</template>
          </p>
        </div>
        <div class="provider-actions">
          <button class="btn" :disabled="isTesting(p.id)" @click="doTest(p)">
            {{ isTesting(p.id) ? '测试中…' : '测试连接' }}
          </button>
          <button class="btn" @click="openEdit(p)">编辑</button>
          <button class="btn danger" @click="doRemove(p)">删除</button>
        </div>
      </article>
    </section>
    <p v-else-if="!store.loading" class="empty">
      还没有配置任何模型服务，点右上角「添加 Provider」开始。
    </p>

    <!-- 表单 -->
    <div v-if="showForm" class="modal-mask" @click.self="closeForm">
      <form class="modal" @submit.prevent="submit">
        <h2>{{ editingId ? '编辑' : '添加' }} Provider</h2>

        <label>
          预置模板
          <select v-model="form.presetId" @change="onPresetChange">
            <option v-for="preset in store.presets" :key="preset.id" :value="preset.id">
              {{ preset.label }}
            </option>
          </select>
        </label>

        <label>
          名称
          <input v-model="form.name" placeholder="如：我的豆包 / 公司 DeepSeek" required />
        </label>

        <label>
          Base URL
          <input v-model="form.baseURL" placeholder="https://..." required />
        </label>

        <label>
          API Key
          <input v-model="form.apiKey" type="password" required />
          <small v-if="currentPreset?.apiKeyHint" class="muted">{{ currentPreset.apiKeyHint }}</small>
        </label>

        <label>
          模型
          <input v-model="form.model" list="model-suggestions" required />
          <datalist id="model-suggestions">
            <option v-for="m in currentPreset?.models ?? []" :key="m" :value="m" />
          </datalist>
        </label>

        <label class="checkbox">
          <input v-model="form.enabled" type="checkbox" />
          启用
        </label>

        <p v-if="formError" class="banner error">{{ formError }}</p>

        <footer class="modal-actions">
          <button type="button" class="btn" @click="closeForm">取消</button>
          <button type="submit" class="btn primary" :disabled="submitting">
            {{ submitting ? '保存中…' : '保存' }}
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.provider-card {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 14px 16px;
}
.provider-card.disabled {
  opacity: 0.55;
}
.provider-title {
  display: flex;
  gap: 8px;
  align-items: center;
}
.provider-meta {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  font-size: 13px;
  flex-wrap: wrap;
}
.provider-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-shrink: 0;
}
.tag {
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 999px;
  padding: 1px 8px;
  color: #666;
}
.tag.ok {
  color: #16794a;
  border-color: #16794a;
}
.muted {
  color: #888;
}
.empty {
  color: #888;
  padding: 32px 0;
  text-align: center;
}
.test-result {
  margin: 8px 0 0;
  font-size: 13px;
  color: #b33;
  word-break: break-all;
}
.test-result.ok {
  color: #16774a;
}
.banner {
  padding: 8px 12px;
  border-radius: 6px;
  background: #f5f5f5;
}
.banner.error {
  background: #fdecec;
  color: #b33;
}
.btn {
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  padding: 6px 14px;
  cursor: pointer;
}
.btn.primary {
  background: #2c6ecb;
  border-color: #2c6ecb;
  color: #fff;
}
.btn.danger {
  color: #b33;
  border-color: #e5b4b4;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 20px 24px;
  width: min(480px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.modal input,
.modal select {
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 14px;
}
.modal .checkbox {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
