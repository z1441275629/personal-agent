import type { Context, Next } from 'koa';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * web 静态资源中间件（生产模式）：
 * - /api/* 交给后续路由
 * - 命中文件 → 流式返回
 * - 未命中 → 回退 index.html（SPA history 路由）
 * - 带路径穿越防护
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function spaStatic(rootDir: string) {
  const root = path.resolve(rootDir);

  return async (ctx: Context, next: Next): Promise<void> => {
    if (ctx.method !== 'GET' || ctx.path.startsWith('/api')) {
      await next();
      return;
    }

    const rel = decodeURIComponent(ctx.path).replace(/^\/+/, '');
    let filePath = rel ? path.join(root, rel) : path.join(root, 'index.html');

    // 目录或不存在 → SPA 回退
    if (rel && (!existsSync(filePath) || statSync(filePath).isDirectory())) {
      filePath = path.join(root, 'index.html');
    }

    // 路径穿越防护：解析后必须仍在 root 内
    if (!path.resolve(filePath).startsWith(root + path.sep)) {
      ctx.status = 403;
      return;
    }

    ctx.type = MIME[path.extname(filePath)] ?? 'application/octet-stream';
    // 带哈希的构建产物可长缓存
    if (rel.startsWith('assets/')) {
      ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    ctx.body = createReadStream(filePath);
  };
}
