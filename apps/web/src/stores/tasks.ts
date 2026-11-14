import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Notification, Task, TaskType, UpdateTaskRequest } from '@pa/shared';
import * as api from '../api/tasks';

export const useTaskStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      tasks.value = await api.fetchTasks();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function save(
    input: { type: TaskType; name: string; cron: string; payload: Task['payload'] },
    id?: string,
  ): Promise<Task> {
    const saved = id
      ? await api.updateTask(id, input as UpdateTaskRequest)
      : await api.createTask(input);
    await load();
    return saved;
  }

  async function remove(id: string): Promise<void> {
    await api.deleteTask(id);
    await load();
  }

  /** 启停开关：只改 enabled，失败回滚 UI 状态 */
  async function toggleEnabled(task: Task): Promise<void> {
    const next = !task.enabled;
    task.enabled = next; // 乐观更新
    try {
      await api.updateTask(task.id, { enabled: next });
    } catch (e) {
      task.enabled = !next;
      throw e;
    }
  }

  /** 立即执行一次，返回生成的通知（培训全文在 content） */
  async function run(id: string): Promise<Notification> {
    return api.runTaskNow(id);
  }

  return { tasks, loading, error, load, save, remove, toggleEnabled, run };
});
