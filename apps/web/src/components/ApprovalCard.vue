<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

/**
 * HITL 确认卡片：confirm 级工具执行前弹出，等用户批准（可改参数）/拒绝。
 * 字段编辑按原参数类型分派：string→文本框，number→数字框，
 * boolean→开关，其余（嵌套对象/数组）→ JSON 文本域（提交时解析校验）。
 */
const props = defineProps<{
  name: string;
  input: Record<string, unknown>;
  decided?: 'approved' | 'rejected';
  /** 决定失败原因（如服务端已超时自动拒绝） */
  error?: string;
}>();

const emit = defineEmits<{
  decide: [approved: boolean, edited: Record<string, unknown>];
}>();

type FieldKind = 'string' | 'number' | 'boolean' | 'json';

function kindOf(value: unknown): FieldKind {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'json';
}

const fields = computed(() =>
  Object.keys(props.input).map((key) => ({ key, kind: kindOf(props.input[key]) })),
);

// 可编辑副本：json 类字段转成字符串便于编辑
const draft = reactive<Record<string, unknown>>(
  Object.fromEntries(
    Object.entries(props.input).map(([k, v]) => [
      k,
      kindOf(v) === 'json' ? JSON.stringify(v, null, 2) : v,
    ]),
  ),
);

const localError = ref<string | null>(null);

/** 构建提交参数（按原始类型还原）；校验失败给 localError */
function buildEdited(): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const f of fields.value) {
    const raw = draft[f.key];
    if (f.kind === 'number') {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        localError.value = `参数「${f.key}」不是有效数字`;
        return null;
      }
      out[f.key] = n;
    } else if (f.kind === 'boolean') {
      out[f.key] = Boolean(raw);
    } else if (f.kind === 'json') {
      try {
        out[f.key] = JSON.parse(String(raw));
      } catch {
        localError.value = `参数「${f.key}」不是有效 JSON`;
        return null;
      }
    } else {
      out[f.key] = String(raw);
    }
  }
  localError.value = null;
  return out;
}

function onApprove(): void {
  const edited = buildEdited();
  if (edited) emit('decide', true, edited);
}

function onReject(): void {
  localError.value = null;
  emit('decide', false, {});
}
</script>

<template>
  <div class="approval-card" :class="{ decided: !!decided }">
    <div class="head">
      <span class="icon">⚠️</span>
      <span class="title">工具执行确认</span>
      <span class="tool">{{ name }}</span>
    </div>

    <div v-if="fields.length" class="fields">
      <div v-for="f in fields" :key="f.key" class="field">
        <label :title="f.key">{{ f.key }}</label>
        <el-switch
          v-if="f.kind === 'boolean'"
          :model-value="Boolean(draft[f.key])"
          :disabled="!!decided"
          @update:model-value="(v: string | number | boolean) => (draft[f.key] = !!v)"
        />
        <el-input-number
          v-else-if="f.kind === 'number'"
          :model-value="Number(draft[f.key])"
          :disabled="!!decided"
          controls-position="right"
          @update:model-value="(v: number | undefined) => (draft[f.key] = v ?? 0)"
        />
        <el-input
          v-else
          :model-value="String(draft[f.key])"
          :type="f.kind === 'json' ? 'textarea' : 'text'"
          :autosize="f.kind === 'json' ? { minRows: 2, maxRows: 6 } : undefined"
          :disabled="!!decided"
          @update:model-value="(v: string) => (draft[f.key] = v)"
        />
      </div>
    </div>
    <p v-else class="no-params">该工具没有可编辑参数</p>

    <p v-if="localError" class="field-error">{{ localError }}</p>
    <p v-if="error && decided === 'rejected'" class="field-error">{{ error }}</p>

    <div v-if="!decided" class="actions">
      <span class="hint">超过 5 分钟未处理将自动拒绝</span>
      <el-button size="small" @click="onReject">拒绝</el-button>
      <el-button size="small" type="primary" @click="onApprove">批准执行</el-button>
    </div>
    <div v-else class="verdict">
      <el-tag :type="decided === 'approved' ? 'success' : 'info'" size="small">
        {{ decided === 'approved' ? '✓ 已批准' : '✗ 已拒绝' }}
      </el-tag>
      <span v-if="error" class="hint">{{ error }}</span>
    </div>
  </div>
</template>

<style scoped>
.approval-card {
  border: 1px solid #f0c36d;
  background: #fdf8ec;
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 72%;
}
.approval-card.decided {
  opacity: 0.75;
  border-color: #ddd;
  background: #fafafa;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.head .title {
  font-weight: 600;
  color: #8a6d3b;
}
.head .tool {
  font-family: Consolas, Menlo, monospace;
  font-size: 12px;
  color: #557;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 1px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px;
  align-items: center;
}
.field label {
  font-size: 12px;
  color: #666;
  font-family: Consolas, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.no-params {
  font-size: 12px;
  color: #999;
}
.field-error {
  font-size: 12px;
  color: #b33;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
}
.hint {
  font-size: 12px;
  color: #999;
  margin-right: auto;
}
.verdict {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
