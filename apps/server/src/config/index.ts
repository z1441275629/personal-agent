import { z } from 'zod';

/**
 * 环境变量解析（zod 校验 + 默认值）。
 * 所有配置统一从这里读，散落的 process.env 读取视为违规。
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CHROMA_URL: z.string().url().default('http://127.0.0.1:8000'),
  DATA_DIR: z.string().default('./data'),
  /** web 构建产物目录（生产模式由 desktop 的 server-manager 注入） */
  WEB_DIST_DIR: z.string().optional(),
  /** 上下文预算：对话历史超过该字符数时触发滚动摘要压缩 */
  CONTEXT_BUDGET_CHARS: z.coerce.number().int().positive().default(12_000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`环境变量校验失败:\n${parsed.error.message}`);
}

export const env = parsed.data;
export type Env = z.infer<typeof EnvSchema>;
