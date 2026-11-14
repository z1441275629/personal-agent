import { z } from 'zod';

/**
 * LangSmith 追踪配置（settings.json 的 langsmith 段）。
 * apiKey 在存储层可能是 safe:v1: 密文（见 server secure-store）；
 * API 层只下发掩码，更新时留空 = 保持原值。
 */
export const LANGSMITH_ENDPOINT_DEFAULT = 'https://api.smith.langchain.com';

export const LangsmithSettingSchema = z.object({
  tracing: z.boolean().default(false),
  endpoint: z.string().url().default(LANGSMITH_ENDPOINT_DEFAULT),
  /** 存储值：明文或 safe:v1: 密文；对外永不下发 */
  apiKey: z.string().default(''),
  /** 项目名（经典模式；AGENT_* 环境变量模式仍走 .env，不进 UI） */
  project: z.string().default(''),
});
export type LangsmithSetting = z.infer<typeof LangsmithSettingSchema>;
