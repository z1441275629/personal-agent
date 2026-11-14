import { z } from 'zod';
import { NotificationSchema } from '../domain/task';

/** GET /api/notifications —— 最近通知（时间倒序，最多 50 条）+ 未读数 */
export const ListNotificationsResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  unreadCount: z.number().int(),
});
export type ListNotificationsResponse = z.infer<typeof ListNotificationsResponseSchema>;

/** POST /api/notifications/read —— 按 ids 标记已读，或 all: true 全部已读 */
export const MarkNotificationsReadRequestSchema = z
  .object({
    ids: z.array(z.string()).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all || (v.ids?.length ?? 0) > 0, {
    message: '必须提供 ids 或 all: true',
  });
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequestSchema>;
