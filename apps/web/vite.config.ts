import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需引入：模板组件 + ElMessage/ElMessageBox 等 API 自动导入，
    // 类型声明生成到 src/ 下（tsconfig include 覆盖）
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // 所有业务 API 走 /api 前缀，由 vite 代理到 Koa server
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
