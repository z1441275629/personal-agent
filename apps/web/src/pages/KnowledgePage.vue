<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { FormInstance } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import type {
  KnowledgeDocument,
  KnowledgeSearchResponse,
  KnowledgeSettings,
  KnowledgeSettingsResponse,
} from '@pa/shared';
import { useSettingsStore } from '../stores/settings';
import * as kb from '../api/knowledge';

/**
 * 知识库页：文档管理（粘贴/导入 .txt/.md）+ embedding 设置（独立于对话模型）
 * + 试搜。embedding 未配置或失败时自动走关键词检索（CJK 2-gram）。
 */

const settings = useSettingsStore();

// ---------- 文档列表 ----------
const documents = ref<KnowledgeDocument[]>([]);
const loading = ref(false);

async function loadDocuments(): Promise<void> {
  loading.value = true;
  try {
    documents.value = await kb.fetchDocuments();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    loading.value = false;
  }
}

async function removeDoc(d: KnowledgeDocument): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除文档「${d.name}」及其全部切片？`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await kb.deleteDocument(d.id);
    ElMessage.success('已删除');
    await Promise.all([loadDocuments(), loadKbSettings()]);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  }
}

// ---------- 添加文档 ----------
const showAdd = ref(false);
const adding = ref(false);
const addName = ref('');
const addContent = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

const addFormRef = ref<FormInstance>();
const addModel = computed(() => ({ name: addName.value, content: addContent.value }));
const addRules = {
  name: [{ required: true, message: '请输入文档名称', trigger: 'blur' }],
  content: [{ required: true, message: '内容不能为空', trigger: 'blur' }],
};

function openAdd(): void {
  addName.value = '';
  addContent.value = '';
  showAdd.value = true;
}

async function onFileChange(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const text = await file.text(); // UTF-8
    addContent.value = text;
    if (!addName.value.trim()) {
      addName.value = file.name;
    }
  } catch (err) {
    ElMessage.error(`读取文件失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // 允许重复选同一文件
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function submitAdd(): Promise<void> {
  const valid = await addFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  adding.value = true;
  try {
    const { document, warning } = await kb.createDocument({
      name: addName.value.trim(),
      content: addContent.value,
    });
    if (warning) ElMessage.warning(warning);
    else ElMessage.success(`已导入「${document.name}」（${document.chunkCount} 块）`);
    showAdd.value = false;
    await Promise.all([loadDocuments(), loadKbSettings()]);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    adding.value = false;
  }
}

// ---------- embedding 设置（单独配置，与对话模型解耦） ----------
const kbSettings = ref<KnowledgeSettingsResponse | null>(null);
const embProviderId = ref<string>(''); // '' = 跟随第一个启用的
const embModel = ref('');
const topK = ref(5);
const savingSettings = ref(false);
const reindexing = ref(false);

const providerOptions = computed(() => settings.providers);

async function loadKbSettings(): Promise<void> {
  try {
    const s = await kb.fetchKnowledgeSettings();
    kbSettings.value = s;
    embProviderId.value = s.embeddingProviderId ?? '';
    embModel.value = s.embeddingModel;
    topK.value = s.topK;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  }
}

async function saveKbSettings(): Promise<void> {
  savingSettings.value = true;
  try {
    const body: KnowledgeSettings = {
      embeddingProviderId: embProviderId.value || null,
      embeddingModel: embModel.value.trim(),
      topK: topK.value,
    };
    kbSettings.value = await kb.saveKnowledgeSettings(body);
    ElMessage.success('已保存');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    savingSettings.value = false;
  }
}

async function doReindex(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '按当前 embedding 配置重建全部文档的向量索引？（关键词模式下不可用）',
      '重建索引',
      { type: 'info' },
    );
  } catch {
    return;
  }
  reindexing.value = true;
  try {
    const res = await kb.reindexKnowledge();
    if (res.ok) {
      ElMessage.success(`重建完成：${res.embeddedChunks}/${res.totalChunks} 块已向量化`);
    } else {
      ElMessage.error(`重建失败：${res.error ?? '未知错误'}`);
    }
    await loadKbSettings();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    reindexing.value = false;
  }
}

// ---------- 试搜 ----------
const query = ref('');
const searching = ref(false);
const searchResult = ref<KnowledgeSearchResponse | null>(null);

