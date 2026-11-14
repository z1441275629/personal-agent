import path from 'node:path';
import {
  conversationsRepo,
  initDb,
  memoriesRepo,
  messagesRepo,
} from '@pa/persistence';
import { runAgentLoop } from '@pa/agents';
import {
  buildSummarizePrompt,
  buildSystemPrompt,
  streamChat,
} from '@pa/llm';
import { needsCompression, selectMemories, splitForCompression } from '@pa/memory';
import type {
  ChatStreamEvent,
  Conversation,
  Message,
  ProviderSetting,
} from '@pa/shared';
import { env } from '../config';
import { settingsService } from './settings.service';
import { buildAgentTools } from './agent-tools.service';
import { mcpService } from './mcp.service';

/** 与 settings.service 一致的 HTTP 错误约定（errorHandler 读 .status） */
function httpError(status: number, message: string): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** 摘要长度上限（字符） */
const SUMMARY_MAX_CHARS = 2_000;

/** 早期对话 → 滚动摘要（合并已有摘要），LLM 生成 */
async function summarizeHistory(
  provider: ProviderSetting,
  messages: Message[],
  previousSummary: string | null,
): Promise<string> {
  const transcript = messages
    .map((m) => `${m.role === 'user' ? '用户' : '助理'}: ${m.content}`)
    .join('\n');
  const prompt = `${buildSummarizePrompt(previousSummary)}\n\n对话历史：\n${transcript}`;
  let out = '';
  for await (const text of streamChat(provider, [
    { id: 'summarize', conversationId: 'summarize', role: 'user', content: prompt, createdAt: Date.now() },
  ])) {
    out += text;
  }
  return out.trim().slice(0, SUMMARY_MAX_CHARS);
}

export const chatService = {
  /** 启动时初始化数据库（幂等） */
  init(): void {
    initDb(path.resolve(env.DATA_DIR));
  },

  listConversations(): Conversation[] {
    return conversationsRepo.list();
  },

  createConversation(title?: string): Conversation {
    return conversationsRepo.create(title);
  },

  getConversation(id: string): Conversation {
    const conv = conversationsRepo.get(id);
    if (!conv) throw httpError(404, `会话不存在: ${id}`);
    return conv;
  },

  /** 软删除：库里的行和消息都保留，只是不再对外可见 */
  removeConversation(id: string): void {
    this.getConversation(id);
    conversationsRepo.softRemove(id);
  },

  listMessages(conversationId: string): Message[] {
    this.getConversation(conversationId);
    return messagesRepo.listByConversation(conversationId);
  },

  /** 解析本次对话使用的 provider（指定 id 或第一个启用的）；apiKey 解密后返回 */
  async resolveProvider(providerId?: string): Promise<ProviderSetting> {
    const enabled = (await settingsService.listFull()).filter((p) => p.enabled);
    if (providerId) {
      const found = enabled.find((p) => p.id === providerId);
      if (!found) throw httpError(400, `provider 不存在或未启用: ${providerId}`);
      return found;
    }
    const first = enabled[0];
    if (!first) {
      throw httpError(400, '没有可用的模型服务，请先在「设置」页配置并启用 provider');
    }
    return first;
  },

  /**
   * Agent 流式回复：落用户消息 → 上下文压缩（超预算时）→ 记忆注入 →
   * LangChain agent 工具循环 → 落最终 assistant 文本。
   * 工具中间过程（tool_start/tool_result）透传给 SSE，但不持久化。
   */
  async *streamReply(
    conversation: Conversation,
    content: string,
    provider: ProviderSetting,
  ): AsyncGenerator<ChatStreamEvent> {
    // 首条消息时用内容前缀自动起标题
    if (conversation.title === '新对话') {
      conversationsRepo.rename(conversation.id, content.slice(0, 24));
    }

    const userMsg = messagesRepo.create(conversation.id, 'user', content);
    conversationsRepo.touch(conversation.id);
    yield { type: 'meta', conversationId: conversation.id, userMessageId: userMsg.id };

    // ---- ① 上下文管理：超预算时把早期消息压成滚动摘要，仅发最近部分 ----
    const history = messagesRepo.listByConversation(conversation.id);
    let summary = conversationsRepo.getSummary(conversation.id);
    let llmHistory = history;
    if (needsCompression(history, { maxChars: env.CONTEXT_BUDGET_CHARS, keepRecent: 6 })) {
      const { toSummarize, recent } = splitForCompression(history, {
        maxChars: env.CONTEXT_BUDGET_CHARS,
        keepRecent: 6,
      });
      if (toSummarize.length) {
        try {
          summary = await summarizeHistory(provider, toSummarize, summary);
          conversationsRepo.setSummary(conversation.id, summary);
          llmHistory = recent;
        } catch {
          // 摘要失败不阻塞对话：按原样发送全量历史
        }
      }
    }

    // ---- ② 记忆注入 + system prompt ----
    const memories = selectMemories(memoriesRepo.list(), content);
    const systemPrompt = buildSystemPrompt({ memories, summary });

    // ---- ③ LangChain agent 工具循环 ----
    let full = '';
    try {
      const events = runAgentLoop({
        provider,
        systemPrompt,
        history: llmHistory,
        tools: [...buildAgentTools(conversation.id), ...mcpService.listToolEntries(conversation.id)],
      });
      for await (const evt of events) {
        if (evt.type === 'chunk') {
          full += evt.text;
          yield { type: 'chunk', text: evt.text };
        } else {
          // tool_start / tool_result 直接透传
          yield evt;
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    const assistantMsg = messagesRepo.create(
      conversation.id,
      'assistant',
      full || '（本轮没有文本输出）',
    );
    conversationsRepo.touch(conversation.id);
    yield { type: 'done', assistantMessageId: assistantMsg.id };
  },
};
