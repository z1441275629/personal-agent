<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import type { Notification as PaNotification, Task, TaskType } from '@pa/shared';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useTaskStore } from '../stores/tasks';
import { useNotificationStore } from '../stores/notifications';

const store = useTaskStore();
const notifications = useNotificationStore();
onMounted(() => void store.load());

// ---------- 展示辅助 ----------
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function typeLabel(t: TaskType): string {
  return t === 'reminder' ? '提醒' : '每日培训';
}

/** cron → 人话；识别不了的显示原文 */
function cronDescribe(cronStr: string): string {
  let m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cronStr);
  if (m) return `每天 ${pad(m[2]!)}:${pad(m[1]!)}`;
  m = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(cronStr);
  if (m) return `工作日 ${pad(m[2]!)}:${pad(m[1]!)}`;
  m = /^(\d{1,2}) (\d{1,2}) \* \* (\d)$/.exec(cronStr);
  if (m) return `每周${WEEKDAYS[Number(m[3])]!} ${pad(m[2]!)}:${pad(m[1]!)}`;
  return cronStr;
}

function pad(s: string): string {
  return s.padStart(2, '0');
}

function fmtTime(ts: number | null): string {
  if (!ts) return '从未执行';
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------- 列表操作 ----------
const runningId = ref<string | null>(null);
/** 立即执行的结果（培训全文等） */
const runResult = ref<PaNotification | null>(null);
const runResultVisible = computed({
  get: () => runResult.value !== null,
  set: (v: boolean) => {
    if (!v) runResult.value = null;
  },
});

async function doRun(t: Task): Promise<void> {
  runningId.value = t.id;
  try {
    runResult.value = await store.run(t.id);
    void notifications.load().catch(() => undefined);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    runningId.value = null;
  }
}

async function doRemove(t: Task): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除任务「${t.name}」？`, '删除确认', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  if (editingId.value === t.id) closeForm();
  await store.remove(t.id);
  ElMessage.success('已删除');
}

async function doToggle(t: Task): Promise<void> {
  try {
    await store.toggleEnabled(t);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  }
}

// ---------- 表单 ----------
type ScheduleMode = 'daily' | 'weekdays' | 'weekly' | 'custom';
const showForm = ref(false);
const editingId = ref<string | null>(null);
const formRef = ref<FormInstance>();

const form = reactive({
  type: 'reminder' as TaskType,
  name: '',
  scheduleMode: 'daily' as ScheduleMode,
  time: '09:00',
  weeklyDay: 1,
  customCron: '',
  text: '', // reminder 载荷
  topic: '', // daily_training 载荷
});

/** 按任务类型动态生成校验规则（与 shared 契约的上限保持一致） */
const rules = computed<FormRules>(() => ({
  name: [
    { required: true, message: '请输入任务名称', trigger: 'blur' },
    { max: 100, message: '名称最多 100 字', trigger: 'blur' },
  ],
  time: [{ required: true, message: '请选择时间', trigger: 'change' }],
  customCron: [
    { required: true, message: '请输入 cron 表达式', trigger: 'blur' },
    { pattern: /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, message: '格式：分 时 日 月 周（5 段空格分隔）', trigger: 'blur' },
  ],
  text:
    form.type === 'reminder'
      ? [
          { required: true, message: '请输入提醒内容', trigger: 'blur' },
          { max: 500, message: '提醒内容最多 500 字', trigger: 'blur' },
        ]
      : [],
  topic:
    form.type === 'daily_training'
      ? [
          { required: true, message: '请输入培训主题', trigger: 'blur' },
          { max: 100, message: '主题最多 100 字', trigger: 'blur' },
        ]
      : [],
}));

function computeCron(): string {
  const [h, min] = form.time.split(':');
  const hh = Number(h ?? 9);
  const mm = Number(min ?? 0);
  switch (form.scheduleMode) {
    case 'daily':
      return `${mm} ${hh} * * *`;
    case 'weekdays':
      return `${mm} ${hh} * * 1-5`;
    case 'weekly':
      return `${mm} ${hh} * * ${form.weeklyDay}`;
    case 'custom':
      return form.customCron.trim();
  }
}

/** 编辑时把 cron 反解析回表单（匹配不上就走 custom） */
function parseCronIntoForm(cronStr: string): void {
  let m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cronStr);
  if (m) {
    form.scheduleMode = 'daily';
    form.time = `${pad(m[2]!)}:${pad(m[1]!)}`;
    return;
  }
  m = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(cronStr);
  if (m) {
    form.scheduleMode = 'weekdays';
    form.time = `${pad(m[2]!)}:${pad(m[1]!)}`;
    return;
  }
  m = /^(\d{1,2}) (\d{1,2}) \* \* (\d)$/.exec(cronStr);
  if (m) {
    form.scheduleMode = 'weekly';
    form.time = `${pad(m[2]!)}:${pad(m[1]!)}`;
    form.weeklyDay = Number(m[3]);
    return;
  }
  form.scheduleMode = 'custom';
  form.customCron = cronStr;
}

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, {
    type: 'reminder',
    name: '',
    scheduleMode: 'daily',
    time: '09:00',
    weeklyDay: 1,
    customCron: '',
    text: '',
    topic: '',
  });
  showForm.value = true;
}

function openEdit(t: Task): void {
  editingId.value = t.id;
  Object.assign(form, {
    type: t.type,
    name: t.name,
    time: '09:00',
    weeklyDay: 1,
    customCron: '',
    text: t.payload.text ?? '',
    topic: t.payload.topic ?? '',
  });
  parseCronIntoForm(t.cron);
  showForm.value = true;
}

function closeForm(): void {
  showForm.value = false;
  editingId.value = null;
}

const cronPreview = computed(() =>
  form.scheduleMode === 'custom' ? form.customCron : cronDescribe(computeCron()),
);

const submitting = ref(false);

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    await store.save(
      {
        type: form.type,
        name: form.name.trim(),
        cron: computeCron(),
        payload:
          form.type === 'reminder'
            ? { text: form.text.trim() }
            : { topic: form.topic.trim() },
      },
      editingId.value ?? undefined,
    );
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
  <div class="tasks-page">
    <header class="page-header">
      <h1>定时任务</h1>
      <el-button type="primary" @click="openCreate">＋ 新建任务</el-button>
    </header>
    <p class="hint">提醒到点推送通知；每日培训按主题让 AI 生成一节小课后推送。应用需保持运行。</p>

    <p v-if="store.error" class="banner error">加载失败：{{ store.error }}</p>
    <p v-if="store.loading" class="banner">加载中…</p>

    <section v-if="store.tasks.length" class="task-list">
      <article v-for="t in store.tasks" :key="t.id" class="task-card" :class="{ disabled: !t.enabled }">
        <div class="task-main">
          <div class="task-title">
            <strong>{{ t.name }}</strong>
            <el-tag :type="t.type === 'reminder' ? 'warning' : 'success'" size="small" effect="plain">
              {{ typeLabel(t.type) }}
            </el-tag>
          </div>
          <div class="task-meta">
            <span>⏰ {{ cronDescribe(t.cron) }}</span>
            <span class="muted">上次执行：{{ fmtTime(t.lastRunAt) }}</span>
          </div>
          <p v-if="t.type === 'reminder'" class="task-payload">📝 {{ t.payload.text }}</p>
          <p v-else class="task-payload">📚 主题：{{ t.payload.topic }}</p>
        </div>
        <div class="task-actions">
          <el-switch :model-value="t.enabled" title="启用/停用" @change="doToggle(t)" />
          <el-button size="small" :loading="runningId === t.id" @click="doRun(t)">立即执行</el-button>
          <el-button size="small" @click="openEdit(t)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="doRemove(t)">删除</el-button>
        </div>
      </article>
    </section>
    <el-empty v-else-if="!store.loading" description="还没有定时任务，点右上角「新建任务」开始" />

    <!-- 新建/编辑表单 -->
    <el-dialog
      v-model="showForm"
      :title="(editingId ? '编辑' : '新建') + '任务'"
      width="520px"
      @closed="formRef?.resetFields()"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="reminder">提醒</el-radio>
            <el-radio value="daily_training">每日培训</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="100" show-word-limit placeholder="如：下班打卡提醒 / 每日英语" />
        </el-form-item>

        <el-form-item label="计划">
          <el-select v-model="form.scheduleMode">
            <el-option label="每天" value="daily" />
            <el-option label="工作日（周一到周五）" value="weekdays" />
            <el-option label="每周一次" value="weekly" />
            <el-option label="自定义 cron" value="custom" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.scheduleMode === 'weekly'" label="星期">
          <el-select v-model.number="form.weeklyDay">
            <el-option v-for="(w, i) in WEEKDAYS" :key="i" :label="`周${w}`" :value="i" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.scheduleMode !== 'custom'" label="时间" prop="time">
          <el-time-picker v-model="form.time" format="HH:mm" value-format="HH:mm" placeholder="选择时间" />
        </el-form-item>

        <el-form-item v-else label="cron" prop="customCron">
          <el-input v-model="form.customCron" placeholder="如：0 9 * * *" />
          <div class="cron-hint">5 段：分 时 日 月 周</div>
        </el-form-item>

        <div v-if="cronPreview" class="cron-preview">下次执行计划：{{ cronPreview }}</div>

        <el-form-item v-if="form.type === 'reminder'" label="提醒内容" prop="text">
          <el-input
            v-model="form.text"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="到点要提醒你的话"
          />
        </el-form-item>
        <el-form-item v-else label="培训主题" prop="topic">
          <el-input v-model="form.topic" maxlength="100" show-word-limit placeholder="如：英语高频词 / TypeScript 类型体操" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="closeForm">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 立即执行结果 -->
    <el-dialog v-model="runResultVisible" :title="runResult?.title" width="640px">
      <div class="result-text">{{ runResult?.content ?? runResult?.body }}</div>
      <template #footer>
        <el-button @click="runResult = null">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tasks-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
  width: 100%;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.hint {
  color: #888;
  font-size: 13px;
  margin: 0 0 16px;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.task-card {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 14px 16px;
}
.task-card.disabled {
  opacity: 0.55;
}
.task-main {
  min-width: 0; /* 允许内部省略号生效 */
}
.task-title {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.task-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-meta {
  display: flex;
  gap: 16px;
  margin-top: 6px;
  font-size: 13px;
  flex-wrap: wrap;
}
.task-payload {
  margin: 6px 0 0;
  font-size: 13px;
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.muted {
  color: #888;
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
.cron-preview {
  margin: 0 0 16px;
  padding-left: 80px;
  font-size: 12px;
  color: #2c6ecb;
}
.cron-hint {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}
.result-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.7;
  max-height: 60vh;
  overflow-y: auto;
}
</style>
