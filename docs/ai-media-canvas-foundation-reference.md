# AI Media Canvas 底层参考说明

本文记录新应用需要参考 `/Users/niuma/code/ai-media-canvas` 的底层技术设计。这里不关注 AI Media Canvas 的上层业务逻辑，而关注它和普通前端仓库不同的地方：agent runtime、工具网关、skills、事件持久化、本地优先运行方式，以及对外部 agent 的接入面。

## 参考边界

新应用不是要修改 `ai-media-canvas` 仓库，而是参考它的底层架构重新实现自己的应用。参考重点包括：

- 本地优先的单机 Web App 形态。
- server 托管静态前端，同时提供 HTTP API、WebSocket、SQLite、本地资源访问。
- agent run 的统一生命周期管理。
- `server-deepagent` 与 `local-agent` 双 runtime 的抽象方式。
- local agent 通过受控 MCP/tool gateway 使用应用能力。
- workspace skills 的数据来源、注入和 materialize 方式。
- durable run/message/event store，用于断线恢复、审计、CLI 轮询。
- Tutti CLI manifest / `/tutti/cli/*` 作为外部 agent 接入面。

不需要参考的部分：

- AI Media Canvas 的具体画布业务、媒体生成业务、品牌套件业务。
- Web UI 的视觉设计和产品流程。
- 具体模型供应商选择，除非底层 runtime contract 需要。

## 总体运行形态

`ai-media-canvas` 是本地优先单机版应用，不是典型 SaaS 前后端分离项目。

底层形态是：

- `apps/web` 构建为静态产物。
- `apps/server` 用 Fastify 托管静态前端。
- 同一个 server 提供 `/api/*`、`/api/ws`、`/local-assets/*`、`/tutti/cli/*`。
- SQLite 作为本地持久化。
- 本地文件目录保存资源和 agent 运行产物。
- agent runtime 在 server 进程中被统一调度。

新应用如果对齐这个底层，应优先采用“一个本地服务承载完整应用”的模型，而不是一开始拆成复杂云端服务。

## Agent Run 分层

核心思想：不要让 UI 或业务 API 直接绑定某一个 agent 实现。

建议分层：

- `AgentRunService`：创建、取消、消费 run，维护内存中的 active run。
- `AgentRunOrchestrator`：负责 run/message/event 的产品语义，处理事件投影、持久化、发布、assistant message 更新。
- `Runtime Control Plane`：选择 runtime，处理 runtime 可用性、并发、health、lease。
- `Runtime Provider`：具体执行 agent，例如 `server-deepagent` 或 `local-agent:codex`。
- `Event Adapter`：把底层 agent events 统一映射为应用的 `StreamEvent`。

`ai-media-canvas` 中的运行时类型大致是：

- `server-deepagent`：服务端直接拥有 agent loop，使用 deepagents/LangChain 工具。
- `local-agent`：服务端启动用户本机 CLI agent，通过 `@tutti-os/agent-acp-kit` 适配 Codex、Claude 等 provider。

新应用应保留这类抽象，即使 P0 只实现一个 runtime，也不要把上层产品逻辑写死在某个 CLI 或 SDK 上。

## Local Agent 接入方式

local agent 不应直接获得应用内部权限或用户 token。参考做法：

1. server 为每个 run 创建临时 run 目录。
2. server 组装 prompt、system prompt、history、model、resume 信息。
3. server 将 workspace skills materialize 到 run 目录。
4. server 创建一个 run-scoped tool gateway session。
5. server 把 MCP server 配置注入 local agent。
6. local agent 通过 MCP stdio server 调工具。
7. MCP server 使用临时 token 转发到应用 server 的 tool gateway。
8. run 结束后 revoke token 并清理临时目录。

注意点：

- local agent 的 cwd 应是 per-run 临时目录。
- local agent 只能通过 tool gateway 使用业务能力。
- 不要把用户 access token、provider API key、数据库连接等直接塞进 CLI 环境。
- prompt 中可以告诉 agent 如何使用工具，但工具可用性必须由 gateway 控制。
- 本地 CLI provider 的 detect、launch、parser、resume 能力应放在独立 adapter/package 层。

## Tool Gateway

tool gateway 是 local agent 与应用内部能力之间的权限边界。

它需要负责：

- 创建 run-scoped session token。
- 按 run/session/canvas/user 上下文构造可用工具列表。
- 提供工具 manifest，暴露名称、描述、JSON schema。
- 校验 token 和工具名。
- 将 MCP tool call 转成内部工具调用。
- 统一规范化工具输出、错误、artifact。
- run 结束时 revoke session。

参考工具类型：

- inspect 类：读取当前应用状态。
- mutate 类：写入应用状态。
- generation/job 类：触发长任务并返回 job 或 artifact。
- persist 类：把 sandbox 文件转成持久资源。
- screenshot/verify 类：让 agent 可视化验证结果。

新应用的业务工具会不同，但边界应该一致：CLI agent 只能看到“被授权的工具 manifest”，不能越过 gateway 直接访问内部服务。

## Skills 机制

`ai-media-canvas` 的 skills 不是普通文档，而是产品能力数据源。

参考设计：

