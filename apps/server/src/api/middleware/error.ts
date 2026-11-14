import type { Context, Next } from 'koa';

/**
 * 全局错误处理中间件（最外层）。
 * 业务错误约定：抛出带 status 的 Error（后续由 services 层细化错误类型）。
 */
export async function errorHandler(ctx: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (err) {
    const status = typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status: unknown }).status) || 500
      : 500;
    ctx.status = status;
    ctx.body = {
      error: status >= 500 ? 'INTERNAL_ERROR' : 'BUSINESS_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
    if (status >= 500) {
      console.error('[server] unhandled error:', err);
    }
  }
}
