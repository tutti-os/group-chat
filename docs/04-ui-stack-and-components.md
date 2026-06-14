# UI 技术选型与核心组件

本文定义 AI 聊天室 Web UI 的技术栈和核心组件。UI 可以参考 `talkio` 的桌面/移动分层、消息渲染能力，以及 `botgroup.chat` 的群成员管理和全员讨论配置，但业务编排应放在 server/use-case 层。

## 技术栈建议

核心：

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- shadcn/ui + Radix UI
- lucide-react

状态与数据：

- TanStack Query：server state、缓存、失效、列表刷新。
- Zustand：本地 UI 状态，例如当前面板、输入草稿、composer 临时附件、sidebar 宽度。
- WebSocket client：订阅 run/message/conversation event，并写入 query cache。

消息渲染：

- react-markdown
- remark-gfm
- remark-math
- rehype-katex
- Shiki
- Mermaid
- sandboxed iframe HTML preview

交互增强：

- @tanstack/react-virtual：长消息列表虚拟化。
- use-stick-to-bottom 或自研 sticky scroll hook：流式输出时稳定贴底。
- react-hotkeys-hook：常用快捷键。
- sonner：toast。
- @dnd-kit：参与者排序、文件拖拽增强。

## 不建议

- 不把 agent run/generation 主流程写进 Zustand store。
- 不让组件直接处理 runtime 原始事件。
- 不在前端保存 provider API key 明文。
- 不在 UI 组件里拼接系统 prompt。

## 页面结构

P0 建议桌面优先：

```text
AppShell
  LeftRail
  ConversationSidebar
  ChatWorkspace
    ChatHeader
    ParticipantBar
    MessageTimeline
    Composer
  RightInspector
```

移动端可以 P1：

```text
MobileShell
  ConversationListScreen
  ChatScreen
  SettingsScreen
```

## 核心页面

### Chat Page

职责：

- 展示 conversation list。
- 展示当前 conversation。
- 接收 message/run event。
- 发起 user message。
- 管理 participant、reply policy、composer。

### Settings Page

职责：

- Runtime profiles。
- Provider credentials。
- Skills。
- Tool gateway 可用工具。
- 数据备份/导出。
- 本地资源清理。

### Skills Page

职责：

- 查看 bundled/workspace skills。
- 启用/禁用 skill。
- 查看 skill 摘要和 source。

### Runs Page 或 Inspector

职责：

- 查看 active/completed runs。
- 查看 run events。
- 取消 run。
- 查看 tool calls 和 artifacts。

P0 可以先做成右侧 inspector，不必独立页面。

## 核心组件

### AppShell

职责：

- 页面骨架。
- 管理左侧导航、侧栏、主内容、右侧 inspector。
- 响应窗口尺寸。

### LeftRail

职责：

- 图标导航：聊天、角色、Skills、设置。
- 使用 lucide icons + tooltip。

### ConversationSidebar

职责：

- Conversation 搜索（已完成：按标题、描述和 last message 本地过滤）。
- 新建单聊/群聊。
- 展示置顶、最近消息、状态。
- 支持右键菜单：重命名、置顶、删除、清空。

### ChatHeader

职责：

- 当前 conversation 标题。
- 运行状态摘要。
- 发言顺序切换。
- 打开成员管理和 inspector。

### ParticipantBar

职责：

- 展示当前参与者。
- 支持添加、移除、禁言、排序。
- 展示 runtime/model/identity 简要信息。
- 支持 @ mention picker 数据源。

### ParticipantPicker

职责：

- 选择 AI 参与者。
- 支持模型 + identity 组合。
- 支持批量创建群聊。

### RoomSettingsSheet

职责：

- 群系统提示词。
- ReplyPolicy：全员、@ 指定、顺序、随机、并行。
- 托管讨论轮数。
- 成员禁言。

借鉴 botgroup.chat 的成员配置 sheet，但字段要绑定我们的领域模型。

### MessageTimeline

职责：

- 虚拟化渲染消息列表。
- 支持 sticky-to-bottom。
- 支持 streaming message 合并。
- 支持分支提示。
- 支持加载历史。

### MessageRow

职责：

- 渲染发送者、头像、时间、状态。
- 操作：复制、编辑、重新生成、分支、删除。
- 展示 token usage、runtime/run 状态。

### MessageBlockRenderer

职责：

- 根据 block type 分派渲染：
  - `main_text` -> MarkdownRenderer
  - `reasoning` -> ReasoningBlock
  - `tool_call` / `tool_result` -> ToolCallBlock
  - `image` / `file` / `artifact` -> ArtifactBlock
  - `error` -> ErrorBlock

### Composer

职责：

- 多行输入。
- @ mention。
- 附件选择/拖拽。
- 发送、停止、继续、托管讨论。
- 发送前显示目标参与者。

### MentionTextarea

职责：

- 识别 `@participant`。
- 弹出 participant list。
- 输出 mention ids，而不只输出文本。

### RunInspector

职责：

- 展示当前 message 绑定的 run。
- 展示 event timeline。
- 展示 tool calls、artifacts、错误。
- 支持取消 active run。

### ToolCallBlock

职责：

- 展示工具名、参数摘要、状态、结果。
- 默认折叠参数和长结果。
- 错误结构化展示。

### ArtifactBlock

职责：

- 图片、文件、生成产物预览。
- 打开本地资源。
- 复制 resource URL 或 CLI output path。
- 展示基础文件引用：文件名、类型、大小、来源消息。
- 文本类文件支持展开摘要或预览内容。

### MarkdownRenderer

职责：

- GFM、代码块、表格、数学公式。
- Mermaid code block 转 MermaidRenderer。
- HTML code block 提供 sandbox preview。

## UI 状态边界

前端可以持有：

- 当前选中的 conversation id。
- sidebar 宽度。
- inspector 是否打开。
- composer 草稿。
- 本地附件上传前预览。
- optimistic user message 状态。

前端不应持有为唯一事实源：

- message 最终内容。
- run status。
- tool call 状态。
- conversation participant 列表。
- enabled skills。

这些状态应来自 server durable store，并通过 HTTP/WS 同步。

## P0 组件范围

P0 必须有：

- AppShell
- ConversationSidebar
- ChatWorkspace
- ChatHeader
- ParticipantBar
- MessageTimeline
- MessageRow
- MessageBlockRenderer
- Composer
- ParticipantPicker
- RoomSettingsSheet
- RunInspector
- SettingsPage 的 Runtime 基础页
- 基础文件引用和展示：图片预览、普通文件卡片、文本文件预览。

P1 再做：

- 移动端专用 shell。
- Persona market。
- 高级消息搜索。
- SettingsPage 的 Skills 基础页。
- 完整导入/导出 UI。
- 复杂 HTML/Three.js preview 管理。

## 视觉原则

- 聊天室是工作型工具，整体应安静、密集、可扫描。
- 避免营销式 hero 或装饰性大卡片。
- 图标按钮优先使用 lucide。
- 控件语义明确：开关用于二元配置，segmented control 用于模式，slider/input 用于数值。
- 组件尺寸稳定，流式内容不能导致输入区和头部跳动。
- 深浅色主题使用 CSS variables，不把颜色写死进业务组件。

## 待确认

- Tailwind CSS v4 是否作为默认。
- TanStack Query 是否引入，还是只用轻量自研 API cache。
- P0 是否需要移动端布局。
- 是否首版就支持 Mermaid、KaTeX、HTML preview。
