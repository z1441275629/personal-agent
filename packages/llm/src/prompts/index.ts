import type { Memory } from '@pa/shared';

export interface SystemPromptInput {
  /** 长期记忆（已完成选取） */
  memories: Memory[];
  /** 上下文压缩产生的早期对话滚动摘要 */
  summary: string | null;
  /** 知识库文档名（引导模型在相关问题上调用 search_knowledge） */
  knowledgeDocNames?: string[];
}

/**
 * Agent 人格 + 注入记忆/摘要 + 工具使用守则。
 * 时间很关键（create_task 需要 cron），每次请求实时生成。
 */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const sections: string[] = [
    `你是用户的个人助理，运行在桌面应用中。用简洁自然的中文回答，称呼用户为"你"。`,
    `当前时间：${timeStr}。`,
  ];

  if (input.memories.length) {
    sections.push(
      [
        '## 长期记忆（关于用户的已知信息，回答时直接利用）',
        ...input.memories.map((m) => `- ${m.content}`),
      ].join('\n'),
    );
  }

  if (input.summary) {
    sections.push(`## 本会话早期对话摘要（更早的原文已压缩）\n${input.summary}`);
  }

  if (input.knowledgeDocNames?.length) {
    sections.push(
      [
        '## 用户知识库（已有文档）',
        input.knowledgeDocNames.map((n) => `- ${n}`).join('\n'),
        '与这些文档主题相关的问题，先调用 search_knowledge 检索再回答，不要凭空编造文档内容。',
      ].join('\n'),
    );
  }

  sections.push(
    [
      '## 工具使用守则',
      '- 用户明确让你记住某事，或提到值得长期记住的事实/偏好时：调用 save_memory。',
      '- 需要回忆用户信息而记忆区没有时：调用 recall_memories 查询。',
      '- 用户要求提醒/定时任务时：先用一两句话向用户复述任务内容（类型、时间、内容），再调用 create_task；cron 为标准 5 段格式（分 时 日 月 周），按当前时间推算，如"每天早上9点"= "0 9 * * *"。',
      '- 没有工具可用的普通问题直接回答，不要编造工具调用。',
    ].join('\n'),
  );

  return sections.join('\n\n');
}

/** 上下文压缩：把早期对话压成要点摘要的提示词 */
export function buildSummarizePrompt(previousSummary: string | null): string {
  const prev = previousSummary
    ? `已有摘要（把新内容合并进去，保持精炼）：\n${previousSummary}\n`
    : '';
  return [
    '请把下面的对话历史压缩成一份要点摘要，用于后续对话中保留上下文。要求：',
    '1. 保留关键事实、用户需求、已做出的决定和未完成事项；',
    '2. 500 字以内，用条目式；',
    '3. 不要寒暄和多余解释，直接输出摘要内容。',
    prev,
  ]
    .filter(Boolean)
    .join('\n');
}
