import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Conversation, Message } from '@pa/shared';
import * as api from '../api/chat';

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([]);
  const activeId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const streaming = ref(false);
  const error = ref<string | null>(null);
  /** 正在流式生成的 assistant 文本（渲染用） */
  const streamingText = ref('');

  async function loadConversations(): Promise<void> {
    conversations.value = await api.fetchConversations();
  }

  async function newConversation(): Promise<Conversation> {
    const conv = await api.createConversation();
    conversations.value = [conv, ...conversations.value];
    await select(conv.id);
    return conv;
  }

  async function select(id: string): Promise<void> {
    activeId.value = id;
    error.value = null;
    streamingText.value = '';
    messages.value = await api.fetchMessages(id);
  }

  async function removeConversation(id: string): Promise<void> {
    await api.deleteConversation(id);
    conversations.value = conversations.value.filter((c) => c.id !== id);
    if (activeId.value === id) {
      activeId.value = null;
      messages.value = [];
      const next = conversations.value[0];
      if (next) await select(next.id);
    }
  }

  /**
   * 发送消息：本地先追加 user 消息，流式拼接 assistant 文本，
   * 完成后以服务器返回的真实 id 刷新消息列表。
   */
  async function send(content: string, providerId?: string): Promise<void> {
    const convId = activeId.value;
    if (!convId || streaming.value) return;

    error.value = null;
    streaming.value = true;
    streamingText.value = '';
    messages.value = [
      ...messages.value,
      {
        id: `local-${Date.now()}`,
        conversationId: convId,
        role: 'user',
        content,
        createdAt: Date.now(),
      },
    ];

    try {
      let assistantId: string | null = null;
      for await (const evt of api.sendMessage(convId, { content, providerId })) {
        if (evt.type === 'chunk') {
          streamingText.value += evt.text;
        } else if (evt.type === 'done') {
          assistantId = evt.assistantMessageId;
        } else if (evt.type === 'error') {
          error.value = evt.message;
        }
      }
      if (assistantId) {
        // 用服务器持久化的完整数据刷新（拿到真实 id/时间戳与自动标题）
        messages.value = await api.fetchMessages(convId);
        await loadConversations();
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      streaming.value = false;
      streamingText.value = '';
    }
  }

  return {
    conversations,
    activeId,
    messages,
    streaming,
    streamingText,
    error,
    loadConversations,
    newConversation,
    select,
    removeConversation,
    send,
  };
});
