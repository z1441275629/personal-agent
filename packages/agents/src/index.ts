// @pa/agents — 智能体：base/chat/planner/executor 与注册表
// 依赖方向：只允许向下引用（见 docs/architecture.md）
export { runAgentLoop, type AgentStreamEvent, type RunAgentOptions } from './executor';
