import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { Message, ProviderSetting } from '@pa/shared';
import type { PaToolEntry } from '@pa/tools';
import { chunkText, createChatModel, toLangChainMessages } from '@pa/llm';

/** agent 执行事件：文本增量 / 工具开始 / 工具结束 */
export type AgentStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'tool_start'; toolCallId: string; name: string; input: string }
  | { type: 'tool_result'; toolCallId: string; name: string; ok: boolean; output: string };

export interface RunAgentOptions {
  provider: ProviderSetting;
  /** system prompt（人格 + 记忆 + 摘要 + 工具守则，由调用方组装） */
  systemPrompt: string;
  /** 对话历史（已按预算裁剪） */
  history: Message[];
  /** 本轮可用的工具 */
  tools: PaToolEntry[];
}

/** 工具结果回填给 LLM 的展示截断 */
const TOOL_OUTPUT_PREVIEW = 400;

/**
 * LangChain agent 执行器：createReactAgent（LangGraph prebuilt）跑
 * 工具调用循环，以 ['messages','updates'] 双模式流式产出：
 *   - messages → 模型文本增量（chunk）
 *   - updates  → AIMessage.tool_calls（tool_start）/ ToolMessage（tool_result）
 * 工具执行失败由 LangChain ToolNode 捕获并回填错误文本，循环不会中断。
 */
export async function* runAgentLoop(
  options: RunAgentOptions,
): AsyncGenerator<AgentStreamEvent> {
  const { provider, systemPrompt, history, tools } = options;

  const llm = createChatModel(provider);
  const agent = createReactAgent({
    llm,
    tools: tools.map((entry) => entry.tool),
    prompt: systemPrompt,
  });

  const stream = await agent.stream(
    { messages: toLangChainMessages(history) },
    { streamMode: ['messages', 'updates'] },
  );

  for await (const [mode, payload] of stream) {
    if (mode === 'messages' && Array.isArray(payload)) {
      const [chunkMsg] = payload as unknown as [{ content?: unknown }];
      const text = chunkText(chunkMsg?.content);
      if (text) yield { type: 'chunk', text };
    } else if (mode === 'updates' && payload && typeof payload === 'object') {
      yield* toolEventsFromUpdate(payload as Record<string, unknown>);
    }
  }
}

/** 从 updates 载荷中抽取工具开始/结束事件 */
function* toolEventsFromUpdate(
  update: Record<string, unknown>,
): Generator<AgentStreamEvent> {
  for (const nodeOutput of Object.values(update)) {
    const record = nodeOutput as { messages?: unknown } | null;
    const messages = record?.messages;
    if (!Array.isArray(messages)) continue;
    for (const msg of messages) {
      if (msg instanceof AIMessage && Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          yield {
            type: 'tool_start',
            toolCallId: call.id ?? '',
            name: call.name,
            input: JSON.stringify(call.args ?? {}),
          };
        }
      } else if (msg instanceof ToolMessage) {
        yield {
          type: 'tool_result',
          toolCallId: msg.tool_call_id ?? '',
          name: msg.name ?? msg.tool_call_id ?? 'tool',
          ok: msg.status !== 'error',
          output: String(msg.content ?? '').slice(0, TOOL_OUTPUT_PREVIEW),
        };
      }
    }
  }
}
