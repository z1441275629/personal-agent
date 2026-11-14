import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PaToolEntry } from '@pa/tools';
import { formatMemories, selectMemories } from '@pa/memory';
import { memoriesRepo } from '@pa/persistence';
import { taskService } from './task.service';
import { approvalService } from './approval.service';

/**
 * Agent 内置工具集：LangChain tool() + zod schema 定义，
 * bindTools 时自动适配 provider 协议。
 * 依赖仓储/服务的工具在这里组装（packages/tools 只放框架，保持依赖方向）。
 * 每次对话请求构建新实例（闭包携带 conversationId 作为记忆来源）。
 */

/**
 * HITL 包装：confirm 级工具执行前挂起等待用户批准（可改参数），
 * 拒绝/超时返回提示文本（作为工具结果回填给模型，循环不中断）。
 * MCP 工具（mcp.service）同样复用。
 */
export function withApproval<T extends Record<string, unknown>>(
  conversationId: string,
  name: string,
  fn: (args: T) => string | Promise<string>,
): (args: T) => Promise<string> {
  return async (args: T) => {
    const decision = await approvalService.request({
      conversationId,
      toolName: name,
      input: args,
    });
    if (!decision.approved) {
      const suffix = decision.reason === 'timeout' ? '（等待超时，已自动拒绝）' : '';
      return `用户拒绝执行「${name}」${suffix}。请勿继续该操作，向用户确认是否需要调整。`;
    }
    // 批准且用户改过参数 → 用修改后的参数执行
    return fn((decision.input ?? args) as T);
  };
}

export function buildAgentTools(conversationId: string): PaToolEntry[] {
  const getTime = tool(
    () =>
      new Date().toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    {
      name: 'get_time',
      description: '获取当前本地时间（年月日星期、时分），用于推算 cron 等时间参数',
      schema: z.object({}),
    },
  );

  const saveMemory = tool(
    ({ content, type }) => {
      const m = memoriesRepo.create({ content, type, sourceConversationId: conversationId });
      return `已保存记忆：${m.content}`;
    },
    {
      name: 'save_memory',
      description:
        '保存一条长期记忆。用户明确要求记住某事，或提到值得长期记住的事实/偏好时调用。一次只记一件事。',
      schema: z.object({
        content: z.string().describe('记忆内容，一条一个事实，用第三人称描述用户'),
        type: z
          .enum(['fact', 'preference', 'note'])
          .default('fact')
          .describe('类型：fact=事实， preference=偏好，note=笔记'),
      }),
    },
  );

  const recallMemories = tool(
    ({ query }) => {
      const picked = selectMemories(memoriesRepo.list(), query, 10, 3_000);
      return picked.length ? formatMemories(picked) : '（没有找到相关记忆）';
    },
    {
      name: 'recall_memories',
      description: '按关键词查询长期记忆，返回与查询最相关的记忆条目。',
      schema: z.object({
        query: z.string().describe('查询关键词，例如"宠物 项目 偏好"'),
      }),
    },
  );

  const createTaskArgs = z.object({
    type: z.enum(['reminder', 'daily_training']).describe('reminder=提醒，daily_training=每日培训'),
    name: z.string().describe('任务名称，简短（如：喂猫提醒）'),
    cron: z.string().describe('5 段 cron：分 时 日 月 周'),
    text: z.string().optional().describe('提醒内容（type=reminder 时必填）'),
    topic: z.string().optional().describe('培训主题（type=daily_training 时必填）'),
  });
  type CreateTaskArgs = z.infer<typeof createTaskArgs>;

  const createTask = tool(
    withApproval<CreateTaskArgs>(conversationId, 'create_task', (args) => {
      try {
        const task = taskService.create({
          type: args.type,
          name: args.name,
          cron: args.cron,
          payload: args.type === 'reminder' ? { text: args.text } : { topic: args.topic },
          enabled: true,
        });
        return `任务已创建：「${task.name}」计划 ${task.cron}（可在任务页查看）`;
      } catch (err) {
        return `创建失败：${err instanceof Error ? err.message : String(err)}`;
      }
    }),
    {
      name: 'create_task',
      description:
        '创建定时任务（提醒或每日培训）。执行前会弹出确认卡片等用户批准（用户可修改参数）。cron 为标准 5 段格式：分 时 日 月 周（如每天9点 = "0 9 * * *"）。',
      schema: createTaskArgs,
    },
  );

  return [
    { tool: getTime, hitl: 'auto', source: 'builtin' },
    { tool: saveMemory, hitl: 'auto', source: 'builtin' },
    { tool: recallMemories, hitl: 'auto', source: 'builtin' },
    // HITL 确认卡片：执行前挂起，等用户批准（可改参数）/拒绝，超时自动拒绝
    { tool: createTask, hitl: 'confirm', source: 'builtin' },
  ];
}
