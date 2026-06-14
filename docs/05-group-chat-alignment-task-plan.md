# Group Chat 对齐任务计划

本文把 `/Users/niuma/code/group-chat/out` 中适合 `group-chat` 的方案拆成可执行任务。目标不是复刻 group-chat 的完整产品，而是对齐本项目的核心方向：本地 agent 组成 IM 群聊，支持房间、成员、@、文件引用、角色个性和群聊回复策略。

## 对齐原则

- 借抽象，不搬复杂度。优先复用 group-chat 已验证的边界：agent workspace、身份文件、结构化 mention、结构化附件、trigger/listen mode、`[NO_REPLY]`。
- 保持本项目 local-first 形态。Fastify server 继续作为 HTTP、WebSocket、SQLite、本地资源和 runtime gateway 的统一入口。
- 聊天业务不绑定具体 agent runtime。Codex、Claude、本地 demo 都应经过统一 runtime provider / run orchestrator。
- UI 文本里的 `@name` 只是展示层，服务端事实源必须是 participant id。
- 文件引用必须是结构化 artifact/content block，agent 输入只注入 metadata 和读取方式，不把大文件直接塞进 prompt。
- ACP 本地 agent 接入必须使用本项目选定的 `@tutti-os/agent-acp-kit` 方案；如果 kit 能力不足，要先停下来说明缺口，不自行绕开成另一套 ACP 实现。
- 当前阶段聚焦用户最初列出的 IM 核心功能：本地 agent、房间增删、房间成员增删、群聊/@、文件引用、本地工作区、agent 个性和回复策略；不扩张到 Tutti CLI 或更完整的 group-chat 产品面。
- 技术方案需要重度参考 group-chat 已验证的设计，但代码组织、模块边界和命名可以按 `group-chat` 现有分层来实现，不要求照搬 group-chat 写法。

## Group Chat 中可借鉴的解法

### Agent Workspace

Group Chat 为每个 agent 建长期目录：

```text
agents/{agentId}/
  AGENTS.md
  CLAUDE.md -> AGENTS.md
  SOUL.md
  IDENTITY.md
  OWNER.md
  MEMORY.md
  BOOTSTRAP.md
  memory/users/
  skills/
  sessions/
  conversations/
```

`group-chat` 应拆成三层路径：

- app workspace：全局 SQLite、settings、bundled skills、runtime 配置。
- room artifact root：上传文件、生成产物、预览。
- agent workspace：身份文件、记忆、skills、session 持久化。

### Identity Files

Group Chat 不依赖修改 skill 来塑造个性，而是把 agent 角色写入 `AGENTS.md`、`SOUL.md`、`IDENTITY.md` 等文件，再由 runtime 注入。

`group-chat` 现有 `Identity.systemPrompt/stylePrompt` 是正确起点。后续本地 agent 接入时，需要 materialize 成：

- `AGENTS.md`：ACP/Codex/Claude 可直接读取的运行指令。
- `IDENTITY.md`：角色设定。
- `SOUL.md`：长期风格、人格边界。
- 可选 `OWNER.md`、`MEMORY.md`：P1 记忆能力。

### Trigger And Listen Mode

Group Chat 不让所有 agent 每条消息都回复。它有两层控制：

- 服务端触发：`active`、`passive`、`adaptive` listen mode。
- agent 自我沉默：agent 输出严格 `[NO_REPLY]` 时，桥接层取消消息。

`group-chat` P0 可以先支持：

- `all`：所有 active AI 收到 trigger。
- `mentioned`：只有被 @ 的 AI 收到 trigger。
- `selected`：composer 或 API 显式指定目标。
- `[NO_REPLY]`：runtime 产出该标记时不创建最终可见回复，或取消 streaming anchor。

P1 再加：

- member-level `listenMode`: `active | passive | adaptive`。
- adaptive trigger 小模型或启发式判断。
- agent-to-agent follow-up rounds。

### Structured Mentions

Group Chat composer 维护 `mentionedIds`，发送消息时带 `mentions` 字段。文本里的 `@名字` 只是用户可见表达。

`group-chat` 需要：

