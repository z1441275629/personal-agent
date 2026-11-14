import type { MarkNotificationsReadRequest, Notification } from '@pa/shared';
import { notificationsRepo } from '@pa/persistence';

export const notificationService = {
  /** 最近 50 条（倒序）+ 未读数，一次轮询拿全 */
  list(): { notifications: Notification[]; unreadCount: number } {
    return {
      notifications: notificationsRepo.list(50),
      unreadCount: notificationsRepo.unreadCount(),
    };
  },

  markRead(input: MarkNotificationsReadRequest): void {
    if (input.all) {
      notificationsRepo.markAllRead();
    } else if (input.ids?.length) {
      notificationsRepo.markRead(input.ids);
    }
  },
};
