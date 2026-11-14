import { z } from 'zod';

/** 定时任务类型：提醒（到点推送通知）/ 每日培训（LLM 按主题生成课程再推送） */
export const TaskTypeSchema = z.enum(['reminder', 'daily_training']);
export type TaskType = z.infer<typeof TaskTypeSchema>;

/**
 * 任务负载（按 type 取对应字段，服务端校验归属）：
 *   reminder       → text：提醒内容
 *   daily_training → topic：培训主题（如"英语高频词"、"TypeScript 类型体操"）
 */
export const TaskPayloadSchema = z.object({
  text: z.string().optional(),
  topic: z.string().optional(),
});
export type TaskPayload = z.infer<typeof TaskPayloadSchema>;

/** 定时任务（存储与传输统一形状） */
export const TaskSchema = z.object({
  id: z.string(),
  type: TaskTypeSchema,
  name: z.string(),
  /** 标准 5 段 cron（分 时 日 月 周），按服务器本地时区调度 */
  cron: z.string(),
  payload: TaskPayloadSchema,
  enabled: z.boolean(),
  lastRunAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Task = z.infer<typeof TaskSchema>;

/** 通知来源：提醒 / 每日培训 / 任务执行失败 */
export const NotificationTypeSchema = z.enum(['reminder', 'daily_training', 'error']);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** 通知（前端轮询拉取；content 为详情全文，如培训课程） */
export const NotificationSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  type: NotificationTypeSchema,
  title: z.string(),
  /** 摘要：系统通知与列表预览用 */
  body: z.string(),
  /** 详情全文（培训课程等），可空 */
  content: z.string().nullable(),
  readAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type Notification = z.infer<typeof NotificationSchema>;
