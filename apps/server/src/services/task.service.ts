import { randomUUID } from 'node:crypto';
import cron from 'node-cron';
import type {
  CreateTaskRequest,
  Notification,
  Task,
  UpdateTaskRequest,
} from '@pa/shared';
import { tasksRepo } from '@pa/persistence';
import { runTask, taskScheduler } from '../scheduler';

/** 与 chat.service 一致的 HTTP 错误约定（errorHandler 读 .status） */
function httpError(status: number, message: string): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** cron 表达式 + payload 按 type 的归属校验（错误信息直接给用户看） */
function validateTaskInput(
  input: CreateTaskRequest | UpdateTaskRequest,
): void {
  if (input.cron !== undefined && !cron.validate(input.cron)) {
    throw httpError(400, `cron 表达式无效: ${input.cron}`);
  }
  if (input.type === 'reminder' && input.payload !== undefined && !input.payload.text?.trim()) {
    throw httpError(400, '提醒任务必须填写提醒内容');
  }
  if (input.type === 'daily_training' && input.payload !== undefined && !input.payload.topic?.trim()) {
    throw httpError(400, '培训任务必须填写培训主题');
  }
}

export const taskService = {
  list(): Task[] {
    return tasksRepo.list();
  },

  create(input: CreateTaskRequest): Task {
    validateTaskInput(input);
    const task = tasksRepo.create({
      id: randomUUID(),
      type: input.type,
      name: input.name.trim(),
      cron: input.cron.trim(),
      payload: input.payload,
      enabled: input.enabled ?? true,
    });
    taskScheduler.reload();
    return task;
  },

  update(id: string, input: UpdateTaskRequest): Task {
    const existing = tasksRepo.get(id);
    if (!existing) throw httpError(404, `任务不存在: ${id}`);
    // 合并后校验（比如只改 payload 时也要保证归属字段合法）
    validateTaskInput({
      type: input.type ?? existing.type,
      cron: input.cron,
      payload: input.payload,
    });
    tasksRepo.update(id, {
      name: input.name?.trim(),
      cron: input.cron?.trim(),
      payload: input.payload,
      enabled: input.enabled,
    });
    taskScheduler.reload();
    const updated = tasksRepo.get(id);
    if (!updated) throw httpError(500, '更新后任务消失，请检查数据库');
    return updated;
  },

  remove(id: string): void {
    const existing = tasksRepo.get(id);
    if (!existing) throw httpError(404, `任务不存在: ${id}`);
    tasksRepo.remove(id);
    taskScheduler.reload();
  },

  /** 立即执行一次（不影响 cron 计划），返回生成的通知供前端直接展示 */
  async run(id: string): Promise<Notification> {
    const task = tasksRepo.get(id);
    if (!task) throw httpError(404, `任务不存在: ${id}`);
    return runTask(task);
  },
};
