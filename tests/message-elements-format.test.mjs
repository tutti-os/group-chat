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
