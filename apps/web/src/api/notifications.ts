import type { ListNotificationsResponse, Notification } from '@pa/shared';
import { request } from './http';

export const fetchNotifications = (): Promise<ListNotificationsResponse> =>
  request<ListNotificationsResponse>('/api/notifications/');

export const markNotificationsRead = (ids: string[]): Promise<void> =>
  request<void>('/api/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });

export const markAllNotificationsRead = (): Promise<void> =>
  request<void>('/api/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ all: true }),
  });

export type { Notification };
