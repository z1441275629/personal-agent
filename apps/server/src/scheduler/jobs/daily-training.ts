import { streamChat } from '@pa/llm';
import type { Message, Task } from '@pa/shared';
import type { NotificationDraft } from '@pa/persistence';
import { settingsService } from '../../services/settings.service';

/** 培训课程正文长度上限（防止模型超长输出塞爆通知表） */
const MAX_CONTENT_CHARS = 4_000;

function buildPrompt(topic: string): string {
  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  return [
    `你是一名私人培训教练。今天是 ${today}。`,
    `请围绕主题「${topic}」为学员生成今日的培训内容，要求：`,
    '1. 篇幅 200~400 字；',
    '2. 结构：一个核心概念讲解 + 一个具体例子 + 一道小练习（参考答案放在最后）；',
    '3. 每天的切入点要轮换（可按日期变化选不同角度），不要每次都讲同一套；',
    '4. 直接输出正文，不要客套话和标题。',
  ].join('\n');
}

/**
 * 每日培训任务：用第一个启用的 provider 生成当日课程，
 * 通知摘要取正文前 80 字，全文存 content 供前端查看。
 */
export async function runDailyTrainingJob(task: Task): Promise<NotificationDraft> {
  const topic = task.payload.topic ?? task.name;

  const provider = (await settingsService.listFull()).find((p) => p.enabled);
  if (!provider) {
    return {
      taskId: task.id,
      type: 'error',
      title: `「${task.name}」执行失败`,
      body: '没有可用的模型服务，请先在「设置」页配置并启用 provider',
    };
  }

  const prompt = buildPrompt(topic);
  const messages: Message[] = [
    { id: 'job', conversationId: 'job', role: 'user', content: prompt, createdAt: Date.now() },
  ];
  let full = '';
  for await (const text of streamChat(provider, messages)) {
    full += text;
  }
  full = full.trim().slice(0, MAX_CONTENT_CHARS);

  return {
    taskId: task.id,
    type: 'daily_training',
    title: `今日培训：${topic}`,
    // 长度截断统一由 runTask 的 clampText 处理，全文放 content
    body: full,
    content: full,
  };
}
