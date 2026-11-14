// @pa/llm — LLM 接入：provider 注册、客户端工厂、输出解析、提示词
// 依赖方向：只允许向下引用（见 docs/architecture.md）
export * from './providers/registry';
export * from './providers/factory';
