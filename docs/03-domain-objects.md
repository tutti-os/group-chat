# 业务领域对象

本文定义 AI 聊天室上层领域对象。底层 agent/run/tool/skill 能力按 `docs/ai-media-canvas-foundation-reference.md` 实现；本文件只描述聊天室业务语义。

## 参考结论

从 `botgroup.chat` 借鉴：

- 聊天室可以有多个 AI 成员。
- 群组可以有预设描述、成员列表、全员讨论开关。
- 成员可以被禁言。
- 调度器可以选择本轮哪些 AI 回复。
- 场景化玩法可以作为 room preset。

从 `talkio` 借鉴：

- Conversation 同时支持 single/group。
- Participant 和 Identity/Persona 分离。
- 群聊支持顺序、随机、并行发言。
- @ mention 可以指定回复对象。
- 消息支持分支、编辑、重新生成。
- 消息内容需要 block 化，支持正文、reasoning、tool、image、error 等。

## Workspace

含义：本地应用工作区。

职责：

- 保存全局设置、skills、provider/runtime profile。
- 作为本地数据和资源的顶层归属。
- 为 Tutti CLI 暴露 workspace app context。

不负责：

- 不直接承载某个聊天室消息。

## Room

含义：聊天室空间，可理解为一组对话和成员配置的容器。

核心字段：

- `id`
- `title`
- `description`
- `presetId`
- `artifactRoot`
- `defaultParticipantIds`
- `defaultReplyPolicy`
- `createdAt`
- `updatedAt`

职责：

- 管理聊天室级别的默认配置。
- 支持场景模板，例如辩论、评审、头脑风暴、文字游戏。
- 作为未来分享/复制聊天室配置的单位。
- 拥有本地 filesystem 目录，保存本房间内上传文件、生成产物和预览资源。

和 Conversation 的关系：

- Room 是长期聊天室空间。
- Conversation 是 Room 内当前对应的具体消息线程。
- 当前产品阶段，Room 与 Conversation 在数量上 1:1 对应。
- 即使数量关系是 1:1，代码中也保留两个领域概念，因为 Room 负责成员默认配置、产物目录、分享/复制边界，Conversation 负责消息、分支、run/message 绑定。

## Conversation

含义：一条聊天线程。

核心字段：

- `id`
- `roomId`
- `type`: `single` | `group`
- `title`
- `participants`
- `replyPolicy`
- `groupSystemPrompt`
- `activeBranchId`
- `pinned`
- `lastMessage`
- `lastMessageAt`
- `createdAt`
- `updatedAt`

职责：

- 承载消息列表。
- 定义本线程参与者和发言策略。
- 管理分支、置顶、标题、摘要。

不负责：

- 不直接保存 provider API key。
- 不直接保存 runtime 原始 resume token，resume 信息属于 AgentRun。

## Participant

含义：某个 Conversation 中的参与者席位。

核心字段：

- `id`
- `conversationId`
- `kind`: `human` | `ai`
- `displayName`
- `avatar`
- `runtimeProfileId`
- `identityId`
- `status`: `active` | `muted` | `removed`
- `sortOrder`
- `reasoningEffort`
- `toolAccessPolicyId`

职责：

- 表示“谁在这个聊天室里说话”。
- 绑定 runtime/model 和 identity。
- 控制禁言、排序、是否可被 @。

注意：

- 同一个模型可以作为多个 Participant 加入同一 conversation。
- Identity 是角色设定，不等于 Participant。

## Identity

含义：AI 的角色/persona。

核心字段：

- `id`
- `name`
- `icon`
- `systemPrompt`
- `temperature`
- `topP`
- `reasoningEffort`
- `boundSkillIds`
- `allowedToolIds`
- `createdAt`

职责：

- 定义角色行为。
- 提供系统提示词和参数默认值。
- 限定该角色默认可用 skills/tools。

不负责：

- 不决定本轮谁发言。
- 不保存 conversation 历史。

## RuntimeProfile

含义：一次 AI 参与者可使用的运行配置。

核心字段：

- `id`
- `kind`: `server-deepagent` | `local-agent`
- `provider`
- `model`
- `displayName`
- `capabilities`
- `enabled`
- `trustedMode`

职责：

- 隔离 UI 中的“模型选择”和底层 runtime provider。
- 标记能力：streaming、vision、tool use、reasoning、resume。
- 为 Runtime Control Plane 提供选择依据。

## ReplyPolicy

含义：群聊发言策略。

核心字段：