- 仓库内有 bundled skills。
- 启动或初始化时 seed 到本地 SQLite。
- workspace 里记录已安装、启用的 skills。
- agent run 时从 workspace DB 加载 enabled skills。
- deepagent runtime 通过虚拟只读路径暴露，例如 `/workspace-skills/<slug>/SKILL.md`。
- local-agent runtime materialize 到 runDir，例如 `workspace-skills/<slug>/SKILL.md`。
- system prompt 只注入 skill 摘要和读取路径，完整内容由 agent 按需读取。

注意点：

- skill source of truth 应在应用数据层，而不是用户全局 skills 目录。
- skill files 要做路径逃逸检查，不能写出 runDir。
- workspace skills 对 agent 应默认只读。
- skill delivery 可按 runtime 不同而不同，但数据源应统一。

## Event 与 Message 持久化

`ai-media-canvas` 对 agent run 做 durable persistence，这一点很重要。

核心表/概念：

- `agent_runs`：run 元数据、状态、runtime、provider、resume 信息、assistant message 绑定。
- `agent_run_events`：按 run seq 记录所有 stream event。
- canvas seq：按 canvas 维度记录事件顺序，用于断线 replay。
- assistant message anchor：run accepted 时先创建空 assistant message。
- streaming 过程中持续更新 assistant message 的 text/content blocks/run status。

这种设计解决：

- WebSocket 断线重连。
- CLI 无法直接使用 WS streaming 时的轮询。
- run audit/replay。
- 服务重启时将 interrupted runs 标记失败。
- assistant message 与 run 的稳定绑定。

新应用不要只在 run 结束后写 assistant message。应从 `accepted` 阶段就建立 durable anchor。

## WebSocket 与 CLI 两个入口

参考仓库有两个 agent 接入面：

- Web UI 使用 `/api/ws`，实时收发 command/event。
- 外部 agent/Tutti CLI 使用 `/tutti/cli/*`，通过 HTTP POST 调用。

WebSocket 适合：

- 前端实时 streaming。
- canvas/page 级 event push。
- reconnect 后 replay missed events。

CLI 适合：

- 外部本地 agent 发现应用能力。
- `agent run` 后通过 `agent events` 轮询。
- 不依赖 WebSocket streaming。

新应用如果要支持外部 agent，应生成：

- `tutti.app.json`
- `tutti.cli.json`
- `COMMANDS.md`

CLI manifest 中每个命令的 summary、description、required input 要足够自解释，因为 agent discovery 依赖这些字段，而不是完整阅读 `COMMANDS.md`。

## Backend / Sandbox 注意点

deepagents backend 的参考形态：

- 默认 backend 是 per-run sandbox。
- `/workspace/`、`/memories/`、`/skills/`、`/workspace-skills/` 使用 CompositeBackend 分路。
- `execute` 工具运行在 LocalShellBackend。
- 生产 state 模式下 workspace/memory 可走 StoreBackend。
- system/bundled skills 可以走只读 filesystem backend。
- workspace skills 是 per-run materialized readonly backend。

注意点：

- run sandbox 必须隔离。
- 文件工具的虚拟路径和真实 shell 路径不同，skill 文档中要讲清楚。
- 不要把绝对路径当成 agent 写文件默认方式。
- `execute` 类能力风险较高，需要独立考虑权限和环境变量。

## Resume 与 Runtime 选择

参考设计里 runtime 选择不是简单字符串判断。

需要考虑：

- 默认 runtime。
- 用户显式 requested runtime。
- model id 是否带 provider 前缀。
- local-agent 是否启用 trusted mode。
- provider 是否 detect 成功。
- 上一次 run 的 runtime/provider。
- resume mode：`fresh`、`provider-local`、`handoff`。

建议：

- 同 provider 继续时优先 provider-local resume。
- 跨 provider 时使用 handoff，让新 agent 以历史消息和当前状态为准。
- 不要假设不同 CLI provider 的 native resume token 可互通。

## 新应用开发时的对齐原则

后续在当前仓库开发新应用时，建议遵守：

- 先定义 shared contracts，再写 server/web。
- agent event schema 必须稳定。
- UI 不直接依赖某个 runtime 的原始事件。
- 所有业务工具都通过 manifest/schema 暴露给 agent。
- local agent 权限只来自 run-scoped gateway token。
- run/message/event 必须持久化，不能只靠内存。
- skills 数据源统一，delivery 按 runtime 适配。
- CLI route 是第二呈现面，不复制业务逻辑；应调用同一批 service/use-case。
- WebSocket replay 和 CLI polling 都基于同一份 event store。
- 配置项要能关闭 local-agent trusted mode。

## 可参考的 ai-media-canvas 关键文件

- `/Users/niuma/code/ai-media-canvas/apps/server/src/agent/runtime.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/agent/run-orchestrator.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/agent/runtimes/local-agent.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/agent/runtimes/server-deepagent.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/agent/local-agent-host/tool-gateway.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/agent/local-agent-host/tools-mcp.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/agent/local-agent-host/skills.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/agent/workspace-skills.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/local/store.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/ws/handler.ts`
- `/Users/niuma/code/ai-media-canvas/apps/server/src/http/tutti-cli.ts`
- `/Users/niuma/code/ai-media-canvas/scripts/package-tutti-app.mjs`
- `/Users/niuma/code/ai-media-canvas/packages/shared/src/events.ts`
- `/Users/niuma/code/ai-media-canvas/packages/shared/src/contracts.ts`
