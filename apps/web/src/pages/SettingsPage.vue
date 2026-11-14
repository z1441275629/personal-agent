<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import type {
  ProviderProtocol,
  ProviderPublic,
  TestConnectionResponse,
  UpsertProviderRequest,
  Memory,
  MemoryType,
  McpServerPublic,
} from '@pa/shared';
import { MEMORY_TYPE_LABELS } from '@pa/shared';
import { useSettingsStore } from '../stores/settings';
import * as memoriesApi from '../api/memories';
import * as mcpApi from '../api/settings';

const store = useSettingsStore();
onMounted(() => {
  void store.load();
  void loadMemories();
  void loadMcpServers();
});

// ---------- Agent 记忆 ----------
const memories = ref<Memory[]>([]);
const memoryContent = ref('');
const memoryType = ref<MemoryType>('fact');
const addingMemory = ref(false);

async function loadMemories(): Promise<void> {
  try {
    memories.value = await memoriesApi.fetchMemories();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  }
}

async function addMemory(): Promise<void> {
  const content = memoryContent.value.trim();
  if (!content) return;
  addingMemory.value = true;
  try {
    await memoriesApi.createMemory({ content, type: memoryType.value });
    memoryContent.value = '';
    ElMessage.success('已添加记忆');
    await loadMemories();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    addingMemory.value = false;
  }
}

async function removeMemory(m: Memory): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除这条记忆？\n「${m.content.slice(0, 40)}」`, '删除确认', {
      type: 'warning',
    });
  } catch {
    return;
  }
  await memoriesApi.deleteMemory(m.id);
  ElMessage.success('已删除');
  await loadMemories();
}

// ---------- MCP 服务器（stdio 外部工具） ----------
const mcpServers = ref<McpServerPublic[]>([]);
const mcpLoading = ref(false);

async function loadMcpServers(): Promise<void> {
  mcpLoading.value = true;
  try {
    mcpServers.value = await mcpApi.fetchMcpServers();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    mcpLoading.value = false;
  }
}

const MCP_STATUS: Record<McpServerPublic['status'], { label: string; type: 'success' | 'danger' | 'info' | 'warning' }> = {
  connected: { label: '已连接', type: 'success' },
  connecting: { label: '连接中', type: 'warning' },
  error: { label: '连接失败', type: 'danger' },
  disabled: { label: '已停用', type: 'info' },
};

function mcpCommandLine(s: McpServerPublic): string {
  return [s.command, ...s.args].join(' ');
}

// 编辑对话框（字段独立 ref）
const showMcpForm = ref(false);
const editingMcpId = ref<string | null>(null);
const mcpSubmitting = ref(false);
const mcpName = ref('');
const mcpCommand = ref('');
/** 每行一个参数 */
const mcpArgsText = ref('');
/** 每行一个 KEY=VALUE */
const mcpEnvText = ref('');
const mcpEnabled = ref(true);

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function openMcpCreate(): void {
  editingMcpId.value = null;
  mcpName.value = '';
  mcpCommand.value = '';
  mcpArgsText.value = '';
  mcpEnvText.value = '';
  mcpEnabled.value = true;
  showMcpForm.value = true;
}

function openMcpEdit(s: McpServerPublic): void {
  editingMcpId.value = s.id;
  mcpName.value = s.name;
  mcpCommand.value = s.command;
  mcpArgsText.value = s.args.join('\n');
  mcpEnvText.value = Object.entries(s.env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  mcpEnabled.value = s.enabled;
  showMcpForm.value = true;
}

async function submitMcp(): Promise<void> {
  if (!mcpName.value.trim() || !mcpCommand.value.trim()) {
    ElMessage.warning('名称和命令必填');
    return;
  }
  // env 行格式粗校验（VALUE 可为空）
  const envLines = parseLines(mcpEnvText.value);
  if (envLines.some((l) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(l))) {
    ElMessage.warning('环境变量格式：每行一条 KEY=VALUE');
    return;
  }
  const env: Record<string, string> = {};
  for (const line of envLines) {
    const eq = line.indexOf('=');
    env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const body = {
    name: mcpName.value.trim(),
    command: mcpCommand.value.trim(),
    args: parseLines(mcpArgsText.value),
    env,
    enabled: mcpEnabled.value,
  };
  mcpSubmitting.value = true;
  try {
    // 响应携带重连后的实时状态（连接失败也会保存，状态里带 lastError）
    const saved = editingMcpId.value
      ? await mcpApi.updateMcpServer(editingMcpId.value, body)
      : await mcpApi.createMcpServer(body);
    if (saved.status === 'connected') {
      ElMessage.success(`已保存，「${saved.name}」连接成功（${saved.toolCount} 个工具）`);
    } else if (saved.status === 'error') {
      ElMessage.warning(`已保存，但连接失败：${saved.lastError ?? '未知错误'}`);
    } else {
      ElMessage.success('已保存');
    }
    showMcpForm.value = false;
    await loadMcpServers();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    mcpSubmitting.value = false;
  }
}

async function toggleMcp(s: McpServerPublic): Promise<void> {
  try {
    await mcpApi.updateMcpServer(s.id, { enabled: !s.enabled });
    await loadMcpServers();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  }
}

async function removeMcp(s: McpServerPublic): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除 MCP 服务器「${s.name}」？（会终止其子进程，配置不可恢复）`,
      '删除确认',
      { type: 'warning' },
    );
  } catch {
    return; // 用户取消
  }
  try {
    await mcpApi.deleteMcpServer(s.id);
    ElMessage.success('已删除');
    await loadMcpServers();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  }
}