- `SendMessageRequest.mentions?: MentionTarget[]`。
- `Message.mentions` 或独立 `message_mentions` 表。
- composer 插入 @ 时记录 participant id。
- 服务端 target resolution 优先使用 mention ids。

### Structured Attachments

Group Chat 把附件作为 content blocks 注入，并在 agent prompt 中渲染为 `<attachments>`，包含 name、mime、size、file_key 和读取提示。

`group-chat` 已有 `Artifact` 和 `MessageBlock`，下一步是：

- 发送消息时把 artifact id 与消息绑定。
- 构建 agent 输入时渲染 artifact metadata。
- 为 local agent 提供受控读取方式：HTTP tool gateway 和 stdio MCP 均支持按 artifact id 读取引用文件 metadata。

## 任务拆分

### P0-A: 房间与成员闭环

- 已有：创建房间、删除房间、添加 agent、禁言。
- 已完成：GUI 房间设置编辑。
  - `PATCH /api/rooms/:roomId` 支持更新 title 和 description。
  - room title/description 会同步到 1:1 conversation 的 title/group system prompt，保持房间头部、侧边栏和 agent workspace 上下文一致。
  - Chat Header 提供 Room 编辑入口，保存后广播 `room.updated`。
- 已完成：ConversationSidebar 房间搜索。
  - 按 conversation title、room title、room description 和 last message 本地过滤。
  - 无匹配时展示空状态，不影响 server durable store。
- 已完成：Team 页面提供 New local agent 快捷入口，默认绑定第一个 local-agent runtime，降低添加 Codex/Claude 本地 agent 的操作成本。
- 已完成：添加房间成员时可直接配置关键属性。
  - Add team member 展开表单支持选择 identity、房间内显示名、runtime、reasoning effort、listen mode 和 room-specific instructions。
  - 新成员一次提交后即 materialize 对应 participant workspace，不需要先添加再二次编辑。
- 已完成：删除房间内 agent，即将 participant 标记为 `removed`。
- 已完成：成员栏隐藏 removed participant，并同步事件。
- 已完成：浏览器主回归覆盖房间成员删除和房间删除。
  - 删除房间成员后 participant bar 和 responder preview 都会移除该 agent。
  - 删除房间需要确认，删除后侧栏不再展示该 room/conversation。
- 已完成：成员运行时/identity 更新入口。
  - `PATCH /api/participants/:participantId` 支持更新 displayName、identity、runtime profile、listen mode 和 reasoning effort。
  - 成员栏支持 inline 编辑房间内 agent；保存后广播 `participant.updated`。
  - 更新后会刷新 participant workspace，使 `AGENTS.md` / identity 文件跟随新身份和 runtime。
- 已完成：成员 room-specific instructions。
  - participant 保存 `roomInstructions`，用于定义该 agent 在当前 room 的局部职责、边界和分工。
  - 成员栏 inline 编辑支持维护 room-specific instructions。
  - `AGENTS.md`、`IDENTITY.md`、`BOOTSTRAP.md` 注入该 participant 的 room-specific instructions；它用于细化 identity，conversation collaboration rules 仍优先。

验收：

- UI 可以在房间中添加和移除 agent，并在添加时配置 runtime、listen mode、reasoning effort 和 room-specific instructions。
- UI 可以编辑房间标题和描述。
- UI 可以按标题、描述或最近消息搜索房间。
- UI 可以编辑房间中 agent 的 identity、runtime、显示名、listen mode 和 room-specific instructions。
- 移除 agent 不删除历史消息。
- `pnpm check` 通过。

### P0-B: 结构化 @ 与回复目标

状态：已完成首版。

- 扩展 shared contract：`MentionTarget`、`SendMessageRequest.mentions`。
- 服务端保存 message mentions。
- Composer 提供 @ picker，插入显示文本并提交 participant ids。
- Composer 提供 `@all` picker，提交结构化 `mentionType: "all"`，可显式唤醒房间内所有 active AI。
- Composer 在 `selected` reply policy 下提供 Manual responders 选择器，可不修改正文就显式指定回复 agent，并通过同一套 structured mentions 提交。
- `ChatService.resolveTargets` 支持 `mentioned` 和显式 mentions。
- 已完成首版：Composer 回复目标预览。
  - 发送前按当前 reply policy、listen mode、@ 单人和 `@all` 计算初始 responders。
  - 预览会显示 auto responders、mention targets、@all responders 或 no automatic replies，帮助用户理解多个 agent 什么时候接话。
  - 该预览镜像服务端 `resolveTargets` 的规则；真实执行仍以后端 target resolution 为准。

