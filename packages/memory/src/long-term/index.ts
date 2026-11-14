import type { Memory } from '@pa/shared';

/**
 * 长期记忆选取：注入 system prompt 的记忆条目。
 * 无向量库阶段的打分策略：关键词命中（2 字以上片段）+ 近期加分，
 * 取分数最高的前 limit 条且总字符不超过 maxChars。
 */
export function selectMemories(
  all: Memory[],
  query: string,
  limit = 8,
  maxChars = 2_000,
): Memory[] {
  if (!all.length) return [];

  // 查询切成 2 字滑窗片段（中文友好），命中最多的加分
  const tokens = new Set<string>();
  const trimmed = query.replace(/\s+/g, '');
  for (let i = 0; i < trimmed.length - 1; i++) tokens.add(trimmed.slice(i, i + 2));
  const now = Date.now();

  const scored = all.map((m, idx) => {
    let hits = 0;
    for (const t of tokens) if (m.content.includes(t)) hits++;
    // 近期加分：30 天内线性衰减 0~5 分（按列表顺序近似时间序）
    const ageDays = (now - m.createdAt) / 86_400_000;
    const recency = Math.max(0, 5 * (1 - ageDays / 30));
    return { m, score: hits * 2 + recency - idx * 0.01 };
  });

  scored.sort((a, b) => b.score - a.score);

  const picked: Memory[] = [];
  let used = 0;
  for (const { m } of scored) {
    if (picked.length >= limit) break;
    if (used + m.content.length > maxChars) continue;
    picked.push(m);
    used += m.content.length;
  }
  // 注入时按创建时间正序，读起来更自然
  return picked.sort((a, b) => a.createdAt - b.createdAt);
}

/** 记忆列表 → prompt 注入文本 */
export function formatMemories(memories: Memory[]): string {
  if (!memories.length) return '';
  return memories.map((m) => `- ${m.content}`).join('\n');
}
