import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 所有业务 API 走 /api 前缀，由 vite 代理到 Koa server
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