验收：

- 用户 @ 单个 agent 时，只有该 agent 回复。
- 用户 @all 时，所有 active AI 都作为显式目标。
- 没有 @ 时按房间 reply policy 回复。
- selected 模式下可以从 GUI 选择一个或多个回复 agent。
- mention 数据不依赖 displayName 字符串解析。
- 发送前可以看到预计唤醒的 agent 列表。

### P0-C: 文件引用进入 agent 输入

状态：已完成首版。

- 保持当前 artifact 上传路径。
- 已完成：增加 agent prompt attachment formatter。
- 已完成：demo runtime 回复中体现收到的文件 metadata，作为真实 runtime 前的验证。
- 已完成：房间文件可重复引用。
  - Composer 展示当前 room/conversation 已有 artifacts 的轻量文件菜单。
  - Composer 展示 Room files shelf，用户可以直接看到最近房间文件并一键加入待发送引用。
  - 用户可以把历史上传文件再次加入待发送附件，而无需重新上传。
  - 用户可以在发送前移除误选的上传附件或二次引用附件。
  - 服务端复用旧 artifact 时会创建新的 message-scoped artifact reference，保留历史消息原有附件关系，不把旧附件从原消息搬走。

验收：

- 上传文件并发送后，消息包含文件 block。
- 上传文件后，房间工作区可以直接看到并再次引用该文件。
- agent 输入构造函数能生成 `<attachments>` 风格的引用文本。
- 不把大文件正文默认塞进 prompt。

### P0-D: Agent 个性 materialization

状态：已完成首版。

- 已完成：增加 `AgentWorkspaceService`。
- 已完成：为 identity 生成长期 `IDENTITY.md`、`SOUL.md`、`MEMORY.md`。
- 已完成：为 room participant 生成 `AGENTS.md`、`CLAUDE.md`、`BOOTSTRAP.md`、`IDENTITY.md`、`SOUL.md`、`OWNER.md`、`MEMORY.md`。
- 已完成：复用现有 `buildAgentInstructions` 作为 workspace `AGENTS.md` 的稳定来源。

验收：

- 每个本地 agent 有可定位 workspace。
- 修改 identity 后可更新对应指令文件。
- demo runtime 和未来 local-agent 使用同一份指令构造函数。

### P0-E: 本地 agent runtime 骨架

状态：已完成首版。

- 已完成：增加 runtime provider interface 和 registry。
- 已完成：把 `server-demo` 从 `ChatService` 内部抽到 provider。
- 已完成：增加 local-agent provider 命令桥首版；未配置命令时明确 failed，配置命令后用 participant workspace 作为 cwd 启动本地进程。
- 已完成：抽出 `group-chat.local-agent.v1` stdin/stdout 协议。
  - stdin 包含 workspaceRoot、conversation、participant、identity、runtimeProfile、message turn、attachments、workspaceFiles、tool gateway URLs 和 artifact URL template。
  - stdout 兼容普通文本和 JSONL 事件：`text_delta`、`final_text`、`no_reply`、`error`。
  - `no_reply` 会映射到 Group Chat 风格 `[NO_REPLY]`，由 ChatService 走统一取消投影。
