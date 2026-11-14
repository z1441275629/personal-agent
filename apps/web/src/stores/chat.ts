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
  /** 本轮工具调用步骤（渲染用，不持久化） */
  const toolSteps = ref<{ toolCallId: string; name: string; input: string; ok?: boolean; output?: string }[]>([]);
  /** 挂起中的 HITL 确认卡片（decided 后保留展示，随下一轮/切换清空） */
  const approvals = ref<
    {
      approvalId: string;
      name: string;
      input: Record<string, unknown>;
      decided?: 'approved' | 'rejected';
      error?: string;
    }[]
  >([]);
  /** 正在进行的流式请求（切换会话时中断前端消费；服务端照常落库） */
  let inflight: AbortController | null = null;

  function abortInflight(): void {
    inflight?.abort();
    inflight = null;
  }

  async function loadConversations(): Promise<void> {
    conversations.value = await api.fetchConversations();
  }

  /** 新会话：纯本地草稿，不落库；发首条消息时才由服务端创建 */
  function startNewChat(): void {
    abortInflight();
    activeId.value = null;
    messages.value = [];
    error.value = null;
    streamingText.value = '';
    toolSteps.value = [];
    approvals.value = [];
  }

  async function select(id: string): Promise<void> {
    abortInflight();
    activeId.value = id;
    error.value = null;
    streamingText.value = '';
    toolSteps.value = [];
    approvals.value = [];
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
    toolSteps.value = [];
    approvals.value = [];
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
      inflight = new AbortController();
      let assistantId: string | null = null;
      for await (const evt of api.sendMessage(
        {
          content,
          providerId,
          conversationId: convId ?? undefined,
        },
        inflight.signal,
      )) {
        if (evt.type === 'meta') {
          activeId.value = evt.conversationId;
          // 草稿转正：立刻刷新侧栏（此时已带自动标题）
          void loadConversations();
        } else if (evt.type === 'chunk') {
          streamingText.value += evt.text;
        } else if (evt.type === 'tool_start') {
          toolSteps.value = [
            ...toolSteps.value,
            { toolCallId: evt.toolCallId, name: evt.name, input: evt.input },
          ];
        } else if (evt.type === 'tool_result') {
          toolSteps.value = toolSteps.value.map((s) =>
            s.toolCallId === evt.toolCallId
              ? { ...s, ok: evt.ok, output: evt.output }
              : s,
          );
        } else if (evt.type === 'approval_request') {
          approvals.value = [
            ...approvals.value,
            {
              approvalId: evt.approvalId,
              name: evt.name,
              input: JSON.parse(evt.input) as Record<string, unknown>,
            },
          ];
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
      // 切换会话主动中断：静默收尾，不当作错误
      if ((e as { name?: string })?.name !== 'AbortError') {
        error.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      inflight = null;
      streaming.value = false;
      streamingText.value = '';
      // toolSteps 保留到切换会话/下一轮发送（同会话内可回看本轮工具轨迹）
    }
  }

  /**
   * HITL 决定：批准（edited 为修改后的参数，缺省用原参数）/拒绝。
   * 决定后服务端 resolve 挂起的工具 → SSE 继续推 tool_result 与后续文本。
   * 若审批已失效（超时自动拒绝），接口 404 → 卡片标记为已拒绝。
   */
  async function decideApproval(
    approvalId: string,
    approved: boolean,
    edited?: Record<string, unknown>,
  ): Promise<void> {
    const target = approvals.value.find((a) => a.approvalId === approvalId);
    if (!target || target.decided) return;
    try {
      await api.decideApproval(approvalId, {
        approved,
        input: approved ? (edited ?? target.input) : undefined,
      });
      target.decided = approved ? 'approved' : 'rejected';
      target.error = undefined;
    } catch (e) {
      // 404 = 服务端已超时自动拒绝：本地同步为已拒绝态
      target.decided = 'rejected';
      target.error = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    conversations,
    activeId,
    messages,
    streaming,
    streamingText,
    toolSteps,
    approvals,
    error,
    loadConversations,
    startNewChat,
    select,
    removeConversation,
    send,
    decideApproval,
  };
});
