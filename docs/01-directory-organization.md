# 目录组织格式

本文记录 `group-chat` 新应用的目录组织约定。结论基于本仓库的底层参考文档 `docs/ai-media-canvas-foundation-reference.md`，并参考：

- `https://github.com/maojindao55/botgroup.chat`
- `https://github.com/llt22/talkio`

## 目标

新应用是本地优先 AI 聊天室。目录组织应服务于三个目标：

- 上层聊天业务不绑定具体 agent runtime。
- Web UI、server、shared contract 边界清晰。
- WebSocket、HTTP API 复用同一批 server service/use-case；Nextop CLI 后续接入时也必须复用同一边界。

## 顶层目录

建议采用轻量 monorepo：

```text
group-chat/
  apps/
    web/
    server/
  packages/
    shared/
  docs/
  scripts/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

职责：

- `apps/web`：React/Vite 静态前端。只负责 UI、交互状态、API/WS client，不承载核心业务编排。
- `apps/server`：Fastify 本地服务。托管静态前端，并提供 HTTP API、WebSocket、SQLite、本地资源、agent runtime、tool gateway。
- `packages/shared`：跨 web/server 共享的稳定 contract、event schema、领域类型、zod schema、客户端 DTO。
- `docs`：架构共识、产品规则、运行协议、后续 ADR。
- `scripts`：本地开发、打包、生成 Nextop app manifest、数据库维护脚本。

## apps/server

建议结构：

```text
apps/server/src/
  main.ts
  config/
  http/
    routes/
    nextop-cli.ts
    static.ts
  ws/
    handler.ts
    replay.ts
  db/
    connection.ts
    migrations/
    repositories/
  local/
    asset-store.ts
    paths.ts
  agent/
    runtime.ts
    run-service.ts
    run-orchestrator.ts
    event-adapter.ts
    runtimes/
      server-deepagent.ts
      local-agent.ts
    local-agent-host/
      tool-gateway.ts
      tools-mcp.ts
      skills.ts
  domains/
    rooms/
    conversations/
    participants/
    messages/
    rooms/
    providers/
    skills/
    tools/
    artifacts/
  services/
    event-store.ts
    command-bus.ts
    clock.ts
  bootstrap/
    seed-skills.ts
    mark-interrupted-runs.ts
```

约定：

- `domains/*` 放业务 use-case、repository interface、领域规则，不直接处理 Fastify request。
- `http/routes/*` 和 `ws/handler.ts` 只做入口适配、鉴权、DTO 校验、调用 use-case。
- `agent/*` 是底座级模块，不放具体聊天室 UI 概念，但可以接收聊天室上下文。
- `db/repositories/*` 是 SQLite 实现层，避免 SQL 散落在业务模块。
- `local/*` 管理本地文件路径和持久资源，业务模块不直接拼绝对路径。

## apps/web

建议结构：

```text
apps/web/src/
  main.tsx
  app/
    App.tsx
    router.tsx
    providers.tsx
  api/
    http-client.ts
    ws-client.ts
    query-keys.ts
  features/
    chat/
      components/
      hooks/
      pages/
    participants/
      components/
    settings/
      pages/
    skills/
      components/
    tools/
      components/
  components/
    ui/
    layout/
    shared/
  stores/
    ui-store.ts
    composer-store.ts
  lib/
  styles/
```

约定：

- `features/chat` 可以组织聊天页面，但不拥有 server 领域模型定义。
- Server state 使用 API client/query 管理；Zustand 只放当前选中项、面板开关、输入框草稿等 UI 状态。
- `components/ui` 放 shadcn/Radix 基础组件；`features/*/components` 放业务组件。
- Markdown、代码块、Mermaid、HTML preview 这类跨消息 block 的渲染组件放 `features/chat/components/message-blocks` 或 `components/shared`，不要混入 message fetch 逻辑。

## packages/shared

建议结构：

```text
packages/shared/src/
  contracts/
    http.ts
    ws.ts
    cli.ts
  events/
    stream-events.ts
    canvas-events.ts
  domain/
    conversation.ts
    participant.ts
    message.ts
    run.ts
    tool.ts
    skill.ts
  schemas/
  errors/
  index.ts
```

约定：

- 所有 WebSocket event、CLI output、HTTP DTO 先在 `packages/shared` 定义。
- UI 不消费 runtime 原始事件，只消费 shared event schema。
- 领域对象类型从这里导出，但数据库 row type 不放这里。

## 参考项目取舍

`botgroup.chat` 可借鉴：

- 群组预设、AI 成员、全员讨论模式、成员禁言。
- 调度器选择哪些 AI 回复，而不是每次所有 AI 都回复。
- 游戏/场景化聊天室的配置思路。

不直接采用：

- Cloudflare Pages Functions 结构。
- 前端页面内串联多个模型请求的实现方式。

`talkio` 可借鉴：

- 单聊/群聊统一 Conversation 模型。
- Participant 与 Identity 分离。
- 顺序、随机、并行三种发言策略。
- @ 提及触发指定参与者回复。
- 消息分支、重新生成、编辑后重跑、消息 block。
- 桌面/移动响应式组件分层。

不直接采用：

- 前端 store 承载大部分生成编排。
- Tauri Rust 后端作为主要底座。

## 待确认

- 包管理器默认建议 `pnpm`，是否有现有偏好。
- Nextop CLI 后续接入的 manifest 和命令文档格式。
- P0 是否只做桌面宽屏布局，移动端作为 P1。

## 已确认

- Web 客户端每个窗口只维持一个 WebSocket；room、conversation、run 不各自创建独立 WebSocket。
- `Room` 和 `Conversation` 在数量上 1:1 对应，但代码中保留两个领域概念。
- `Room` 负责聊天室空间、成员默认配置、产物目录和扩展性边界。
- `Conversation` 负责具体消息线程、分支、发言策略和 run/message 绑定。
- 每个 `Room` 都有一个持久 filesystem 目录，用于保存该房间内上传文件、生成产物和预览资源。
- 基础文件引用和展示进入首版范围。
