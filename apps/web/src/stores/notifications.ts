import { defineStore } from 'pinia';
import { onUnmounted, ref } from 'vue';
import type { Notification } from '@pa/shared';
import * as api from '../api/notifications';

const POLL_INTERVAL_MS = 20_000;

/**
 * 通知中心：轮询拉取 + 系统通知。
 * - 每 20s / 页面聚焦时刷新；轮询间新出现的未读 → Web Notification（Electron 渲染进程原生支持）
 * - 系统通知只在用户授权后弹（首次点铃铛时申请），应用内未读徽标始终可用
 */
export const useNotificationStore = defineStore('notifications', () => {
  const items = ref<Notification[]>([]);
  const unreadCount = ref(0);

  /** 本会话已弹过系统通知的 id（避免重复弹） */
  const shownIds = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function load(showSystem = false): Promise<void> {
    const res = await api.fetchNotifications();
    const prevUnreadIds = new Set(items.value.filter((n) => !n.readAt).map((n) => n.id));
    items.value = res.notifications;
    unreadCount.value = res.unreadCount;

    if (showSystem && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const n of res.notifications) {
        if (!n.readAt && !prevUnreadIds.has(n.id) && !shownIds.has(n.id)) {
          shownIds.add(n.id);
          const sys = new Notification(n.title, { body: n.body, tag: n.id });
          sys.onclick = () => void markRead([n.id]);
        }
      }
    }
  }

  async function markRead(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await api.markNotificationsRead(ids);
    await load();
  }

  async function markAllRead(): Promise<void> {
    await api.markAllNotificationsRead();
    await load();
  }

  /** 首次用户手势时调用（浏览器要求通知授权必须由手势触发） */
  async function ensurePermission(): Promise<void> {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  function startPolling(): void {
    if (timer) return;
    void load(false);
    timer = setInterval(() => void load(true).catch(() => undefined), POLL_INTERVAL_MS);
    window.addEventListener('focus', onFocus);
  }

  function stopPolling(): void {
    if (timer) clearInterval(timer);
    timer = null;
    window.removeEventListener('focus', onFocus);
  }

  function onFocus(): void {
    void load(false).catch(() => undefined);
  }

  return {
    items,
    unreadCount,
    load,
    markRead,
    markAllRead,
    ensurePermission,
    startPolling,
    stopPolling,
  };
});

/** 组合式便捷挂载：在根组件 setup 里调用，随组件卸载自动停止 */
export function useNotificationPolling(): void {
  const store = useNotificationStore();
  store.startPolling();
  onUnmounted(() => store.stopPolling());
}
