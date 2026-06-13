# 底层与 Infra 模块

本文定义 `group-chat` 的底层模块边界。底层能力必须对齐 `docs/ai-media-canvas-foundation-reference.md`：本地 server、SQLite、durable run/message/event store、WebSocket replay、agent runtime 抽象、run-scoped tool gateway、workspace skills。Nextop CLI gateway 是后续阶段预留入口，本期不实现。

## 模块总览

```text
Web UI
  -> HTTP API / WebSocket
    -> Application Use Cases
      -> Domain Services
      -> Agent Run Orchestrator
      -> Event Store
      -> SQLite Repositories
      -> Local Asset Store
      -> Tool Gateway
      -> Runtime Providers
Future Nextop CLI
  -> deferred external routes
    -> same Application Use Cases
```

入口可以不同，业务能力只能有一份。

## Local App Server

职责：

- 托管 `apps/web` 静态产物。
- 提供 `/api/*` HTTP API。
- 提供 `/api/ws` WebSocket。
- 提供 `/local-assets/*` 本地资源访问。
- 启动时初始化 SQLite、seed bundled skills、恢复或终止中断 run。

非职责：

- 不把 UI session 状态放在 server 单例内。
- 不让 route handler 直接拼 prompt 或直接调用 runtime。

## SQLite Store

职责：

- 管理 migrations。
- 提供 transaction helper。
- 保存本地优先数据：room、conversation、participant、message、message_block、agent_run、agent_run_event、tool_session、skill、artifact、settings。
- 服务重启后能恢复可审计状态。

建议表族：

- `conversations` / `conversation_participants`
- `messages` / `message_blocks`
- `agent_runs` / `agent_run_events`
- `skills` / `workspace_skills`
- `tool_gateway_sessions`
- `artifacts` / `local_assets`
- `providers` / `runtime_profiles`
- `app_settings`

## Durable Event Store

职责：

- 以 run seq 记录 agent stream event。
- 以 conversation seq 或 app seq 支持 WebSocket replay。
- 为 CLI polling 提供稳定游标。
- 在 run accepted 阶段创建 assistant message anchor，并持续投影 message block/status。

事件类型先统一到 shared schema，例如：

- `run.accepted`
- `run.started`
- `run.delta`
- `run.tool_call.created`
- `run.tool_call.updated`
- `run.artifact.created`
- `run.message.updated`
- `run.completed`
- `run.failed`
- `run.cancelled`

## Agent Run Service

职责：

- 创建 run。
- 取消 run。
- 查询 active run。
- 管理内存中的 active run controller。
- 把 run 请求交给 orchestrator。

边界：

- 不理解聊天室发言策略。
- 不直接更新 UI 消息内容。
- 不选择具体参与者。

## Agent Run Orchestrator

职责：

- 接收业务侧的 `AgentInvocation`。
- 创建 run 记录和 assistant message anchor。
- 调 runtime control plane 选择 provider。
- 消费 runtime events。
- 写入 event store。
- 投影 message/message_block 状态。
- 发布 WebSocket event。
- 结束时清理 run-scoped token 和临时目录。

这是底座和聊天业务最关键的连接点。

## Runtime Control Plane

职责：

- 根据 request runtime、model id、provider prefix、上次 run 信息选择 runtime。
- 判断 provider 是否可用。
- 管理并发、lease、health。
- 处理 resume mode：`fresh`、`provider-local`、`handoff`。

P0 可以只实现一个可用 runtime，但上层 contract 必须保留 runtime/provider 字段。

## Runtime Providers

统一接口：

```text
createRun(input) -> AsyncIterable<RuntimeEvent>
cancel(runId)
detect()
resume?(resumeToken)
```

建议 provider：

- `server-deepagent`：server 内 agent loop。
- `local-agent:codex`：通过 local CLI agent 运行。
- `local-agent:claude`：同一 adapter 层扩展。

聊天室业务不直接调用具体 SDK/CLI。

## Local Agent Host

职责：

- 为每个 run 创建临时 run directory。
- materialize enabled workspace skills。
- 注入 MCP server 配置。
- 启动 local agent CLI。
- 解析 local agent 输出为统一 runtime event。
- run 结束后 revoke token 并清理临时目录。

安全约束：

