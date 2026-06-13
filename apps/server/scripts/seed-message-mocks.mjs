import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = process.env.GROUP_CHAT_HOME ? resolve(process.env.GROUP_CHAT_HOME) : join(homedir(), ".group-chat");
const dbPath = join(root, "data", "group-chat.db");
const roomRootBase = join(root, "rooms");
const db = new DatabaseSync(dbPath);

db.exec("PRAGMA foreign_keys = ON");

const now = new Date();
const iso = (offsetSeconds = 0) => new Date(now.getTime() + offsetSeconds * 1000).toISOString();
const id = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
const json = (value) => JSON.stringify(value);

const title = "消息样式验收";
const existing = db.prepare("SELECT id FROM rooms WHERE title = ?").get(title);
if (existing) {
  db.prepare("DELETE FROM rooms WHERE id = ?").run(existing.id);
}

const roomId = id("room");
const conversationId = id("conv");
const plannerId = id("part");
const coderId = id("part");
const roomRoot = join(roomRootBase, roomId);
mkdirSync(join(roomRoot, "uploads"), { recursive: true });

const replyPolicy = {
  mode: "all",
  order: "sequential",
  maxRounds: 1,
  mentionFollowupRounds: 1,
};

const insertRoom = db.prepare(`
  INSERT INTO rooms (id, title, description, artifact_root, default_reply_policy, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertConversation = db.prepare(`
  INSERT INTO conversations
  (id, room_id, type, title, group_system_prompt, collaboration_rules, collaboration_rules_version, reply_policy, active_branch_id, pinned, last_message, last_message_at, created_at, updated_at)
  VALUES (?, ?, 'group', ?, ?, ?, 1, ?, NULL, 0, ?, ?, ?, ?)
`);
const insertParticipant = db.prepare(`
  INSERT INTO participants
  (id, conversation_id, kind, display_name, avatar, runtime_profile_id, identity_id, room_instructions, status, listen_mode, sort_order, reasoning_effort, created_at, updated_at)
  VALUES (?, ?, 'ai', ?, NULL, 'server-demo', NULL, ?, 'active', ?, ?, ?, ?, ?)
`);
const insertMessage = db.prepare(`
  INSERT INTO messages
  (id, conversation_id, role, sender_participant_id, sender_name, content, mentions, status, branch_id, parent_message_id, run_id, token_usage, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
`);
const insertBlock = db.prepare(`
  INSERT INTO message_blocks
  (id, message_id, type, content, status, metadata, sort_order, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertArtifact = db.prepare(`
  INSERT INTO artifacts
  (id, room_id, conversation_id, message_id, source_run_id, kind, filename, mime_type, size_bytes, local_path, public_url, text_preview, created_at)
  VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function createMessage({ role, senderParticipantId = null, senderName, content, status = "success", runId = null, tokenUsage = null, mentions = [], at }) {
  const messageId = id("msg");
  insertMessage.run(
    messageId,
    conversationId,
    role,
    senderParticipantId,
    senderName,
    content,
    json(mentions),
    status,
    runId,
    tokenUsage ? json(tokenUsage) : null,
    at,
    at,
  );
  return messageId;
}

function createBlock(messageId, type, content, sortOrder, options = {}) {
  const blockId = id("blk");
  insertBlock.run(
    blockId,
    messageId,
    type,
    content,
    options.status ?? "success",
    options.metadata ? json(options.metadata) : null,
    sortOrder,
    options.at ?? iso(sortOrder),
    options.at ?? iso(sortOrder),
  );
  return blockId;
}

function createArtifact(messageId, { filename, mimeType, body, preview, kind = "upload" }) {
  const artifactId = id("art");
  const localPath = join(roomRoot, "uploads", filename);
  const bytes = Buffer.from(body);
  writeFileSync(localPath, bytes);
  insertArtifact.run(
    artifactId,
    roomId,
    conversationId,
    messageId,
    kind,
    filename,
    mimeType,
    bytes.length,
    localPath,
    `/local-assets/${artifactId}`,
    preview ?? null,
    iso(30),
  );
  return artifactId;
}

db.exec("BEGIN");
try {
  insertRoom.run(roomId, title, "覆盖文本、Markdown、代码、工具、附件、图片、错误和流式状态。", roomRoot, json(replyPolicy), iso(), iso(60));
  insertConversation.run(
    conversationId,
    roomId,
    title,
    "消息样式视觉验收房间。",
    "协作规则：用于 UI mock，不触发真实 agent。",
    json(replyPolicy),
    "Mocked message gallery ready.",
    iso(60),
    iso(),
    iso(60),
  );
  insertParticipant.run(plannerId, conversationId, "Planner Demo", "偏产品和结构化输出。", "active", 0, "medium", iso(), iso());
  insertParticipant.run(coderId, conversationId, "Coder Demo", "偏实现、工具和代码。", "adaptive", 1, "high", iso(), iso());

  const userText = [
    "@Planner Demo 帮我看一下这个消息样式验收。",
    "",
    "- 需要支持普通文本和 Markdown",
    "- 需要支持附件、图片、工具调用和错误状态",
  ].join("\n");
  const userMsg = createMessage({
    role: "user",
    senderName: "You",
    content: userText,
    mentions: [{ participantId: plannerId, displayNameSnapshot: "Planner Demo", mentionType: "participant" }],
    at: iso(1),
  });
  createBlock(userMsg, "main_text", userText, 0, { at: iso(1) });
  const fileArtifactId = createArtifact(userMsg, {
    filename: "ui-message-brief.txt",
    mimeType: "text/plain",
    body: "Message visual QA brief\n- text\n- markdown\n- attachments\n- tool events\n",
    preview: "Message visual QA brief\n- text\n- markdown\n- attachments\n- tool events",
  });
  createBlock(userMsg, "file", "", 1, { metadata: { artifactId: fileArtifactId }, at: iso(2) });

  const assistantMarkdown = [
    "我先按 **视觉验收** 拆一下：",
    "",
    "| 类型 | 状态 | 备注 |",
    "| --- | --- | --- |",
    "| 文本 | OK | 支持 Markdown / 列表 / 表格 |",
    "| 附件 | OK | 文件卡片独立显示 |",
    "| 工具 | 待看 | 应该弱化成事件块 |",
    "",
    "> 这条消息用来观察多行、表格和引用块在气泡里的表现。",
  ].join("\n");
  const assistantMsg = createMessage({
    role: "assistant",
    senderParticipantId: plannerId,
    senderName: "Planner Demo",
    content: assistantMarkdown,
    tokenUsage: { inputTokens: 384, outputTokens: 142 },
    at: iso(8),
  });
  createBlock(assistantMsg, "main_text", assistantMarkdown, 0, { at: iso(8) });

  const codeMsgText = [
    "这里是代码块和长行测试：",
    "",
    "```ts",
    "const layout = { messageMaxWidth: '70%', bubbleRadius: 16, overflowWrap: 'anywhere' };",
    "console.log('a-very-long-token-for-overflow-check-abcdefghijklmnopqrstuvwxyz-0123456789');",
    "```",
  ].join("\n");
  const codeMsg = createMessage({
    role: "assistant",
    senderParticipantId: coderId,
    senderName: "Coder Demo",
    content: codeMsgText,
    at: iso(14),
  });
  createBlock(codeMsg, "reasoning", "先检查 Markdown 渲染，再检查代码块是否撑破气泡，最后看滚动区域是否稳定。", 0, { at: iso(14) });
  createBlock(codeMsg, "main_text", codeMsgText, 1, { at: iso(15) });

  const toolMsg = createMessage({
    role: "assistant",
    senderParticipantId: coderId,
    senderName: "Coder Demo",
    content: "我跑了一个本地检查工具，下面是调用和结果。",
    at: iso(22),
  });
  createBlock(toolMsg, "main_text", "我跑了一个本地检查工具，下面是调用和结果。", 0, { at: iso(22) });
  createBlock(toolMsg, "tool_call", '{ "command": "pnpm check", "cwd": "/Users/niuma/code/group-chat" }', 1, {
    metadata: { toolName: "shell.exec" },
    at: iso(23),
  });
  createBlock(toolMsg, "tool_result", "packages/shared check: Done\napps/server check: Done\napps/web check: Done", 2, {
    metadata: { toolName: "shell.exec" },
    at: iso(24),
  });

  const imageMsg = createMessage({
    role: "assistant",
    senderParticipantId: plannerId,
    senderName: "Planner Demo",
    content: "图片和生成物卡片测试：",
    at: iso(31),
  });
  createBlock(imageMsg, "main_text", "图片和生成物卡片测试：", 0, { at: iso(31) });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="#f4f4f5"/><circle cx="130" cy="150" r="58" fill="#111"/><rect x="220" y="92" width="180" height="36" rx="18" fill="#dbeafe"/><rect x="220" y="146" width="130" height="28" rx="14" fill="#e5e7eb"/><text x="80" y="250" font-family="Arial" font-size="26" fill="#111">Message mock image</text></svg>`;
  const imageArtifactId = createArtifact(imageMsg, {
    filename: "message-mock-preview.svg",
    mimeType: "image/svg+xml",
    body: svg,
    kind: "preview",
  });
  createBlock(imageMsg, "image", "", 1, { metadata: { artifactId: imageArtifactId }, at: iso(32) });
  createBlock(imageMsg, "artifact", "生成物：message-mock-preview.svg\n用途：图片卡片和 artifact 事件块视觉检查。", 2, { at: iso(33) });

  const errorMsg = createMessage({
    role: "assistant",
    senderParticipantId: coderId,
    senderName: "Coder Demo",
    content: "这个消息模拟运行时失败。",
    status: "error",
    at: iso(42),
  });
  createBlock(errorMsg, "main_text", "这个消息模拟运行时失败。", 0, { at: iso(42) });
  createBlock(errorMsg, "error", "Runtime provider failed: demo timeout after 30s", 1, { status: "error", at: iso(43) });

  const streamingMsg = createMessage({
    role: "assistant",
    senderParticipantId: plannerId,
    senderName: "Planner Demo",
    content: "这条模拟正在回复中，检查 streaming 状态标签和气泡样式。",
    status: "streaming",
    runId: id("run"),
    at: iso(52),
  });
  createBlock(streamingMsg, "reasoning", "正在组织回答结构...", 0, { status: "streaming", at: iso(52) });
  createBlock(streamingMsg, "main_text", "这条模拟正在回复中，检查 streaming 状态标签和气泡样式。", 1, {
    status: "streaming",
    at: iso(53),
  });

  db.exec("COMMIT");
  console.log(JSON.stringify({ roomId, conversationId, title }, null, 2));
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
