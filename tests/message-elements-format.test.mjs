import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function bundleModule(source, outputName) {
  const output = `/tmp/${outputName}.test.mjs`;
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", source,
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

function message(overrides = {}) {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "user",
    senderName: "User",
    senderParticipantId: null,
    content: "正文内容",
    mentions: [],
    visibility: "public",
    status: "success",
    branchId: "branch-1",
    parentMessageId: null,
    runId: null,
    tokenUsage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function block(id, type, content, sortOrder) {
  return {
    id,
    messageId: "message-1",
    type,
    content,
    status: "success",
    metadata: type === "image" || type === "file" ? { artifactId: `artifact-${id}` } : null,
    sortOrder,
    createdAt: `2026-01-01T00:00:0${sortOrder}.000Z`,
    updatedAt: `2026-01-01T00:00:0${sortOrder}.000Z`,
  };
}

test("linked message cards retain text and attachment blocks in order", async () => {
  const { resolveLinkedMessagePreviewBlocks } = await bundleModule(
    "src/app/message-card-elements.ts",
    "message-card-elements",
  );
  const text = block("text", "main_text", "正文内容", 0);
  const image = block("image", "image", "", 1);
  const file = block("file", "file", "", 2);

  assert.deepEqual(
    resolveLinkedMessagePreviewBlocks(message(), [text], [file, image], "附件"),
    [text, image, file],
  );
});

test("file references remain structured when forwarding to Tutti Agent", async () => {
  const { formatMessageBodyForAgentForward } = await bundleModule(
    "src/app/reference-mentions.ts",
    "reference-mentions-forward",
  );
  const content = "查看 [brief.txt](group-chat://reference/file/artifact-1)";
  assert.equal(formatMessageBodyForAgentForward(content), content);
});

test("workspace app mention chips keep their app icon url when serialized", async () => {
  const { serializeReferenceMentionChip } = await bundleModule(
    "src/app/reference-mentions.ts",
    "reference-mentions-icon",
  );
  const markdown = serializeReferenceMentionChip({
    dataset: {
      mentionReferenceProvider: "workspace-app",
      mentionId: "tutti-at:workspace-app:vibe-design",
      mentionLabel: "产品原型设计",
      mentionReferenceEntityId: "vibe-design",
      mentionReferenceInsert: JSON.stringify({
        kind: "mention",
        mention: {
          entityId: "vibe-design",
          label: "产品原型设计",
          scope: { workspaceId: "workspace-1" },
        },
      }),
      mentionIconUrl: "/local-assets/app-icon",
    },
    textContent: "产品原型设计",
  });

  assert.equal(
    markdown,
    "[产品原型设计](mention://workspace-app/vibe-design?workspaceId=workspace-1&iconUrl=%2Flocal-assets%2Fapp-icon)",
  );
});

test("reference mention preview collapse keeps long mention hrefs intact", async () => {
  const {
    collapseReferenceMentionsForPreview,
    flattenReferenceMentionsToPlainText,
  } = await bundleModule(
    "src/app/reference-mentions.ts",
    "reference-mentions-preview-collapse",
  );
  const href = `mention://workspace-app/vibe-design?workspaceId=workspace-1&iconUrl=${encodeURIComponent(`data:image/png;base64,${"A".repeat(1200)}`)}`;
  const content = `[产品原型设计](${href})`;

  assert.equal(flattenReferenceMentionsToPlainText(content), "产品原型设计");
  assert.equal(collapseReferenceMentionsForPreview(content, 8), content);
});

test("reference mention preview collapse truncates text without breaking mention hrefs", async () => {
  const { collapseReferenceMentionsForPreview } = await bundleModule(
    "src/app/reference-mentions.ts",
    "reference-mentions-preview-mixed-collapse",
  );
  const href = "mention://workspace-app/vibe-design?workspaceId=workspace-1&iconUrl=data%3Aimage%2Fpng%3Bbase64%2CAAAA";
  const content = `请看 [产品原型设计](${href}) 后面的很长很长的说明文字`;

  assert.equal(
    collapseReferenceMentionsForPreview(content, 12),
    `请看 [产品原型设计](${href}) 后面...`,
  );
});

test("group files collapse repeated artifact aliases by content hash", async () => {
  const { filterGroupChatFiles } = await bundleModule(
    "src/app/artifact-actions.ts",
    "artifact-actions-dedupe",
  );
  const messages = [
    message({ id: "message-1" }),
    message({ id: "message-2", createdAt: "2026-01-01T00:01:00.000Z" }),
  ];
  const blocks = [
    { ...block("video-1", "file", "", 0), messageId: "message-1", metadata: { artifactId: "video-1" } },
    { ...block("video-2", "file", "", 0), messageId: "message-2", metadata: { artifactId: "video-2" } },
  ];
  const artifacts = [
    {
      id: "video-1",
      roomId: "room-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      sourceRunId: null,
      kind: "upload",
      filename: "video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 10,
      contentHash: "same-video-hash",
      localPath: "/tmp/video.mp4",
      publicUrl: "/local-assets/video-1",
      textPreview: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "video-2",
      roomId: "room-1",
      conversationId: "conversation-1",
      messageId: "message-2",
      sourceRunId: null,
      kind: "upload",
      filename: "video-copy.mp4",
      mimeType: "video/mp4",
      sizeBytes: 10,
      contentHash: "same-video-hash",
      localPath: "/tmp/video-copy.mp4",
      publicUrl: "/local-assets/video-2",
      textPreview: null,
      createdAt: "2026-01-01T00:01:00.000Z",
    },
  ];

  assert.deepEqual(
    filterGroupChatFiles(artifacts, messages, blocks, [], "conversation-1").map((artifact) => artifact.id),
    ["video-2"],
  );
});

test("message times use compact 24-hour formatting", async () => {
  const { formatMessageTime } = await bundleModule(
    "src/app/formatting.ts",
    "message-time-formatting",
  );
  const formatted = formatMessageTime("2026-01-01T16:38:00");
  assert.match(formatted, /^16:38$/);
  assert.doesNotMatch(formatted, /AM|PM/i);
});

test("conversation timestamps show time today and date for older messages", async () => {
  const { formatConversationListTimestamp } = await bundleModule(
    "src/app/formatting.ts",
    "conversation-time-formatting",
  );
  const now = new Date("2026-06-21T20:00:00");
  const today = formatConversationListTimestamp("2026-06-21T17:39:00", now);
  const older = formatConversationListTimestamp("2026-06-20T17:39:00", now);
  assert.match(today, /^17:39$/);
  assert.doesNotMatch(today, /AM|PM/i);
  assert.doesNotMatch(older, /:/);
  assert.match(older, /20/);
});

test("empty timeline state clears after the first user message exists", async () => {
  const { hasTimelineMessages } = await bundleModule(
    "src/app/message-timeline-state.ts",
    "message-timeline-state",
  );

  assert.equal(hasTimelineMessages([]), false);
  assert.equal(hasTimelineMessages([message()]), true);
  assert.equal(hasTimelineMessages([message({ status: "deleted" })]), false);
  assert.equal(hasTimelineMessages([message({ status: "recalled" })]), false);
});

function runEvent(id, type, status, metadata = null) {
  return {
    id,
    runId: "run-1",
    conversationId: "conversation-1",
    type,
    content: "",
    status,
    metadata,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("tool summaries count mixed successes and failures without marking the group failed", async () => {
  const { compactToolExecutionSections } = await bundleModule(
    "src/app/agent-thinking.ts",
    "agent-thinking-tool-summary",
  );
  const sections = [
    { kind: "event", id: "call-1", event: runEvent("call-1", "tool_call", "success") },
    { kind: "event", id: "call-2", event: runEvent("call-2", "tool_call", "success") },
    { kind: "event", id: "call-3", event: runEvent("call-3", "tool_call", "success") },
    { kind: "event", id: "call-4", event: runEvent("call-4", "tool_call", "success") },
    { kind: "event", id: "call-5", event: runEvent("call-5", "tool_call", "success") },
    { kind: "event", id: "call-6", event: runEvent("call-6", "tool_call", "success") },
    { kind: "event", id: "call-7", event: runEvent("call-7", "tool_call", "success") },
    { kind: "event", id: "result-1", event: runEvent("result-1", "tool_result", "success", { toolCallId: "call-1" }) },
    { kind: "event", id: "result-2", event: runEvent("result-2", "tool_result", "success", { toolCallId: "call-2" }) },
    { kind: "event", id: "result-3", event: runEvent("result-3", "tool_result", "success", { toolCallId: "call-3" }) },
    { kind: "event", id: "result-4", event: runEvent("result-4", "tool_result", "success", { toolCallId: "call-4" }) },
    { kind: "event", id: "result-5", event: runEvent("result-5", "tool_result", "success", { toolCallId: "call-5" }) },
    { kind: "event", id: "result-6", event: runEvent("result-6", "tool_result", "success", { toolCallId: "call-6" }) },
    { kind: "event", id: "result-7", event: runEvent("result-7", "tool_result", "error", { toolCallId: "call-7" }) },
  ];

  const summary = compactToolExecutionSections(sections);

  assert.equal(summary.length, 1);
  assert.equal(summary[0].kind, "tool_summary");
  assert.equal(summary[0].count, 7);
  assert.equal(summary[0].status, "success");
  assert.deepEqual(summary[0].stats, { successCount: 6, failedCount: 1, runningCount: 0 });
});

test("completed message process does not keep stale streaming indicators", async () => {
  const { collectMessageProcess, compactToolExecutionSections } = await bundleModule(
    "src/app/agent-thinking.ts",
    "agent-thinking-completed-process",
  );
  const message = {
    id: "message-1",
    conversationId: "conversation-1",
    role: "assistant",
    content: "done",
    status: "success",
    runId: "run-1",
  };
  const sections = collectMessageProcess(
    message,
    [{
      id: "reasoning-1",
      messageId: "message-1",
      type: "reasoning",
      content: "finished reasoning",
      status: "streaming",
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
    [runEvent("call-1", "tool_call", "streaming")],
    [{
      id: "run-1",
      assistantMessageId: "message-1",
      status: "completed",
    }],
  );
  const summary = compactToolExecutionSections(sections);

  assert.equal(sections[0].kind, "reasoning");
  assert.equal(sections[0].streaming, false);
  assert.equal(summary.at(-1).kind, "tool_summary");
  assert.equal(summary.at(-1).status, "success");
  assert.deepEqual(summary.at(-1).stats, { successCount: 1, failedCount: 0, runningCount: 0 });
});

test("inactive open process keeps tool calls without showing stale streaming", async () => {
  const { collectMessageProcess, compactToolExecutionSections } = await bundleModule(
    "src/app/agent-thinking.ts",
    "agent-thinking-inactive-process",
  );
  const message = {
    id: "message-1",
    conversationId: "conversation-1",
    role: "assistant",
    content: "done",
    status: "streaming",
    runId: "run-1",
  };
  const sections = collectMessageProcess(
    message,
    [{
      id: "reasoning-1",
      messageId: "message-1",
      type: "reasoning",
      content: "finished reasoning",
      status: "streaming",
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
    [runEvent("call-1", "tool_call", "streaming", { toolName: "exec_command", input: { cmd: "pnpm test" } })],
    [{
      id: "run-1",
      assistantMessageId: "message-1",
      status: "running",
    }],
    { forceSettled: true },
  );
  const summary = compactToolExecutionSections(sections);

  assert.equal(sections[0].kind, "reasoning");
  assert.equal(sections[0].streaming, false);
  assert.equal(summary.at(-1).kind, "tool_summary");
  assert.equal(summary.at(-1).count, 1);
  assert.equal(summary.at(-1).events[0].event.metadata.toolName, "exec_command");
  assert.equal(summary.at(-1).events[0].displayStatus, "success");
});

test("thinking markdown formatter splits dense process text into paragraphs", async () => {
  const { formatThinkingMarkdown } = await bundleModule(
    "src/app/components/chat/AgentThinkingPanel.tsx",
    "agent-thinking-panel-format",
  );
  const formatted = formatThinkingMarkdown(
    "我会按代码修改来处理： 先读本地规则和相关 skill，然后定位 agent-chat 的消息渲染/mention chip 代码，确认要改的是链接点击还是顺手把应用 icon 一并修掉。 agent-codex 这里是提及我来改代码，不需要启动另一个 Codex 会话。 我先定位仓库和现有渲染实现，然后按现有模式小范围修复。",
  );

  const paragraphs = formatted.split(/\n{2,}/).filter(Boolean);
  assert.ok(paragraphs.length >= 4, formatted);
  assert.equal(paragraphs[0], "我会按代码修改来处理：");
  assert.ok(paragraphs.some((paragraph) => paragraph.startsWith("然后定位 agent-chat")));
});

test("thinking markdown formatter removes empty fenced code blocks", async () => {
  const { formatThinkingMarkdown } = await bundleModule(
    "src/app/components/chat/AgentThinkingPanel.tsx",
    "agent-thinking-panel-empty-fence",
  );
  const formatted = formatThinkingMarkdown("开始\n\n```\n\n```\n\n~~~json\n   \n~~~\n\n结束");

  assert.equal(formatted, "开始\n\n结束");
});