- local agent cwd 必须是 per-run 临时目录。
- 不把用户 token、provider key、数据库连接直接塞进 CLI 环境。
- CLI agent 只能通过 tool gateway 使用应用能力。

## Tool Gateway

职责：

- 创建 run-scoped session token。
- 根据 run/conversation/participant/user context 构造工具 manifest。
- 暴露 tool name、description、JSON schema。
- 校验 token、工具名和输入 schema。
- 把 MCP tool call 转成内部 use-case 调用。
- 规范化 output、error、artifact。
- run 结束时 revoke session。

工具类型：

- inspect：读取聊天室状态、消息、参与者、skills。
- mutate：创建消息、改标题、更新参与者、保存设置。
- generation/job：触发外部生成任务。
- persist：把 run sandbox 文件转成本地 artifact。
- screenshot/verify：给 agent 可视化验证 UI 或产物。

## Skills Service

职责：

- 管理 bundled skills。
- 初始化 seed 到 SQLite。
- 管理 workspace enabled skills。
- 为不同 runtime 提供 delivery：
  - server runtime：虚拟只读路径。
  - local agent：materialize 到 runDir。
- system prompt 只注入 skill 摘要和读取路径。

约束：

- skill source of truth 是应用数据层。
- materialize 时必须做路径逃逸检查。
- workspace skills 对 agent 默认只读。

## Conversation Application Services

职责：

- 创建/更新/删除 conversation。
- 添加/移除/reorder participant。
- 管理发言策略。
- 解析 @ mention。
- 创建 user message。
- 根据策略创建一批 `AgentInvocation`。
- 管理托管讨论/自动续聊。

它们调用 Agent Run Service，但不直接消费 runtime 原始事件。

## Provider And Credential Service

职责：

- 管理 runtime profile、model catalog、model capability。
- 保存用户配置。
- 提供 capability 查询：vision、tool use、reasoning、streaming。
- 对 API key 做本地加密或接入系统 keychain。

注意：

- Talkio 的 provider/model/identity 设计值得参考。
- 但 API key 不能直接进入前端长期存储。

## Artifact And Local Asset Store

职责：

- 保存上传图片、附件、生成文件、运行产物。
- 生成 `/local-assets/*` 可访问 URL。
- 记录 artifact metadata：mime、size、source run、message block。
- 提供清理策略。
- 为每个 Room 创建持久 artifact root，并按 `uploads/`、`artifacts/`、`previews/` 分区。

## WebSocket Gateway

职责：

- 接收前端 command。
- 推送 conversation/run/message event。
- 支持客户端带 seq reconnect 并 replay missed events。
- 将 WS command 转给同一批 use-case。

连接模型：

- 一个 Web 客户端窗口只维护一个 `/api/ws` 连接。
- room、conversation、agent run 不创建独立 WebSocket。
- 客户端通过 subscribe/unsubscribe 声明关注范围。
- active run 数量只影响 event 数量，不影响 WebSocket 数量。

## Deferred Nextop CLI Gateway

状态：本期暂缓。当前阶段只推进 GUI 场景和本地 agent 群聊体验。

职责：

- 后续阶段再提供外部 route。
- 后续阶段再生成或维护 app/cli manifest 和命令文档。
- 支持外部 agent 发现命令、创建聊天、发消息、启动 agent run、轮询 events、读取状态。

约束：

- CLI route 不复制业务逻辑。
- CLI manifest 的 summary、description、required inputs 必须自解释。

当前阶段：

- 本期暂缓 Nextop CLI 接入。
- 当前优先 GUI 场景；CLI gateway 后续再按同一批 service/use-case 补齐，避免复制业务逻辑。

## P0 建议

- 先完成 SQLite + event store + conversation/message 基础表。
- 实现 WebSocket replay 的最小闭环。
- 实现 AgentRunService/Orchestrator 接口和一个 runtime。
- 实现 tool gateway session 和 manifest。
- 实现 skills seed/load/materialize。
- 实现 CLI route 的只读状态和 agent events polling。

## 待确认

- P0 runtime 默认选择 `server-deepagent` 还是 `local-agent:codex`。
- Provider key 是否使用系统 keychain，还是先做 SQLite 加密字段。
- Tool gateway 的 mutate 工具 P0 是否允许 agent 改聊天室状态，还是只读。
