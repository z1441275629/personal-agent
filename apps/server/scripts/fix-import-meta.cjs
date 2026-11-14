/**
 * esbuild CJS 产物补丁：esbuild 把依赖里的 `import.meta` 替换成 `{}`，
 * 导致 node-cron 的 daemon.js 在加载期执行 fileURLToPath(undefined) 崩溃。
 * 把空 shim 补上 url 字段（指向 bundle 自身 __filename）。
 * 若匹配不到说明 esbuild 行为变化，构建应失败而不是静默产出坏包。
 */
const fs = require('node:fs');

const file = process.argv[2];
if (!file) {
  console.error('用法: node fix-import-meta.cjs <bundle.cjs>');
  process.exit(1);
}

let code = fs.readFileSync(file, 'utf8');
const before = code;
code = code.replace(
  /var (import_meta\d*) = \{\};/g,
  'var $1 = { url: require("node:url").pathToFileURL(__filename).href };',
);
if (code === before) {
  console.error('[fix-import-meta] 未找到 import.meta shim（esbuild 行为变化？），拒绝产出坏包');
  process.exit(1);
}
fs.writeFileSync(file, code);
console.log('[fix-import-meta] 已补丁 import.meta.url shim');
