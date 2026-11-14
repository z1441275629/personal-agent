import { z } from 'zod';

/**
 * LLM Provider 领域类型。
 * 预置模板（PROVIDER_PRESETS）供 Settings 页面下拉选择与 @pa/llm 工厂共用，
 * 因此放在 shared 而不是 @pa/llm —— 前端不依赖 langchain。
 */

/** 接入协议：国内主流模型基本都走 OpenAI 兼容协议 */
export const ProviderProtocolSchema = z.enum(['openai-compatible', 'anthropic']);
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

/** 预置模板（不可变，随代码发布） */
export const ProviderPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  protocol: ProviderProtocolSchema,
  baseURL: z.string().url(),
  defaultModel: z.string(),
  /** 建议模型列表（输入框 datalist 用，可自由填写） */
  models: z.array(z.string()),
  /** API Key 获取提示 */
  apiKeyHint: z.string().optional(),
});
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'o4-mini'],
    apiKeyHint: 'platform.openai.com 的 sk- 开头 Key',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
    apiKeyHint: 'console.anthropic.com 的 sk-ant- 开头 Key',
  },
  {
    id: 'doubao',
    label: '豆包（火山方舟）',
    protocol: 'openai-compatible',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6-250615',
    models: ['doubao-seed-1-6-250615', 'doubao-pro-32k', 'doubao-lite-32k'],
    apiKeyHint: '火山方舟控制台的 API Key；模型也可填接入点 ep-xxx',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-compatible',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    apiKeyHint: 'platform.deepseek.com 的 sk- 开头 Key',
  },
  {
    id: 'qwen',
    label: '通义千问（DashScope）',
    protocol: 'openai-compatible',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    apiKeyHint: 'DashScope 的 sk- 开头 Key',
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    protocol: 'openai-compatible',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: '',
    models: [],
    apiKeyHint: '任意 OpenAI 兼容服务（Ollama/vLLM/OneAPI 等）；本地服务 Key 可随意填',
  },
];

/** 用户配置的一条 provider（存储在 settings.json） */
export const ProviderSettingSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().min(1),
  name: z.string().min(1).max(50),
  protocol: ProviderProtocolSchema,
  baseURL: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  enabled: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;
