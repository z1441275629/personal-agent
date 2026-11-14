import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { Message, ProviderSetting } from '@pa/shared';
import { createChatModel } from './providers/factory';

/** 领域消息 → LangChain 消息 */
export function toLangChainMessages(messages: Message[]): BaseMessage[] {
  return messages.map((m) => {
    switch (m.role) {
      case 'user':
        return new HumanMessage(m.content);
      case 'assistant':
        return new AIMessage(m.content);
      default:
        return new SystemMessage(m.content);
    }
  });
}

/** 兼容 string / content blocks 两种 chunk 内容形态，抽取纯文本 */
function chunkText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part !== null && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** 流式对话：逐段 yield 模型输出的文本增量 */
export async function* streamChat(
  setting: ProviderSetting,
  messages: Message[],
  options?: { signal?: AbortSignal },
): AsyncGenerator<string> {
  const model = createChatModel(setting);
  const stream = await model.stream(toLangChainMessages(messages), {
    signal: options?.signal,
  });
  for await (const chunk of stream) {
    const text = chunkText(chunk.content);
    if (text) yield text;
  }
}
