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

  /** 新会话：纯本地草稿，不落库；发首条消息时才由服务端创建 */
  function startNewChat(): void {
    activeId.value = null;
    messages.value = [];
    error.value = null;
    streamingText.value = '';
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
      // 删除当前会话 → 回到新会话草稿（服务端是软删除，数据仍在库里）
      startNewChat();
    }
  }

  /**
   * 发送消息：本地先追加 user 消息，流式拼接 assistant 文本。
   * activeId 为 null（草稿）时不带 conversationId，服务端创建会话后
   * 从 meta 事件取回真实 id；完成后刷新消息与会话列表（拿到自动标题）。
   */
  async function send(content: string, providerId?: string): Promise<void> {
    if (streaming.value) return;
    const convId = activeId.value;

    error.value = null;
    streaming.value = true;
    streamingText.value = '';
    messages.value = [
      ...messages.value,
      {
        id: `local-${Date.now()}`,
        conversationId: convId ?? 'draft',
        role: 'user',
        content,
        createdAt: Date.now(),
      },
    ];

    try {
      let assistantId: string | null = null;
      for await (const evt of api.sendMessage({
        content,
        providerId,
        conversationId: convId ?? undefined,
      })) {
        if (evt.type === 'meta') {
          activeId.value = evt.conversationId;
          // 草稿转正：立刻刷新侧栏（此时已带自动标题）
          void loadConversations();
        } else if (evt.type === 'chunk') {
          streamingText.value += evt.text;
        } else if (evt.type === 'done') {
          assistantId = evt.assistantMessageId;
        } else if (evt.type === 'error') {
          error.value = evt.message;
        }
      }
      if (assistantId && activeId.value) {
        // 用服务器持久化的完整数据刷新（拿到真实 id/时间戳与自动标题）
        messages.value = await api.fetchMessages(activeId.value);
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
    startNewChat,
    select,
    removeConversation,
    send,
  };
});
