import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadStateModule() {
  const outfile = "/tmp/agent-run-state.test.mjs";
  const build = spawnSync(
    "pnpm",
    ["--filter", "@group-chat/web", "exec", "esbuild", "src/app/state.ts", "--bundle", "--platform=browser", "--format=esm", `--outfile=${outfile}`],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(outfile)}?t=${Date.now()}`);
}

test("snapshot normalization drops active runs that already have a final run record", async () => {
  const { normalizeSnapshot } = await loadStateModule();
  const activeRun = createRun({ status: "running" });
  const completedRun = createRun({ status: "completed", completedAt: "2026-01-01T00:01:00.000Z" });

  const state = normalizeSnapshot(createSnapshot({
    agentRuns: [completedRun],
    activeRuns: [activeRun],
  }));

  assert.deepEqual(state.activeRuns, []);
  assert.equal(state.agentRuns[0].status, "completed");
});

test("snapshot normalization drops active runs whose assistant message is final", async () => {
  const { normalizeSnapshot } = await loadStateModule();

  const state = normalizeSnapshot(createSnapshot({
    messages: [createMessage({ status: "success" })],
    agentRuns: [createRun({ status: "running" })],
    activeRuns: [createRun({ status: "running" })],
  }));

  assert.deepEqual(state.activeRuns, []);
});

function createSnapshot(overrides = {}) {
  return {
    rooms: [],
    conversations: [],
    participants: [],
    identities: [],
    runtimeProfiles: [],
    messages: [],
    messageBlocks: [],
    agentRunEvents: [],
    artifacts: [],
    agentRuns: [],
    activeRuns: [],
    lastSeq: 0,
    ...overrides,
  };
}

function createRun(overrides = {}) {
  return {
    id: "run-1",
    conversationId: "conversation-1",
    roomId: "room-1",
    participantId: "participant-1",
    assistantMessageId: "message-1",
    triggerMessageId: "trigger-1",
    runtime: "local-agent",
    provider: "codex",
    model: "gpt-5",
    visibility: "public",
    status: "running",
    resumeMode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    error: null,
    ...overrides,
  };
}

function createMessage(overrides = {}) {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "assistant",
    senderParticipantId: "participant-1",
    senderName: "Agent",
    content: "done",
    visibility: "public",
    status: "streaming",
    runId: "run-1",
    mentions: [],
    attachments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
