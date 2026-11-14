import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: { input: 'src/main/index.ts' },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: 'src/preload/index.ts' },
    },
  },
  // renderer 不单独构建：dev 时加载 http://localhost:5173（apps/web），
  // 生产模式的打包策略在业务阶段实现（见 docs/architecture.md 部署形态）
});
