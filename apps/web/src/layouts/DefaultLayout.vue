<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { Notification as PaNotification } from '@pa/shared';
import { useNotificationPolling, useNotificationStore } from '../stores/notifications';

/**
 * 全局布局：顶栏（品牌 + 页面导航 + 通知铃铛）+ 内容区。
 * 各页面自带内部布局（如 ChatPage 的会话侧栏）。
 */
const notifications = useNotificationStore();
useNotificationPolling();

const panelOpen = ref(false);
/** 正在查看详情的通知（培训课程全文等） */
const detail = ref<PaNotification | null>(null);
/** 铃铛区域（含下拉面板），用于点击外部时判定是否关闭 */
const bellWrapRef = ref<HTMLElement | null>(null);

const navs = [
  { to: '/chat', label: '对话' },
  { to: '/tasks', label: '任务' },
  { to: '/knowledge', label: '知识库' },
  { to: '/research', label: '调研' },
  { to: '/settings', label: '设置' },
];

onMounted(() => {
  void notifications.load().catch(() => undefined);
  document.addEventListener('click', onDocClick);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
});

/** 下拉面板打开时，点击面板/铃铛以外任意处即关闭 */
function onDocClick(e: MouseEvent): void {
  const target = e.target as Node;
  if (panelOpen.value && bellWrapRef.value && !bellWrapRef.value.contains(target)) {
    panelOpen.value = false;
  }
}

async function togglePanel(): Promise<void> {
  panelOpen.value = !panelOpen.value;
  if (panelOpen.value) await notifications.ensurePermission();
}

function openDetail(n: PaNotification): void {
  if (n.content) detail.value = n;
  void notifications.markRead([n.id]);
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <RouterLink to="/chat" class="brand">Personal Agent</RouterLink>
      <nav class="nav">
        <RouterLink v-for="n in navs" :key="n.to" :to="n.to" class="nav-link" active-class="active">
          {{ n.label }}
        </RouterLink>
      </nav>

      <div ref="bellWrapRef" class="bell-wrap">
        <button class="bell" title="通知" @click="togglePanel">
          🔔
          <span v-if="notifications.unreadCount" class="badge">{{ notifications.unreadCount }}</span>
        </button>

        <div v-if="panelOpen" class="panel" @click.stop>
          <div class="panel-head">
            <strong>通知</strong>
            <button v-if="notifications.unreadCount" class="link-btn" @click="notifications.markAllRead()">
              全部已读
            </button>
          </div>
          <div class="panel-list">
            <p v-if="!notifications.items.length" class="panel-empty">暂无通知</p>
            <div
              v-for="n in notifications.items"
              :key="n.id"
              class="panel-item"
              :class="{ unread: !n.readAt, [n.type]: true }"
              @click="openDetail(n)"
            >
              <div class="item-title">
                <span class="dot" />
                {{ n.title }}
              </div>
              <div class="item-body">{{ n.body }}</div>
              <div class="item-time">{{ fmtTime(n.createdAt) }}</div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main class="content">
      <slot />
    </main>

    <!-- 通知详情（培训课程全文） -->
    <div v-if="detail" class="modal-mask" @click.self="detail = null">
      <div class="modal">
        <h3>{{ detail.title }}</h3>
        <div class="detail-text">{{ detail.content }}</div>
        <footer>
          <button class="btn" @click="detail = null">关闭</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 16px;
  height: 48px;
  border-bottom: 1px solid #e5e5e5;
  background: #fff;
  flex-shrink: 0;
}
.brand {
  font-weight: 700;
  color: #2c6ecb;
  text-decoration: none;
}
.nav {
  display: flex;
  gap: 4px;
  flex: 1;
}
.nav-link {
  padding: 5px 12px;
  border-radius: 6px;
  color: #555;
  text-decoration: none;
  font-size: 14px;
}
.nav-link:hover {
  background: #f2f4f7;
}
.nav-link.active {
  background: #e3ecfa;
  color: #2c6ecb;
  font-weight: 600;
}
.bell-wrap {
  position: relative;
}
.bell {
  position: relative;
  border: none;
  background: none;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.bell:hover {
  background: #f2f4f7;
}
.badge {
  position: absolute;
  top: 0;
  right: 0;
  background: #e5484d;
  color: #fff;
  font-size: 11px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 999px;
}
.panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: 360px;
  max-height: 480px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 20;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #eee;
}
.link-btn {
  border: none;
  background: none;
  color: #2c6ecb;
  cursor: pointer;
  font-size: 13px;
}
.panel-list {
  overflow-y: auto;
}
.panel-empty {
  color: #999;
  text-align: center;
  padding: 24px 0;
  font-size: 13px;
}
.panel-item {
  padding: 10px 14px;
  border-bottom: 1px solid #f2f2f2;
  cursor: pointer;
}
.panel-item:hover {
  background: #f8f9fb;
}
.panel-item .dot {
  display: none;
}
.panel-item.unread .dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2c6ecb;
  margin-right: 6px;
}
.item-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-item.error .item-title {
  color: #b33;
}
.item-body {
  font-size: 12px;
  color: #666;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-time {
  font-size: 11px;
  color: #aaa;
  margin-top: 4px;
}
.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}
.modal {
  background: #fff;
  border-radius: 10px;
  width: min(640px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
}
.modal h3 {
  margin: 0 0 12px;
}
.detail-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.7;
  overflow-y: auto;
  flex: 1;
}
.modal footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.btn {
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  padding: 6px 14px;
  cursor: pointer;
}
</style>
