import type { ProviderSetting } from '@pa/shared';

/**
 * OpenAI 兼容 /embeddings 调用（知识库向量化用）。
 * 只需 baseURL + apiKey —— 知识库的 embedding 是独立配置，不依赖对话 provider。
 * 注意：部分网关（如方舟 coding 计划端点）只代理对话模型、不支持 embeddings，
 * 调用方需捕获错误并降级到关键词检索。
 */
export async function embedTexts(
  provider: Pick<ProviderSetting, 'baseURL' | 'apiKey'>,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const base = provider.baseURL.replace(/\/+$/, '');
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')) as string;
    throw new Error(`embeddings 调用失败（${res.status}）: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
  };
  const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (data.length !== texts.length || data.some((d) => !Array.isArray(d.embedding))) {
    throw new Error(`embeddings 返回数量异常：期望 ${texts.length}，实际 ${data.length}`);
  }
  return data.map((d) => d.embedding as number[]);
}