// ---------- 列表 ----------
type TestState = 'loading' | TestConnectionResponse;
const testing = ref<Record<string, TestState>>({});

function presetLabel(p: ProviderPublic): string {
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

async function doTest(p: ProviderPublic): Promise<void> {
  testing.value = { ...testing.value, [p.id]: 'loading' };
  try {
    const result = await store.test(p.id);
    testing.value = { ...testing.value, [p.id]: result };
    if (result.ok) ElMessage.success(`「${p.name}」连接成功（${result.latencyMs ?? '-'}ms）`);
    else ElMessage.error(`「${p.name}」连接失败：${result.error ?? '未知错误'}`);
  } catch (e) {
    testing.value = {
      ...testing.value,
      [p.id]: { ok: false, latencyMs: null, error: e instanceof Error ? e.message : String(e) },
    };
    ElMessage.error(e instanceof Error ? e.message : String(e));
  }
}

async function doRemove(p: ProviderPublic): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除 provider「${p.name}」？`, '删除确认', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  if (editingId.value === p.id) closeForm();
  await store.remove(p.id);
  ElMessage.success('已删除');
}

// ---------- 表单（字段用独立 ref，v-model 直接绑定） ----------
const showForm = ref(false);
const editingId = ref<string | null>(null);
/** 编辑中已有 key 的掩码（展示用，绝不回填真实 key） */
const editingMasked = ref('');
const formRef = ref<FormInstance>();

const presetId = ref('openai');
const name = ref('');
const protocol = ref<ProviderProtocol>('openai-compatible');
const baseURL = ref('');
const apiKey = ref('');
const model = ref('');
const enabled = ref(true);

/** el-form 校验用的 model 快照（只读；写入全部通过各字段的 v-model） */
const formModel = computed(() => ({
  presetId: presetId.value,
  name: name.value,
  protocol: protocol.value,
  baseURL: baseURL.value,
  apiKey: apiKey.value,
  model: model.value,
  enabled: enabled.value,
}));

/** 新建必须填 key；编辑留空 = 保持原值 */
const apiKeyValidator = (_rule: unknown, value: string, callback: (e?: Error) => void): void => {
  if (!editingId.value && !String(value ?? '').trim()) {
    callback(new Error('新建时必须填写 API Key'));
  } else {
    callback();
  }
};

const rules: FormRules = {
  name: [
    { required: true, message: '请输入名称', trigger: 'blur' },
    { max: 100, message: '名称最多 100 字', trigger: 'blur' },
  ],
  baseURL: [
    { required: true, message: '请输入 Base URL', trigger: 'blur' },
    { pattern: /^https?:\/\/.+/, message: '需以 http:// 或 https:// 开头', trigger: 'blur' },
  ],
  apiKey: [{ validator: apiKeyValidator, trigger: 'blur' }],
  model: [
    { required: true, message: '请输入模型名', trigger: 'blur' },
    { max: 100, message: '模型名最多 100 字', trigger: 'blur' },
  ],
};

const currentPreset = computed(() => store.presets.find((p) => p.id === presetId.value));
const apiKeyPlaceholder = computed(() =>
  editingId.value
    ? `已保存 ${editingMasked.value}，留空则保持不变`
    : (currentPreset.value?.apiKeyHint ?? 'API Key'),
);

function onPresetChange(): void {
  const preset = currentPreset.value;
  if (preset) {
    protocol.value = preset.protocol;
    baseURL.value = preset.baseURL;
    model.value = preset.defaultModel;
  }
}

function openCreate(): void {
  editingId.value = null;
  editingMasked.value = '';
  presetId.value = 'openai';
  name.value = '';
  protocol.value = 'openai-compatible';
  baseURL.value = '';
  apiKey.value = '';
  model.value = '';
  enabled.value = true;
  onPresetChange();
  showForm.value = true;
}

function openEdit(p: ProviderPublic): void {
  editingId.value = p.id;
  editingMasked.value = p.apiKeyMasked;
  presetId.value = p.presetId;
  name.value = p.name;
  protocol.value = p.protocol;
  baseURL.value = p.baseURL;
  // 不回填真实 key：留空提交 = 保持原值
  apiKey.value = '';
  model.value = p.model;
  enabled.value = p.enabled;
  showForm.value = true;
}

function closeForm(): void {
  showForm.value = false;
  editingId.value = null;
}

const submitting = ref(false);

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const key = apiKey.value.trim();
    const body: UpsertProviderRequest = {
      presetId: presetId.value,
      name: name.value.trim(),
      protocol: protocol.value,
      baseURL: baseURL.value,
      model: model.value.trim(),
      enabled: enabled.value,
      // 留空则不带该字段，服务端保持原值
      apiKey: key || undefined,
    };
    await store.save(body, editingId.value ?? undefined);
    ElMessage.success(editingId.value ? '已保存' : '已创建');
    closeForm();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="settings-page">
    <header class="page-header">
      <h1>模型服务配置</h1>
      <el-button type="primary" @click="openCreate">＋ 添加 Provider</el-button>
    </header>

    <p v-if="store.error" class="banner error">加载失败：{{ store.error }}</p>
    <p v-if="store.loading" class="banner">加载中…</p>

    <!-- 列表 -->
    <section v-if="store.providers.length" class="provider-list">
      <article v-for="p in store.providers" :key="p.id" class="provider-card" :class="{ disabled: !p.enabled }">
        <div class="provider-main">
          <div class="provider-title">
            <strong>{{ p.name }}</strong>
            <el-tag size="small" effect="plain">{{ presetLabel(p) }}</el-tag>
            <el-tag :type="p.enabled ? 'success' : 'info'" size="small" effect="plain">
              {{ p.enabled ? '已启用' : '已停用' }}
            </el-tag>
          </div>
          <div class="provider-meta">
            <code>{{ p.model }}</code>
            <el-tag size="small" type="info" effect="plain">{{ p.apiKeyMasked }}</el-tag>
            <span class="muted">{{ p.baseURL }}</span>
          </div>
          <p v-if="tested(p.id)" class="test-result" :class="{ ok: testOk(p.id) }">
            <template v-if="testOk(p.id)">✓ 连接成功（{{ testLatency(p.id) }}ms）</template>
            <template v-else>✗ {{ testError(p.id) }}</template>
          </p>
        </div>
        <div class="provider-actions">
          <el-button size="small" :loading="isTesting(p.id)" @click="doTest(p)">测试连接</el-button>
          <el-button size="small" @click="openEdit(p)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="doRemove(p)">删除</el-button>
        </div>
      </article>
    </section>
    <el-empty v-else-if="!store.loading" description="还没有配置任何模型服务，点右上角「添加 Provider」开始" />

    <!-- Agent 记忆 -->
    <section class="memory-section">
      <h2>Agent 记忆</h2>
      <p class="hint">跨会话保留的用户信息，每次对话自动注入给助理；也可以直接在这里手动管理。</p>

      <div class="memory-form">
        <el-select v-model="memoryType" class="memory-type" title="记忆类型">
          <el-option label="事实" value="fact" />
          <el-option label="偏好" value="preference" />
          <el-option label="笔记" value="note" />
        </el-select>
        <el-input
          v-model="memoryContent"
          maxlength="2000"
          placeholder="添加一条记忆，如：用户养了一只猫叫雪球"
          @keydown.enter.prevent="addMemory"
        />
        <el-button type="primary" :loading="addingMemory" :disabled="!memoryContent.trim()" @click="addMemory">
          添加
        </el-button>
      </div>

      <div v-if="memories.length" class="memory-list">
        <div v-for="m in memories" :key="m.id" class="memory-item">
          <el-tag size="small" effect="plain" :type="m.type === 'preference' ? 'warning' : 'info'">
            {{ MEMORY_TYPE_LABELS[m.type] }}
          </el-tag>
          <span class="memory-content">{{ m.content }}</span>
          <el-button size="small" text type="danger" @click="removeMemory(m)">删除</el-button>
        </div>
      </div>
      <p v-else class="hint">还没有记忆。对助理说"帮我记住…"，它自己就会存进来。</p>
    </section>

    <!-- MCP 服务器（stdio 外部工具） -->
    <section class="memory-section">
      <div class="page-header">
        <h2>MCP 服务器</h2>
        <el-button type="primary" @click="openMcpCreate">＋ 添加服务器</el-button>
      </div>
      <p class="hint">
        以 stdio 方式启动外部 MCP 工具进程（如 npx -y @modelcontextprotocol/server-filesystem），
        其工具会接入对话 Agent，执行前会弹确认卡片。
      </p>

      <p v-if="mcpLoading" class="hint">加载中…</p>

      <div v-else-if="mcpServers.length" class="memory-list">
        <div v-for="s in mcpServers" :key="s.id" class="memory-item mcp-item">
          <div class="mcp-main">
            <div class="provider-title">
              <strong>{{ s.name }}</strong>
              <el-tag size="small" :type="MCP_STATUS[s.status].type" effect="plain">
                {{ MCP_STATUS[s.status].label }}
              </el-tag>
              <el-tag v-if="s.status === 'connected'" size="small" type="info" effect="plain">
                {{ s.toolCount }} 个工具
              </el-tag>
            </div>
            <div class="mcp-meta">
              <code>{{ mcpCommandLine(s) }}</code>
            </div>
            <p v-if="s.lastError" class="test-result">{{ s.lastError }}</p>
          </div>
          <div class="provider-actions">
            <el-switch :model-value="s.enabled" @change="toggleMcp(s)" title="启用/停用" />
            <el-button size="small" @click="openMcpEdit(s)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="removeMcp(s)">删除</el-button>
          </div>
        </div>
      </div>
      <p v-else class="hint">还没有配置 MCP 服务器。</p>
    </section>

    <!-- 表单 -->
    <el-dialog
      v-model="showForm"
      :title="(editingId ? '编辑' : '添加') + ' Provider'"
      width="520px"
      @closed="formRef?.resetFields()"
    >
      <el-form ref="formRef" :model="formModel" :rules="rules" label-width="90px">
        <el-form-item label="预置模板">
          <el-select v-model="presetId" @change="onPresetChange">
            <el-option v-for="preset in store.presets" :key="preset.id" :label="preset.label" :value="preset.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="名称" prop="name">
          <el-input v-model="name" maxlength="100" show-word-limit placeholder="如：我的豆包 / 公司 DeepSeek" />
        </el-form-item>

        <el-form-item label="Base URL" prop="baseURL">
          <el-input v-model="baseURL" placeholder="https://..." />
        </el-form-item>

        <el-form-item label="API Key" prop="apiKey">
          <el-input
            v-model="apiKey"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="apiKeyPlaceholder"
          />
        </el-form-item>

        <el-form-item label="模型" prop="model">
          <el-input v-model="model" placeholder="模型名">
            <template #suffix>
              <span class="muted">可选：{{ (currentPreset?.models ?? []).slice(0, 3).join(' / ') }}</span>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item label="启用">
          <el-switch v-model="enabled" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="closeForm">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <!-- MCP 服务器表单 -->
    <el-dialog
      v-model="showMcpForm"
      :title="(editingMcpId ? '编辑' : '添加') + ' MCP 服务器'"
      width="520px"
    >
      <el-form label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="mcpName" maxlength="50" placeholder="如：filesystem / github" />
        </el-form-item>
        <el-form-item label="命令" required>
          <el-input v-model="mcpCommand" placeholder="如 npx / node / python / uvx" />
        </el-form-item>
        <el-form-item label="参数">
          <el-input
            v-model="mcpArgsText"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="每行一个参数，如：&#10;-y&#10;@modelcontextprotocol/server-filesystem&#10;D:\\docs"
          />
        </el-form-item>
        <el-form-item label="环境变量">
          <el-input
            v-model="mcpEnvText"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="每行一条 KEY=VALUE，如：&#10;GITHUB_TOKEN=ghp_xxx"
          />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="mcpEnabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showMcpForm = false">取消</el-button>
        <el-button type="primary" :loading="mcpSubmitting" @click="submitMcp">保存并连接</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
  width: 100%;
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
.provider-main {
  min-width: 0;
}
.provider-title {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.provider-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-title .el-tag {
  flex-shrink: 0;
}
.provider-meta {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  font-size: 13px;
  flex-wrap: wrap;
  align-items: center;
}
.provider-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-shrink: 0;
}
.muted {
  color: #888;
  font-size: 12px;
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
.memory-section {
  margin-top: 40px;
}
.memory-section h2 {
  font-size: 17px;
  margin: 0 0 4px;
}
.hint {
  color: #888;
  font-size: 13px;
  margin: 0 0 12px;
}
.memory-form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.memory-type {
  width: 96px;
  flex-shrink: 0;
}
.memory-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.memory-item {
  display: flex;
  gap: 10px;
  align-items: center;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 8px 12px;
  min-width: 0;
}
.memory-item .el-tag {
  flex-shrink: 0;
}
.memory-content {
  flex: 1;
  font-size: 13px;
  color: #444;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mcp-item {
  align-items: flex-start;
}
.mcp-main {
  min-width: 0;
  flex: 1;
}
.mcp-meta {
  margin-top: 6px;
  font-size: 12px;
  min-width: 0;
}
.mcp-meta code {
  color: #557;
  word-break: break-all;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  padding: 1px 6px;
}
</style>
