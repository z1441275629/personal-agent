/**
 * LangSmith 追踪接入 —— 必须作为 server 入口的第一个 import，
 * 保证在任何 LangChain 调用前把环境变量就位。
 *
 * 原理：@langchain/core 原生识别 LANGSMITH_* 环境变量并自动挂载
 * 追踪回调，业务代码零侵入。
 *
 * 配置来源优先级：shell 环境变量 > apps/server/.env（gitignored，存 apiKey）。
 * 后续开放给用户在设置页配置时：把 settings.json 的 langsmith 段
 * 在启动时映射到同样的环境变量即可，链路不变。
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

export {};
