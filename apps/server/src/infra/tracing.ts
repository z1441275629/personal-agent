/**
 * LangSmith 追踪接入 —— 必须作为 server 入口的第一个 import，
 * 保证在任何 LangChain 调用前把环境变量就位。
 *
 * 原理：@langchain/core 原生识别 LANGSMITH_* 环境变量并自动挂载
 * 追踪回调，业务代码零侵入。
 *
 * 配置来源优先级：shell 环境变量 > apps/server/.env（gitignored，存 apiKey）
 * >（均未配置时）设置页写入 settings.json 的 langsmith 段——该段一旦存在
 * 即优先生效（用户显式意图），由 applyLangsmithEnv 在启动/保存时映射到
 * 同样的环境变量，链路不变。
 */

const LANGSMITH_ENDPOINT_DEFAULT = 'https://api.smith.langchain.com';

// 1) 加载 .env（Node 内置能力；文件不存在则跳过；已有环境变量优先）
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    // 无 .env 文件属正常情况
  }
}

// 2) 归一化与默认值
if (process.env.LANGSMITH_TRACING === 'true') {
  if (!process.env.LANGSMITH_API_KEY) {
    console.warn('[tracing] LANGSMITH_TRACING=true 但未配置 LANGSMITH_API_KEY，追踪不会上报');
  } else {
    process.env.LANGSMITH_ENDPOINT ||= LANGSMITH_ENDPOINT_DEFAULT;
    // 注意：LANGSMITH_AGENT_*（Agent 环境）与 LANGSMITH_PROJECT（经典项目）
    // 是两种互斥的上报模式，langchain 检测到两者并存会拒绝追踪——
    // 因此仅在没有配置 AGENT_* 时才默认项目名。
    if (!process.env.LANGSMITH_PROJECT && !process.env.LANGSMITH_AGENT_ID) {
      process.env.LANGSMITH_PROJECT = 'personal-agent';
    }
    // 后台异步上报，避免追踪请求阻塞 SSE 流式响应
    process.env.LANGSMITH_CALLBACKS_BACKGROUND ||= 'true';
    const target = process.env.LANGSMITH_AGENT_ID
      ? `agent: ${process.env.LANGSMITH_AGENT_ID} (env: ${process.env.LANGSMITH_AGENT_ENVIRONMENT ?? 'local'})`
      : `project: ${process.env.LANGSMITH_PROJECT}`;
    console.log(`[tracing] LangSmith 已启用 → ${process.env.LANGSMITH_ENDPOINT} (${target})`);
  }
}

export interface LangsmithRuntimeConfig {
  tracing: boolean;
  endpoint: string;
  /** 解密后的明文 key（空 = 未配置） */
  apiKey: string;
  project: string;
}

/**
 * 设置页 langsmith 段 → LANGSMITH_* 环境变量（立即生效，无需重启）。
 * UI 即经典项目模式：启用时清掉 AGENT_* 变量避免互斥冲突。
 */
export function applyLangsmithEnv(cfg: LangsmithRuntimeConfig): void {
  if (!cfg.tracing) {
    process.env.LANGSMITH_TRACING = 'false'; // 设置页显式关闭优先于 .env
    console.log('[tracing] LangSmith 已停用（设置页）');
    return;
  }
  if (!cfg.apiKey) {
    console.warn('[tracing] 设置页已启用追踪但未配置 API Key，追踪不会上报');
  }
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGSMITH_API_KEY = cfg.apiKey;
  process.env.LANGSMITH_ENDPOINT = cfg.endpoint || LANGSMITH_ENDPOINT_DEFAULT;
  process.env.LANGSMITH_CALLBACKS_BACKGROUND ||= 'true';
  // UI 走经典项目模式，清掉 AGENT_*（与 LANGSMITH_PROJECT 互斥）
  delete process.env.LANGSMITH_AGENT_ID;
  delete process.env.LANGSMITH_AGENT_ENVIRONMENT;
  process.env.LANGSMITH_PROJECT = cfg.project || 'personal-agent';
  console.log(
    `[tracing] LangSmith 已启用（设置页） → ${process.env.LANGSMITH_ENDPOINT} (project: ${process.env.LANGSMITH_PROJECT})`,
  );
}