- 已完成：按 `ai-media-canvas` 方案接入 `@tutti-os/agent-acp-kit`。
  - 无自定义 stdin 命令时，`local-agent:codex` / `local-agent:claude` / kit catalog 内 provider 走 `createLocalAgentRuntime`。
  - kit 负责 provider detect、Codex/Claude/ACP preset、process supervisor、JSONL/ACP/plain transport、MCP config delivery、provider-native resume metadata 和 normalized `AgentEvent`。
  - host 仍负责 IM 语义：run/message 投影、participant workspace、prompt envelope、tool token、tool gateway、`[NO_REPLY]` 取消投影。
  - 每次 run 会传入近期 durable history、system prompt、run-scoped MCP server、workspace cwd 和 provider resume metadata。
  - participant reasoning effort 可在房间成员编辑中设置；host 会写入 workspace 指令，并在 kit run 时传给支持 reasoning 的本地 provider。
  - provider session metadata 写入 participant workspace `.group-chat/local-agent-sessions/{conversationId}.json`，下一轮同 provider 优先 `resume: { mode: "provider" }`，否则 fresh。
  - 保留自定义命令桥：`GROUP_CHAT_LOCAL_AGENT_COMMAND` / `GROUP_CHAT_LOCAL_AGENT_CODEX_COMMAND` / `GROUP_CHAT_LOCAL_AGENT_CLAUDE_COMMAND` 仍走 `group-chat.local-agent.v1` stdin/stdout 协议。
- 已完成：provider 可用性探测 API 和 UI 状态提示。
  - `GET /api/local-agent/providers` 直接复用 kit detect，返回 provider、displayName、available、authState、executablePath、version、configDir、models 和不可用原因。
  - Team member 默认 runtime 选择器和房间 participant runtime 编辑器会展示 `Ready` / `Needs setup`。
  - Team 页面增加 Local providers 面板，按当前 `RuntimeProfile` 展示 Codex/Claude 等已配置 provider 的 readiness、version、model count、executable path，并支持手动刷新。
  - Settings 页面增加 Runtime 基础页，集中展示 runtime profiles、local provider readiness，并提供手动刷新入口。
  - UI 仍以本项目的 `RuntimeProfile` 为事实源；provider detect 只作为安装/认证/可用性提示，不把模型管理耦合进聊天业务。
- 已完成首版：kit thinking/tool 事件投影。
  - runtime provider 可以输出结构化 `RuntimeStreamEvent`，保留 kit 的 `thinking_delta`、`tool_call`、`tool_result`、`file_write`、`stderr` 等事件。
  - `ChatService` 把事件投影成 host-owned `MessageBlock`：`reasoning`、`tool_call`、`tool_result`、`artifact`、`error`，主回复仍写入 `main_text` 和 message content。
  - 前端消息流对 reasoning/tool/error block 做轻量事件卡片展示，不把 tool 事件混进普通 assistant 正文。
  - `[NO_REPLY]` 探测仍只看文本前缀；若 agent 先输出辅助事件再沉默，辅助 block 会被收尾，取消消息仍不展示。
- 已完成：真实 CLI 兼容性 smoke 入口和本机回归。
  - `pnpm --filter @group-chat/server local-agent:smoke -- --provider <codex|claude>` 会启动隔离 `GROUP_CHAT_HOME` 的临时后端，创建房间、identity、participant，发送一条消息并验证 assistant 成功完成。
  - 本机已验证 `codex-cli 0.139.0`：完整链路成功，最终内容 `group-chat smoke ok`，并真实产生多组 `tool_call` / `tool_result` blocks。
  - 本机已验证 `Claude Code 2.1.169`：完整链路成功，最终内容 `group-chat smoke ok`。
- 已完成首版：active run cancellation。
  - `POST /api/runs/:runId/cancel` 可取消 accepted / running run。
  - ChatService 会调用 runtime provider cancel，撤销 run-scoped tool token，并把 run / assistant message 投影为 `cancelled`。
  - 生成协程在用户取消后不会再把 run 收尾成 completed。
  - Composer 提供 stop responses 控制，当前 conversation 有 active run 时可用。

验收：

- ChatService 不直接生成 token stream。
- run/message/event 投影仍保持当前行为。
- Codex/Claude/ACP provider 接入已进入 kit-driven provider 层；provider readiness 面板和事件 block 展示都由 host UI 消费标准状态/消息块，不需要改聊天业务。

### P1: Group Chat 级能力

- 已完成首版：member-level listen mode：`active | passive | adaptive`。
  - explicit mention / `@all` 覆盖 listen mode。
  - 无 mention 时：`active` 自动接话，`passive` 不主动接话，`adaptive` 对问题/建议/方案/评审等信号接话。