- `mode`: `selected` | `all` | `mentioned` | `auto`
- `order`: `sequential` | `random` | `parallel`
- `maxRounds`
- `mentionFollowupRounds`
- `schedulerParticipantId`

职责：

- 决定用户发出消息后哪些 Participant 应回复。
- 决定回复顺序。
- 控制 AI 回复中 @ 其他 AI 时是否继续追问。
- 支持类似 botgroup.chat 的调度器模式。

P0 建议：

- 支持 `all`、`mentioned`。
- 支持 `sequential`、`parallel`。
- `auto/scheduler` 可作为 P1。

## Message

含义：聊天线程中的一条消息 anchor。

核心字段：

- `id`
- `conversationId`
- `role`: `user` | `assistant` | `system` | `tool`
- `senderParticipantId`
- `senderName`
- `content`
- `status`: `pending` | `streaming` | `success` | `error` | `cancelled`
- `branchId`
- `parentMessageId`
- `runId`
- `tokenUsage`
- `createdAt`
- `updatedAt`

职责：

- 提供稳定消息锚点。
- 和 AgentRun 绑定。
- 为 UI 列表提供排序和状态。

原则：

- assistant message 必须在 run accepted 时创建空 anchor。
- 流式内容更新时持续投影到 MessageBlock。
- 不只在 run 完成后一次性写入消息。

## MessageBlock

含义：消息的结构化内容块。

类型：

- `main_text`
- `reasoning`
- `tool_call`
- `tool_result`
- `image`
- `file`
- `artifact`
- `error`

职责：

- 支持 Markdown、代码、高亮、Mermaid、KaTeX、HTML preview、tool call 展示。
- 支持 streaming block status。
- 允许后续扩展生成图片、附件、文件写入等内容。

## AgentInvocation

含义：聊天室业务请求某个 AI participant 产出一条回复的领域命令。

核心字段：

- `conversationId`
- `participantId`
- `triggerMessageId`
- `branchId`
- `runtimeProfileId`
- `identityId`
- `promptContext`
- `replyRound`
- `resumeMode`

职责：

- 将聊天室语义转换成底座 AgentRun 输入。
- 隔离 ConversationService 和 AgentRunService。

## AgentRun

含义：底座执行一次 agent 的 durable run。

职责：

- 保存 runtime/provider/model/resume/token/status。
- 记录 event seq。
- 绑定 assistant message。
- 支持取消、失败、重放、CLI polling。

AgentRun 是 infra/domain 交叉对象，上层只通过 `AgentInvocation` 创建它。

## Tool

含义：agent 可调用的受控能力。

类型：

- `inspect_conversation`
- `list_messages`
- `update_message`
- `create_artifact`
- `read_skill`
- `persist_file`
- `screenshot`

职责：

- 通过 tool gateway 暴露给 runtime。
- 使用 manifest/schema 描述能力。
- 根据 run/session/participant 做授权。

## Skill

含义：应用管理的 agent 能力说明和资源。

职责：

- 提供可安装、可启用的 workspace skills。
- run 时按 runtime 注入。
- 作为产品能力数据源，而不是用户全局目录的简单引用。

## Artifact

含义：消息或 run 产生的持久资源。

核心字段：

- `id`
- `sourceRunId`
- `sourceMessageId`
- `kind`
- `mimeType`
- `localPath`
- `publicUrl`
- `metadata`

职责：

- 管理本地资源生命周期。
- 给 UI 和 CLI 提供稳定引用。
- 支持聊天中的基础文件引用和展示，包括图片预览、文本类文件提取、普通文件卡片。

## Domain Service 划分

- `ConversationService`：conversation CRUD、标题、置顶、分支。
- `ParticipantService`：成员增删、禁言、排序、身份绑定。
- `MessageService`：消息创建、编辑、删除、block 投影。
- `ReplyPlanner`：根据 ReplyPolicy、@ mention、scheduler 生成 AgentInvocation 列表。
- `AutoDiscussService`：托管讨论、多轮继续。
- `IdentityService`：角色模板和参数。
- `RuntimeProfileService`：模型/runtime 配置和能力查询。
- `ArtifactService`：附件、生成产物、local asset。

## 待确认

- 调度器选择回复对象是否作为 P0。
- 消息分支是否 P0 实现，还是先在 schema 中预留。
- HTML preview / Mermaid / KaTeX 是否全部 P0。

## 已确认

- P0 引入 `Room` 和 `Conversation` 两个领域概念，并保持 1:1 对应。
- 每个 `Room` 都有持久化 filesystem 目录。
- 聊天中支持基础文件引用和展示。
