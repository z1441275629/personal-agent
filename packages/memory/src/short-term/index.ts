import type { Message } from '@pa/shared';

/** 上下文预算：超过 maxChars 触发压缩；压缩时保留最近 keepRecent 条原文 */
export interface ContextBudget {
  maxChars: number;
  keepRecent: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxChars: 12_000,
  keepRecent: 6,
};

export function totalChars(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

/** 历史是否超出预算需要压缩 */
export function needsCompression(messages: Message[], budget = DEFAULT_CONTEXT_BUDGET): boolean {
  return totalChars(messages) > budget.maxChars;
}

/**
 * 压缩切分：早期消息交给摘要器，最近 keepRecent 条保留原文继续对话。
 * keepRecent 不足时全量保留（不压缩）。
 */
export function splitForCompression(
  messages: Message[],
  budget = DEFAULT_CONTEXT_BUDGET,
): { toSummarize: Message[]; recent: Message[] } {
  if (messages.length <= budget.keepRecent) {
    return { toSummarize: [], recent: messages };
  }
  const cut = messages.length - budget.keepRecent;
  return { toSummarize: messages.slice(0, cut), recent: messages.slice(cut) };
}