async function doSearch(): Promise<void> {
  const q = query.value.trim();
  if (!q) return;
  searching.value = true;
  searchResult.value = null;
  try {
    searchResult.value = await kb.searchKnowledge({ query: q });
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    searching.value = false;
  }
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

onMounted(() => {
  void loadDocuments();
  void loadKbSettings();
  void settings.load();
});
</script>

<template>
  <div class="kb-page">
    <header class="page-header">
      <h1>知识库</h1>
      <el-button type="primary" @click="openAdd">＋ 导入文档</el-button>
    </header>

    <p v-if="kbSettings" class="hint">
      共 {{ kbSettings.documentCount }} 篇文档 / {{ kbSettings.totalChunks }} 块切片，
      其中 {{ kbSettings.embeddedChunks }} 块已向量化。
      {{ embModel ? `向量模型：${embModel}` : '未配置 embedding 模型，当前为关键词检索（导入文档即可用，配置后自动升级向量检索）' }}
    </p>

    <!-- 文档列表 -->
    <section v-loading="loading" class="doc-list">
      <div v-for="d in documents" :key="d.id" class="doc-item">
        <div class="doc-main">
          <div class="doc-title">
            <strong>{{ d.name }}</strong>
            <el-tag size="small" :type="d.embeddingModel ? 'success' : 'info'" effect="plain">
              {{ d.embeddingModel ? '已向量化' : '关键词' }}
            </el-tag>
          </div>
          <div class="doc-meta">
            <span>{{ d.chunkCount }} 块 · {{ d.chars.toLocaleString() }} 字</span>
            <span class="muted">{{ fmtTime(d.createdAt) }}</span>
            <span v-if="d.embeddingModel" class="muted">{{ d.embeddingModel }}</span>
          </div>
        </div>
        <el-button size="small" type="danger" plain @click="removeDoc(d)">删除</el-button>
      </div>
      <el-empty v-if="!documents.length && !loading" description="还没有文档。点右上角「导入文档」，粘贴文本或选择 .txt / .md 文件" />
    </section>

    <!-- embedding 设置 -->
    <section class="settings-section">
      <h2>检索设置</h2>
      <p class="hint">
        embedding 单独配置，不影响对话模型：选任意 provider + 填该服务的 embedding 模型名
        （如 doubao-embedding-250415 / text-embedding-3-small）。留空则用关键词检索。
      </p>
      <div class="kb-form">
        <el-select v-model="embProviderId" class="provider-select" title="embedding 使用的模型服务">
          <el-option label="跟随第一个启用的服务" value="" />
          <el-option
            v-for="p in providerOptions"
            :key="p.id"
            :label="`${p.name}${p.enabled ? '' : '（已停用）'}`"
            :value="p.id"
          />
        </el-select>
        <el-input v-model="embModel" placeholder="embedding 模型名（留空 = 关键词检索）" class="model-input" />
        <el-input-number v-model="topK" :min="1" :max="20" controls-position="right" title="检索返回条数" />
        <el-button type="primary" :loading="savingSettings" @click="saveKbSettings">保存</el-button>
        <el-button :loading="reindexing" @click="doReindex" title="切换 embedding 模型后重建向量">重建索引</el-button>
      </div>
    </section>

    <!-- 试搜 -->
    <section class="search-section">
      <h2>试搜一下</h2>
      <div class="kb-form">
        <el-input
          v-model="query"
          placeholder="输入关键词，验证检索效果（对话中 Agent 也会自动调用）"
          @keydown.enter.prevent="doSearch"
        />
        <el-button type="primary" :loading="searching" :disabled="!query.trim()" @click="doSearch">搜索</el-button>
      </div>
      <div v-if="searchResult" class="search-results">
        <p class="muted">
          {{ searchResult.mode === 'vector' ? '向量检索' : '关键词检索' }} · {{ searchResult.results.length }} 条
        </p>
        <div v-for="(r, i) in searchResult.results" :key="i" class="result-item">
          <div class="result-head">
            <el-tag size="small" effect="plain">{{ r.docName }} · 第{{ r.chunkIndex + 1 }}块</el-tag>
            <span class="muted">{{ r.score.toFixed(3) }}</span>
          </div>
          <p class="result-text">{{ r.text }}</p>
        </div>
        <p v-if="!searchResult.results.length" class="muted">没有命中内容</p>
      </div>
    </section>

    <!-- 导入对话框 -->
    <el-dialog v-model="showAdd" title="导入文档" width="640px">
      <el-form ref="addFormRef" :model="addModel" :rules="addRules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="addName" maxlength="200" placeholder="如：产品笔记.md" />
        </el-form-item>
        <el-form-item label="文件">
          <input ref="fileInput" type="file" accept=".txt,.md,.markdown,.json,.log" @change="onFileChange" />
        </el-form-item>
        <el-form-item label="内容" prop="content">
          <el-input
            v-model="addContent"
            type="textarea"
            :autosize="{ minRows: 8, maxRows: 18 }"
            placeholder="粘贴文本，或选择 .txt / .md 文件自动填充"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" :loading="adding" :disabled="!addName.trim() || !addContent.trim()" @click="submitAdd">
          导入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.kb-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
  width: 100%;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.hint {
  color: #888;
  font-size: 13px;
  margin: 0 0 12px;
}
.doc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 60px;
}
.doc-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 10px 14px;
}
.doc-main {
  min-width: 0;
}
.doc-title {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.doc-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-title .el-tag {
  flex-shrink: 0;
}
.doc-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: #666;
  flex-wrap: wrap;
}
.muted {
  color: #999;
  font-size: 12px;
}
.settings-section,
.search-section {
  margin-top: 32px;
}
.settings-section h2,
.search-section h2 {
  font-size: 17px;
  margin: 0 0 4px;
}
.kb-form {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.provider-select {
  width: 220px;
}
.model-input {
  width: 280px;
}
.search-results {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.result-item {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 10px 12px;
}
.result-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.result-text {
  margin: 0;
  font-size: 13px;
  color: #444;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 140px;
  overflow-y: auto;
  line-height: 1.6;
}
input[type='file'] {
  font-size: 13px;
}
</style>
