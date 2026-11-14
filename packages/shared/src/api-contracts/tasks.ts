import { z } from 'zod';
import {
  NotificationSchema,
  TaskPayloadSchema,
  TaskSchema,
  TaskTypeSchema,
} from '../domain/task';

export const ListTasksResponseSchema = z.object({
  tasks: z.array(TaskSchema),
});
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;

/** 创建任务：cron 与 payload 按 type 的归属校验在服务端做（提示更友好） */
export const CreateTaskRequestSchema = z.object({
  type: TaskTypeSchema,
  name: z.string().min(1).max(100),
  cron: z.string().min(9).max(60),
  payload: TaskPayloadSchema,
  enabled: z.boolean().optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

/** 更新任务：字段全部可选，未提供的保持原值 */
export const UpdateTaskRequestSchema = z.object({
  type: TaskTypeSchema.optional(),
  name: z.string().min(1).max(100).optional(),
  cron: z.string().min(9).max(60).optional(),
  payload: TaskPayloadSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

/** POST /api/tasks/:id/run —— 立即执行一次（不影响 cron 计划），返回生成的通知 */
export const RunTaskResponseSchema = z.object({
  notification: NotificationSchema,
});
export type RunTaskResponse = z.infer<typeof RunTaskResponseSchema>;
