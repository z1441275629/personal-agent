# personal-agent

桌面个人助理：每日知识培训、学习效果检查、定时提醒、后台调研交付。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 45（托盘常驻、原生通知、开机自启、sidecar 进程管理） |
| 前端 | Vue 3 + Vue Router + Pinia + Vite |
| 后端 | Koa 3 + @koa/router |
| Agent | LangChain.js 1.x + LangGraph.js 1.x |
| 向量库 | Chroma（docker 独立部署或 desktop sidecar） |
| Monorepo | pnpm workspace + TypeScript |

## 目录结构

```
personal-agent/
├── apps/
│   ├── server/                  # Koa 后端：API + 调度器 + 事件桥
│   │   └── src/
│   │       ├── main.ts          # 启动入口
│   │       ├── app.ts           # Koa 实例组装（中间件 → 路由）
│   │       ├── api/             # HTTP 层
│   │       │   ├── routes/      # health/chat/settings/tasks/knowledge/agent
│   │       │   └── middleware/  # error/logger/cors
│   │       ├── services/        # 用例编排层（chat/settings/task）
│   │       ├── scheduler/       # node-cron 注册中心 + jobs/
│   │       ├── events/          # 事件桥（server → desktop 原生通知）
│   │       ├── infra/           # chroma 连接、http 客户端
│   │       └── config/          # env 解析（zod）+ LLM provider 模板
│   ├── web/                     # Vue3 前端（浏览器 / Electron 共用）
│   │   └── src/
│   │       ├── api/             # 后端 API 调用封装
│   │       ├── pages/           # Chat/Knowledge/Tasks/Research/Settings
│   │       ├── stores/          # Pinia（chat/settings/task）
│   │       ├── composables/     # useChat 等
│   │       ├── layouts/  components/  router/  styles/  types/
│   └── desktop/                 # Electron 壳
│       └── src/
│           ├── main/            # 窗口、托盘、自启、通知、server/chroma 进程管理
│           └── preload/         # contextBridge 安全暴露
├── packages/                    # 领域包（纯 TS 库，只导出源码）
│   ├── shared/                  # API 契约、领域类型（Message/AgentState/ToolResult）、常量
│   ├── infra/                   # logger(pino)、chroma 客户端、http、fs
│   ├── llm/                     # provider 注册表、客户端工厂、输出解析、提示词
│   ├── tools/                   # 工具基类、注册表、内置工具（web-search/rag/calculator）
│   ├── agents/                  # base/chat/planner/executor + 注册表
│   ├── workflows/               # agent-loop、planner-executor、research
│   ├── memory/                  # 短期 / 长期(Chroma) / 情景记忆
│   ├── retrieval/               # 切分、索引、检索器、RAG 管线
│   ├── guardrails/              # 输入输出校验与过滤
│   └── persistence/             # 实体、仓储、迁移
├── docker/                      # chroma compose + server Dockerfile
├── docs/                        # architecture.md 等设计文档
├── scripts/
└── .github/workflows/ci.yml
```

## 分层依赖规则（强约束）

```
api → workflows → agents → llm / tools / memory
                        ↘ retrieval / persistence
所有层 → shared / infra（基础设施）
```

只允许向下依赖，禁止反向引用。详见 [docs/architecture.md](docs/architecture.md)。

## 快速开始

```bash
# 1. 启用 pnpm（任选其一）
corepack enable            # Node 自带
# 或 npm install -g pnpm

# 2. 安装依赖
pnpm install

# 3. 起 Chroma（开发期用 docker；desktop 模式将来由 sidecar 拉起）
pnpm chroma

# 4. 同时起 server + web
pnpm dev
#    server → http://127.0.0.1:8787/health
#    web    → http://localhost:5173

# 5. 桌面壳（另开终端）
pnpm dev:desktop
```

## 路线图

1. **地基**（当前）：monorepo 骨架 + 全链路跑通 + provider 配置
2. **培训**：文档导入 → Chroma → 每日培训内容 + 出题
3. **提醒**：cron 任务 + 原生通知 + 任务管理
4. **调研**：planner-executor 工作流，异步执行 + 完成通知