- 已完成首版：`[NO_REPLY]` streaming cancellation。
  - runtime provider 输出以 `[NO_REPLY]` 开头时，服务端不展示 marker。
  - 对应 assistant message 标记为 `cancelled`，run 标记为 `cancelled`，前端隐藏空取消回复。
- 已完成首版：trigger queue/coalescing。
  - 同一 `conversationId + participantId` 同时只跑一个回复。
  - agent 忙时只保留最新 pending user message，当前 run 完成后补跑最新触发。
  - 已完成持久化 queue：pending trigger 写入 SQLite `reply_queue`，进程重启后会恢复补跑。
  - 启动恢复时会把上次进程遗留的 `accepted` / `running` run 标记为 failed，避免 UI 永远显示 running。
- 已完成首版：agent-to-agent follow-up rounds。
  - user @ 单个 agent 时，初始 agent 回复后可按 `mentionFollowupRounds` 唤醒其他 active/adaptive agent。
  - 每条 follow-up 链里同一 agent 最多回复一次，避免 A/B 互相无限反弹。
  - 普通 `all` 触发默认覆盖所有 active agent，不额外制造 follow-up 扩散。
- 已完成首版：reply speaking order。
  - `sequential` 保持房间成员顺序逐个启动。
  - `random` 在每轮回复前洗牌目标 agent。
  - `parallel` 在同一轮并发启动多个 agent run；follow-up round 继续复用同一 order，并受 `maxRounds` / `mentionFollowupRounds` 和 seen participant 限制。
  - 前端 Policy 面板已支持直接切换 speaking order，并在房间头部展示当前 order。
  - 已用临时后端验证：`mode=all, order=parallel` 时两个 demo agent 可同时进入 active run / streaming assistant 状态。
- 已完成首版：agent workspace memory。
  - 成功回复后写入 participant workspace raw conversation log：`conversations/{conversationId}.md`。
  - 生成并刷新 compact memory：`MEMORY.md` 的 generated section、`memory/users/local-user.md`、`conversations/{conversationId}.summary.md` 和 `DISTILLED_CONTEXT.md`。
  - `AGENTS.md` / `BOOTSTRAP.md` 明确要求本地 agent 读取 `MEMORY.md`、`DISTILLED_CONTEXT.md` 和 conversation summary。
  - 参考 group-chat 的 context-store/distill 思路，首版采用本地确定性提炼：提取用户偏好信号、最近 turns、memory budget，并对常见 token/key 做脱敏。
  - raw conversation log 超过阈值后保留最近窗口并写入 compaction notice，避免 workspace 记忆无限膨胀。
- 已完成首版：tool gateway。
  - 本地 HTTP API 支持读取 agent context、读取附件、以 agent 身份发送消息、保存 generated/run artifact。
  - 已增加 run-scoped tool token：ChatService 每次 run 签发一次，local-agent stdin 注入 token 和带 token 的 tool URLs，gateway 无 token 返回 401。
  - 已增加 stdio MCP 包装：ACP agent 可以通过 MCP tools 调用同一组 run-scoped tool gateway 能力，包括读取单个 artifact metadata。
  - token 只保存在 server 内存中，run 结束后撤销。
- 已完成首版：conversation collaboration rules。
  - conversation 保存 `collaborationRules` 和 `collaborationRulesVersion`。
  - 规则更新后广播 `conversation.updated`，并刷新 participant workspace。
  - `AGENTS.md` / `BOOTSTRAP.md` 注入规则版本和规则正文。
  - 已完成首版：规则模板和审计历史。
    - 规则编辑器提供 delivery / debate / review 三种模板。
    - 每次规则更新写入 `collaboration_rule_events`，记录 version、previousRules、nextRules、templateId、actorName 和 createdAt。
    - `GET /api/conversations/:conversationId/rules/history` 返回最近规则历史，前端 Rules 编辑器展示最近版本。
- 已完成首版：GUI Run Inspector。
  - 聊天工作区展示当前 active runs 和最近 assistant run 结果。
  - 每个 run 展示参与者、状态、runtime/provider/model 或 runtime profile，帮助调试本地 agent 回复链路。

