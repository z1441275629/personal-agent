import type { StructuredToolInterface } from '@langchain/core/tools';

/** 工具执行是否需要人工确认（HITL，第二阶段启用） */
export type HitlLevel = 'auto' | 'confirm';

/**
 * 项目工具条目 = LangChain 标准工具（tool() 创建，zod schema，
 * bindTools 时自动适配 OpenAI / Anthropic 协议）+ 项目元数据。
 */
export interface PaToolEntry {
  tool: StructuredToolInterface;
  /** confirm 级工具执行前暂停等待用户批准（阶段二） */
  hitl: HitlLevel;
  /** 来源：内置 / MCP 外部（阶段二） */
  source: 'builtin' | 'mcp';
}
