import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadWebModule(source, outputName) {
  const output = `/tmp/${outputName}.test.mjs`;
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", source,
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

function message(overrides) {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "user",
    senderParticipantId: null,
    senderName: null,
    content: "hello",
    mentions: [],
    status: "success",
    visibility: "public",
    branchId: null,
    parentMessageId: null,
    runId: null,
    tokenUsage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("message updates preserve references for unchanged messages", async () => {
  const { upsertMessage } = await loadWebModule("src/app/state.ts", "state-performance");
  const unchanged = message({ id: "message-1" });
  const existing = message({ id: "message-2", role: "assistant", content: "old" });
  const incoming = { ...existing, content: "new", updatedAt: "2026-01-01T00:00:01.000Z" };

  const result = upsertMessage([unchanged, existing], incoming);

  assert.equal(result[0], unchanged);
  assert.equal(result[1], incoming);
  assert.equal(result[1].content, "new");
});

test("preview index keeps the newest eligible message for each conversation", async () => {
  const { buildLatestPreviewMessageIndex } = await loadWebModule(
    "src/app/conversation-preview-index.ts",
    "conversation-preview-index",
  );
  const first = message({ id: "first", content: "first", createdAt: "2026-01-01T00:00:00.000Z" });
  const ignored = message({ id: "ignored", role: "assistant", status: "cancelled", content: "" });
  const latest = message({ id: "latest", content: "latest", createdAt: "2026-01-01T00:01:00.000Z" });
  const other = message({ id: "other", conversationId: "conversation-2" });

  const index = buildLatestPreviewMessageIndex([latest, ignored, first, other]);

  assert.equal(index.get("conversation-1"), latest);
  assert.equal(index.get("conversation-2"), other);
});
