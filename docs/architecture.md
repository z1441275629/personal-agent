# 架构说明

## 1. 总体形态

个人助理的四个场景（每日培训、出题检查、定时提醒、后台调研）都要求核心逻辑在
**常驻服务进程**中运行——手机/桌面锁屏时它依然在工作。因此系统拆成三部分：

```
┌─────────────────────────────────────────────────┐
│  apps/desktop（Electron 壳）                     │
│  窗口/托盘/开机自启/原生通知/sidecar 进程管理      │
│  ┌───────────────────────────────────────────┐  │
│  │  renderer = apps/web（Vue3，与浏览器共用）  │  │
│  └───────────────────┬───────────────────────┘  │
└──────────────────────┼──────────────────────────┘
                       │ HTTP (127.0.0.1:8787)
┌──────────────────────▼──────────────────────────┐
│  apps/server（Koa，独立可运行）                   │
│  API 路由 · services 编排 · scheduler(cron)       │
│  events 事件桥 → desktop 原生通知                 │
├─────────────────────────────────────────────────┤
│  packages/（领域层，纯 TS 库）                    │
│  workflows → agents → llm/tools/memory           │
│            → retrieval/persistence → shared/infra│
└──────────────────────┬──────────────────────────┘
                       │ HTTP / client
              ┌────────▼────────┐
              │  Chroma 服务     │（docker 或 sidecar）
              └─────────────────┘
```

**关键设计：`apps/server` 不依赖 Electron**。它可以：
- 被 desktop 作为子进程拉起（日常模式）
- 直接 `pnpm --filter @pa/server start` 独立运行（开发模式）
- 整体部署到云服务器（将来做移动端/PWA，业务代码零改动）

## 2. 分层与依赖方向

```
app(main.ts)                         # 进程组装
  └─ api/routes → services           # 协议转换 → 用例编排
                   └─ packages/workflows    # 多步任务（LangGraph）
                       └─ packages/agents   # 单个智能体
                           ├─ packages/llm        # 模型调用
                           ├─ packages/tools      # 能力（含 rag 薄封装）
                           │    └─ packages/retrieval
                           └─ packages/memory
packages/persistence                 # 关系型数据（会话、任务）
packages/shared                      # 跨端类型与 API 契约（唯一被所有层引用）
packages/infra                       # logger / chroma / http / fs
```

规则：
1. **只许向下依赖**，任何反向 import 都视为 bug。
2. `shared` 不依赖任何包；`infra` 只依赖 `shared`。
3. `tools` 对 `retrieval` 的依赖是允许的（rag 工具是检索子系统的薄封装）。
4. 跨层传递数据一律用 `shared` 里的类型（Message / AgentState / ToolResult），
   防止循环导入——这是 agent 项目最常见的死法。

## 3. 模块职责

| 包/应用 | 职责 | 关键文件 |
|---|---|---|
| `apps/server` | HTTP API、cron 调度、事件桥 | `main.ts` `app.ts` `scheduler/` |
| `apps/web` | 全部 UI；五个页面（Chat/Knowledge/Tasks/Research/Settings） | `pages/` `stores/` |
| `apps/desktop` | 窗口生命周期、托盘、通知、自启、拉起 server+chroma | `src/main/*-manager.ts` |
| `@pa/shared` | API 契约（前后端同构）、领域类型、常量 | `api-contracts/` `domain/` |
| `@pa/infra` | pino 日志、Chroma 客户端、fetch 封装 | `logger.ts` `chroma.ts` |
| `@pa/llm` | provider 注册表（预置 OpenAI/Anthropic/豆包/DeepSeek/Qwen 模板 + 自定义 baseURL）、客户端工厂 | `providers/` |
| `@pa/tools` | 工具基类（名称/描述/schema/execute）+ 注册表 + 内置工具 | `base/` `registry.ts` |
| `@pa/agents` | Agent 基类与四个实现；从 registry 组装 | `base/` |
| `@pa/workflows` | LangGraph 图：agent 循环、planner-executor、调研 | `agent-loop/` 等 |
| `@pa/memory` | 短期（会话内）、长期（Chroma 向量）、情景（事件记忆） | 三个子目录 |
| `@pa/retrieval` | 文档切分、嵌入索引、检索器、RAG 管线 | `pipeline/` |
| `@pa/guardrails` | 输入校验、输出过滤（接 LLM 前后） | `validators/` |
| `@pa/persistence` | 会话/任务/知识库元数据的持久化（SQLite 系，待选型） | `entities/` |

## 4. LLM Provider 配置（用户可配置）

- `apps/web` Settings 页面 → `@pa/shared` 的 `ProviderSetting` 类型 →
  server `settings.service` 存本地 JSON。
- `@pa/llm/providers/registry.ts` 预置模板：OpenAI、Anthropic、Doubao、
  DeepSeek、Qwen（多为 OpenAI 兼容协议，换 baseURL 即可）+ 自定义模板。
- API Key 在 desktop 模式经 Electron `safeStorage` 加密落盘；
  纯 server 模式退化为本地配置文件（仅个人使用）。

## 5. 通知链路

```
scheduler(jobs/) ──触发──▶ events 事件桥 ──IPC/子进程 stdout──▶ desktop notifications.ts ──▶ OS 原生通知
```
纯浏览器开发模式下退化为 web UI 内提示。

## 6. 部署形态

| 形态 | 组成 | 场景 |
|---|---|---|
| desktop | desktop + server + chroma sidecar | 日常使用（当前目标） |
| dev | server(tsx) + web(vite) + chroma(docker) | 开发 |
| cloud | server + chroma（docker/Dockerfile.server） | 将来移动端/PWA 复用 |
