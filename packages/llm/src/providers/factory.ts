import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { ProviderSetting, TestConnectionResponse } from '@pa/shared';

/**
 * 客户端工厂：按用户配置创建 LangChain 聊天模型。
 * 国内主流模型（豆包/DeepSeek/Qwen/Ollama…）均走 OpenAI 兼容协议，
 * 换 baseURL 即可；Anthropic 走官方协议。
 */
export function createChatModel(setting: ProviderSetting): ChatOpenAI | ChatAnthropic {
  if (setting.protocol === 'anthropic') {
    return new ChatAnthropic({
      apiKey: setting.apiKey,
      model: setting.model,
      anthropicApiUrl: setting.baseURL,
      maxRetries: 0,
    });
  }
  return new ChatOpenAI({
    apiKey: setting.apiKey,
    model: setting.model,
    configuration: { baseURL: setting.baseURL },
    maxRetries: 0,
  });
}

/** 真实调用一次模型，验证 baseURL/Key/模型名是否可用 */
export async function pingProvider(
  setting: ProviderSetting,
  timeoutMs = 20_000,
): Promise<TestConnectionResponse> {
  const start = Date.now();
  try {
    const model = createChatModel(setting);
    await model.invoke('ping', { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: true, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
