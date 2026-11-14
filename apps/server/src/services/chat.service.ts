import path from 'node:path';
import {
  conversationsRepo,
  initDb,
  messagesRepo,
} from '@pa/persistence';
import { streamChat } from '@pa/llm';
import type { ChatStreamEvent, Conversation, Message, ProviderSetting } from '@pa/shared';
import { env } from '../config';
import { settingsService } from './settings.service';

/** 与 settings.service 一致的 HTTP 错误约定（errorHandler 读 .status） */
function httpError(status: number, message: string): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
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

  removeConversation(id: string): void {
    this.getConversation(id);
    conversationsRepo.remove(id);
  },

  listMessages(conversationId: string): Message[] {
    this.getConversation(conversationId);
    return messagesRepo.listByConversation(conversationId);
  },

  /** 解析本次对话使用的 provider（指定 id 或第一个启用的） */
  resolveProvider(providerId?: string): ProviderSetting {
    const enabled = settingsService.listFull().filter((p) => p.enabled);
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
   * 流式回复：先落用户消息，逐段产出模型输出，完成后落 assistant 消息。
   * 调用方（SSE 路由）需先完成 getConversation / resolveProvider 校验。
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

    const history = messagesRepo.listByConversation(conversation.id);
    let full = '';
    try {
      for await (const text of streamChat(provider, history)) {
        full += text;
        yield { type: 'chunk', text };
      }
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    const assistantMsg = messagesRepo.create(conversation.id, 'assistant', full);
    conversationsRepo.touch(conversation.id);
    yield { type: 'done', assistantMessageId: assistantMsg.id };
  },
};
