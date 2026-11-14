import { createRouter, createWebHistory } from 'vue-router';

/**
 * 五个页面与四大场景对应：
 *   Chat（对话/培训）· Knowledge（知识库管理）· Tasks（提醒任务）
 *   Research（后台调研）· Settings（LLM provider 配置）
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/chat' },
    { path: '/chat', component: () => import('../pages/ChatPage.vue') },
    { path: '/knowledge', component: () => import('../pages/KnowledgePage.vue') },
    { path: '/tasks', component: () => import('../pages/TasksPage.vue') },
    { path: '/research', component: () => import('../pages/ResearchPage.vue') },
    { path: '/settings', component: () => import('../pages/SettingsPage.vue') },
  ],
});

export default router;
