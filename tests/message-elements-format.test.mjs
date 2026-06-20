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

test("message times use compact 24-hour formatting", async () => {
  const { formatMessageTime } = await bundleModule(
    "src/app/formatting.ts",
    "message-time-formatting",
  );
  const formatted = formatMessageTime("2026-01-01T16:38:00");
  assert.match(formatted, /^16:38$/);
  assert.doesNotMatch(formatted, /AM|PM/i);
});
