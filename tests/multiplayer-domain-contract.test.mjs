import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const buildShared = spawnSync("pnpm", ["--filter", "@group-chat/shared", "build"], {
  cwd: rootDir,
  encoding: "utf8",
  stdio: "pipe",
});
assert.equal(buildShared.status, 0, buildShared.stderr || buildShared.stdout);

const {
  isAgentRunVisibleToParticipant,
  isMessageVisibleToParticipant,
  resolveAgentRunVisibility,
  resolveMessageVisibility,
} = await import("../packages/shared/dist/index.js");

test("multiplayer visibility keeps public messages visible to every participant", () => {
  const message = makeMessage({
    id: "message-public",
    senderParticipantId: "user-alice",
    visibility: "public",
  });

  assert.equal(resolveMessageVisibility(message, [message]), "public");
  assert.equal(isMessageVisibleToParticipant(message, "user-alice"), true);
  assert.equal(isMessageVisibleToParticipant(message, "user-bob"), true);
  assert.equal(isMessageVisibleToParticipant(message, "agent-planner"), true);
});

test("multiplayer visibility hides whisper messages from non-mentioned participants", () => {
  const message = makeMessage({
    id: "message-whisper",
    senderParticipantId: "user-alice",
    visibility: "whisper",
    mentions: [
      mention("user-bob", "Bob"),
      mention("agent-planner", "Planner"),
    ],
  });

  assert.equal(resolveMessageVisibility(message, [message]), "whisper");
  assert.equal(isMessageVisibleToParticipant(message, "user-bob"), true);
  assert.equal(isMessageVisibleToParticipant(message, "agent-planner"), true);
  assert.equal(isMessageVisibleToParticipant(message, "user-carol"), false);
});

test("multiplayer visibility treats AI whisper replies as visible only to their target participant", () => {
  const assistant = makeMessage({
    id: "message-agent-whisper",
    role: "assistant",
    senderParticipantId: "agent-planner",
    senderName: "Planner",
    visibility: "whisper",
  });

  assert.equal(isMessageVisibleToParticipant(assistant, "agent-planner"), true);
  assert.equal(isMessageVisibleToParticipant(assistant, "agent-critic"), false);
  assert.equal(isMessageVisibleToParticipant(assistant, "user-bob"), false);
});

test("multiplayer visibility infers a user whisper from the targeted AI whisper reply", () => {
  const trigger = makeMessage({
    id: "message-trigger",
    senderParticipantId: "user-alice",
    visibility: "public",
    mentions: [mention("agent-planner", "Planner")],
    createdAt: "2026-06-15T01:00:00.000Z",
  });
  const assistant = makeMessage({
    id: "message-agent-whisper",
    role: "assistant",
    senderParticipantId: "agent-planner",
    senderName: "Planner",
    visibility: "whisper",
    createdAt: "2026-06-15T01:00:01.000Z",
  });

  assert.equal(resolveMessageVisibility(trigger, [trigger, assistant]), "whisper");
});

test("multiplayer visibility leaves @all public unless the message is explicitly whispered", () => {
  const message = makeMessage({
    id: "message-all",
    senderParticipantId: "user-alice",
    visibility: "public",
    mentions: [{ participantId: "all", displayNameSnapshot: "all", mentionType: "all" }],
  });

  assert.equal(resolveMessageVisibility(message, [message]), "public");
  assert.equal(isMessageVisibleToParticipant(message, "user-carol"), true);
});

test("multiplayer run visibility follows whisper trigger visibility", () => {
  const trigger = makeMessage({
    id: "message-whisper-trigger",
    senderParticipantId: "user-alice",
    visibility: "whisper",
    mentions: [mention("agent-planner", "Planner")],
  });
  const run = makeRun({
    id: "run-planner",
    participantId: "agent-planner",
    triggerMessageId: trigger.id,
  });

  assert.equal(resolveAgentRunVisibility(run, [trigger]), "whisper");
  assert.equal(isAgentRunVisibleToParticipant({ ...run, visibility: "whisper" }, "agent-planner"), true);
  assert.equal(isAgentRunVisibleToParticipant({ ...run, visibility: "whisper" }, "agent-critic"), false);
});

test.todo("multiplayer sender visibility includes the human sender once user ids are persisted on messages");
test.todo("multiplayer unread counts are stored and asserted per user id instead of browser-global localStorage");
test.todo("multiplayer message sender labels resolve by stable user/participant id when display names collide");

function mention(participantId, displayNameSnapshot) {
  return { participantId, displayNameSnapshot, mentionType: "participant" };
}

function makeMessage(overrides = {}) {
  return {
    id: overrides.id ?? "message-1",
    conversationId: overrides.conversationId ?? "conversation-1",
    role: overrides.role ?? "user",
    senderParticipantId: overrides.senderParticipantId ?? null,
    senderName: overrides.senderName ?? "Alice",
    content: overrides.content ?? "hello",
    mentions: overrides.mentions ?? [],
    visibility: overrides.visibility ?? "public",
    status: overrides.status ?? "success",
    branchId: null,
    parentMessageId: null,
    runId: overrides.runId ?? null,
    tokenUsage: null,
    createdAt: overrides.createdAt ?? "2026-06-15T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-15T00:00:00.000Z",
  };
}

function makeRun(overrides = {}) {
  return {
    id: overrides.id ?? "run-1",
    conversationId: overrides.conversationId ?? "conversation-1",
    roomId: overrides.roomId ?? "room-1",
    participantId: overrides.participantId ?? "agent-planner",
    assistantMessageId: overrides.assistantMessageId ?? null,
    triggerMessageId: overrides.triggerMessageId ?? null,
    runtime: "server-demo",
    provider: "demo",
    model: "demo",
    status: overrides.status ?? "running",
    visibility: overrides.visibility ?? "public",
    resumeMode: "fresh",
    createdAt: overrides.createdAt ?? "2026-06-15T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-15T00:00:00.000Z",
    completedAt: null,
    error: null,
  };
}