## 推荐推进顺序

1. P0-B 结构化 @：直接影响群聊策略，是产品体感最强的第一步。
2. P0-A 删除房间内 agent：补齐房间管理闭环。
3. P0-C 文件引用注入：让“引用文件聊天”不仅能展示，也能被 agent 理解。
4. P0-D Agent 个性文件：为本地 Codex/Claude 接入铺路。
5. P0-E runtime 抽象：把 demo 迁到统一 runtime provider，再接真实 local agent。
6. P1 listen mode：先解决多个 agent 什么时候接话。

## 当前代码差距

- `ReplyPolicy`、participant listen mode、`[NO_REPLY]` 取消投影、trigger coalescing、持久化 reply queue、启动恢复、agent-to-agent follow-up rounds、speaking order 执行语义已存在。
- `RuntimeProfile` 已 seed `local-agent:codex` / `local-agent:claude`，local-agent provider 已支持本地命令桥、稳定 stdin/stdout 协议和按 `ai-media-canvas` 方案接入的 `@tutti-os/agent-acp-kit`。
- 已有 agent workspace 文件、成功回复后的 raw memory 写入、确定性 memory 提炼/压缩和 `DISTILLED_CONTEXT.md` 注入；后续可继续接入 LLM distill，把启发式摘要升级为模型摘要。
- 已有 structured attachment prompt context、Room files shelf、本地 agent tool gateway、run-scoped tool token、stdio MCP tool wrapping、local-agent 命令桥、JSONL 输出事件、kit-driven Codex/Claude/ACP provider、ACP prompt envelope、workspace-local provider resume metadata、provider detection UI、Settings Runtime 页、thinking/tool event block 展示和真实 Codex/Claude CLI smoke 回归入口。
- 已有 GUI 房间设置编辑、ConversationSidebar 房间搜索、添加成员时配置关键属性、Composer 回复目标预览、selected 模式手动选择 responders、conversation collaboration rules 首版、规则模板、审计历史、participant room-specific instructions 和 GUI Run Inspector。
- `Tutti CLI gateway` 本期暂缓；当前阶段优先 GUI 场景和本地 agent 群聊体验。

## 回归入口

- `pnpm smoke`
  - 聚合运行 core flow、workspace materialization、Codex/Claude provider detect-only，适合作为常规本地验收入口。
- `pnpm smoke:real-local-agents`
  - 在 `pnpm smoke` 基础上额外运行真实 Codex/Claude local-agent 完整回归。
- `pnpm e2e`
  - 构建前端并启动隔离 `GROUP_CHAT_HOME` 的临时后端，通过浏览器验证创建 team member、创建 local-agent member、Settings Runtime 页、创建 room、编辑房间设置、搜索房间、编辑 reply speaking order、selected 模式手动选择 responders、添加/删除 participant、添加 participant 时配置 room-specific settings、Composer 回复目标预览、GUI Run Inspector、@ mention 菜单、附件上传/移除、Room files shelf、房间文件二次引用/移除、发送消息、demo agent 回复和删除 room。
- `pnpm --filter @group-chat/server core:smoke`
  - 通过公开 HTTP API 验证创建房间、更新房间设置、更新 reply policy、创建 identity、添加 participants、上传附件、结构化 @ 单个 agent、附件 message block、房间文件二次引用不破坏历史附件、active run cancellation、删除 participant 和删除 room。
- `pnpm --filter @group-chat/server workspace:smoke`
  - 验证 identity workspace 文件、participant room workspace 文件、room-specific instructions、reasoning effort、raw conversation log、`DISTILLED_CONTEXT.md`、conversation summary 和 local-user memory 在 demo agent 回复后生成。
- `pnpm --filter @group-chat/server local-agent:smoke -- --provider codex`
  - 使用真实 Codex CLI 验证 kit-driven local-agent 主链、run/message/block 投影和 run-scoped tool gateway。
- `pnpm --filter @group-chat/server local-agent:smoke -- --provider claude`
  - 使用真实 Claude Code 验证 kit-driven local-agent 主链。
