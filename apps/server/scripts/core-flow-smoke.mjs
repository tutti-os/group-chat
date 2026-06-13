#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? (9700 + Math.floor(Math.random() * 300)));
const timeoutMs = Number(args.timeoutMs ?? 60_000);
const keepHome = Boolean(args.keepHome);
const home = args.home ? resolve(String(args.home)) : await mkdtemp(`${tmpdir()}/group-chat-core-flow-smoke-`);
const baseUrl = `http://127.0.0.1:${port}`;
const startedAt = Date.now();

let server;
try {
  server = spawn("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", "src/main.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GROUP_CHAT_HOME: home,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => process.stdout.write(prefixLines("server", chunk)));
  server.stderr.on("data", (chunk) => process.stderr.write(prefixLines("server", chunk)));

  await waitForHealth(baseUrl, timeoutMs);
  const roomBundle = await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      title: "Core flow smoke",
      description: "Temporary smoke room.",
    }),
  });
  const { room, conversation } = roomBundle;

  const updatedRoomBundle = await api(`/api/rooms/${room.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Core flow smoke updated",
      description: "Updated temporary smoke room.",
    }),
  });
  assert(updatedRoomBundle.room.title === "Core flow smoke updated", "room title did not update");
  assert(updatedRoomBundle.room.description === "Updated temporary smoke room.", "room description did not update");
  assert(updatedRoomBundle.conversation.title === "Core flow smoke updated", "conversation title did not follow room title");
  assert(
    updatedRoomBundle.conversation.groupSystemPrompt === "Updated temporary smoke room.",
    "conversation prompt did not follow room description",
  );

  await api(`/api/conversations/${conversation.id}/policy`, {
    method: "PATCH",
    body: JSON.stringify({
      replyPolicy: {
        mode: "all",
        order: "sequential",
        maxRounds: 1,
        mentionFollowupRounds: 0,
      },
    }),
  });

  const agentA = await createIdentity("Agent Smoke A", "A1", "local-agent:codex");
  const agentB = await createIdentity("Agent Smoke B", "B1", "local-agent:codex");
  const agentAParticipant = await addParticipant(conversation.id, agentA.identity.id, "local-agent:codex");
  const agentBParticipant = await addParticipant(conversation.id, agentB.identity.id, "local-agent:codex");

  const artifactResult = await api(`/api/conversations/${conversation.id}/artifacts`, {
    method: "POST",
    body: JSON.stringify({
      filename: "brief.txt",
      mimeType: "text/plain",
      dataBase64: Buffer.from("Smoke attachment: prefer concise answers.", "utf8").toString("base64"),
    }),
  });

  const sendResult = await api(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `@${agentAParticipant.displayName} please inspect the attached brief.`,
      artifactIds: [artifactResult.artifact.id],
      mentions: [
        {
          participantId: agentAParticipant.id,
          displayNameSnapshot: agentAParticipant.displayName,
          mentionType: "participant",
        },
      ],
    }),
  });
  assert(sendResult.targets.length === 1, `expected one target, got ${sendResult.targets.length}`);
  assert(sendResult.targets[0].id === agentAParticipant.id, "mention target did not resolve to first agent participant");

  const { snapshot, assistant } = await waitForAssistant(conversation.id, agentAParticipant.id, timeoutMs);
  assert(assistant.status === "success", `assistant finished with ${assistant.status}`);
  assert(assistant.senderParticipantId === agentAParticipant.id, "assistant sender is not the mentioned participant");
  const conversationAssistants = snapshot.messages.filter((message) => message.conversationId === conversation.id && message.role === "assistant");
  assert(conversationAssistants.length === 1, `expected one assistant reply, got ${conversationAssistants.length}`);
  const userBlocks = snapshot.messageBlocks.filter((block) => block.messageId === sendResult.message.id);
  assert(userBlocks.some((block) => block.type === "main_text"), "user main_text block missing");
  assert(userBlocks.some((block) => block.type === "file" && block.metadata?.artifactId === artifactResult.artifact.id), "file block missing");

  await api(`/api/conversations/${conversation.id}/policy`, {
    method: "PATCH",
    body: JSON.stringify({
      replyPolicy: {
        mode: "selected",
        order: "sequential",
        maxRounds: 1,
        mentionFollowupRounds: 0,
      },
    }),
  });
  const referenceResult = await api(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: "Reuse the existing room file without moving the original attachment.",
      artifactIds: [artifactResult.artifact.id],
      mentions: [],
    }),
  });
  assert(referenceResult.targets.length === 0, `expected no selected-mode targets, got ${referenceResult.targets.length}`);
  const referenceSnapshot = await api("/api/bootstrap");
  const originalArtifact = referenceSnapshot.artifacts.find((artifact) => artifact.id === artifactResult.artifact.id);
  assert(originalArtifact?.messageId === sendResult.message.id, "reusing a room file moved the original artifact");
  const referenceBlocks = referenceSnapshot.messageBlocks.filter((block) => block.messageId === referenceResult.message.id);
  const referenceBlock = referenceBlocks.find((block) => block.type === "file");
  const referencedArtifactId = referenceBlock?.metadata?.artifactId;
  const referencedArtifact = referenceSnapshot.artifacts.find((artifact) => artifact.id === referencedArtifactId);
  assert(referenceBlock, "reused room file block missing");
  assert(referencedArtifact, "reused room file artifact missing");
  assert(referencedArtifact.id !== originalArtifact.id, "reused room file did not create a distinct message reference");
  assert(referencedArtifact.messageId === referenceResult.message.id, "reused room file did not bind to the new message");
  assert(referencedArtifact.localPath === originalArtifact.localPath, "reused room file should point to the same local file");

  const allMentionResult = await api(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: "@all no reply, just verifying target resolution.",
      artifactIds: [],
      mentions: [
        {
          participantId: "all",
          displayNameSnapshot: "all",
          mentionType: "all",
        },
      ],
    }),
  });
  assert(allMentionResult.targets.length === 2, `expected two @all targets, got ${allMentionResult.targets.length}`);
  const allTargetIds = new Set(allMentionResult.targets.map((target) => target.id));
  assert(allTargetIds.has(agentAParticipant.id), "@all did not target first agent");
  assert(allTargetIds.has(agentBParticipant.id), "@all did not target second agent");
  await waitForNoActiveRuns(conversation.id, timeoutMs);

  const cancelResult = await api(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `@${agentAParticipant.displayName} cancellation smoke ${"detail ".repeat(160)}`,
      artifactIds: [],
      mentions: [
        {
          participantId: agentAParticipant.id,
          displayNameSnapshot: agentAParticipant.displayName,
          mentionType: "participant",
        },
      ],
    }),
  });
  assert(cancelResult.targets.length === 1, `expected one cancellation target, got ${cancelResult.targets.length}`);
  const activeRun = await waitForActiveRun(conversation.id, agentAParticipant.id, timeoutMs);
  const cancelledRun = await api(`/api/runs/${activeRun.id}/cancel`, { method: "POST" });
  assert(cancelledRun.run.status === "cancelled", `expected cancelled run, got ${cancelledRun.run.status}`);
  const cancelledSnapshot = await api("/api/bootstrap");
  assert(!cancelledSnapshot.activeRuns.some((run) => run.id === activeRun.id), "cancelled run still active");
  const cancelledAssistant = cancelledSnapshot.messages.find((message) => message.runId === activeRun.id);
  assert(
    !cancelledAssistant || cancelledAssistant.status === "cancelled",
    "cancelled assistant message should be absent or marked cancelled",
  );

  const removed = await api(`/api/participants/${agentBParticipant.id}`, { method: "DELETE" });
  assert(removed.participant.status === "removed", "participant delete did not mark removed");

  await api(`/api/rooms/${room.id}`, { method: "DELETE" });
  const finalSnapshot = await api("/api/bootstrap");
  assert(!finalSnapshot.rooms.some((item) => item.id === room.id), "deleted room still present");
  assert(!finalSnapshot.conversations.some((item) => item.id === conversation.id), "deleted conversation still present");

  logResult("summary", {
    ok: true,
    elapsedMs: Date.now() - startedAt,
    roomId: room.id,
    conversationId: conversation.id,
    assistant: assistant.content,
    home,
  });
} finally {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await waitForExit(server, 5_000).catch(() => server.kill("SIGKILL"));
  }
  if (!keepHome && !args.home) {
    await rm(home, { recursive: true, force: true });
  }
}

async function createIdentity(name, icon, defaultRuntimeProfileId) {
  return api("/api/identities", {
    method: "POST",
    body: JSON.stringify({
      name,
      icon,
      systemPrompt: `You are ${name}. Keep smoke-test replies short.`,
      stylePrompt: "",
      defaultRuntimeProfileId,
    }),
  });
}

async function addParticipant(conversationId, identityId, runtimeProfileId) {
  const result = await api(`/api/conversations/${conversationId}/participants`, {
    method: "POST",
    body: JSON.stringify({
      identityId,
      runtimeProfileId,
      listenMode: "active",
    }),
  });
  return result.participant;
}

async function waitForAssistant(conversationId, participantId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await api("/api/bootstrap");
    const assistant = snapshot.messages.find(
      (message) =>
        message.conversationId === conversationId &&
        message.role === "assistant" &&
        message.senderParticipantId === participantId &&
        ["success", "error", "cancelled"].includes(message.status),
    );
    if (assistant) return { snapshot, assistant };
    await delay(250);
  }
  throw new Error(`Assistant did not finish within ${timeoutMs}ms.`);
}

async function waitForNoActiveRuns(conversationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await api("/api/bootstrap");
    const activeRuns = snapshot.activeRuns.filter((run) => run.conversationId === conversationId);
    if (activeRuns.length === 0) return;
    await delay(250);
  }
  throw new Error(`Active runs did not finish within ${timeoutMs}ms.`);
}

async function waitForActiveRun(conversationId, participantId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await api("/api/bootstrap");
    const run = snapshot.activeRuns.find(
      (item) => item.conversationId === conversationId && item.participantId === participantId,
    );
    if (run) return run;
    await delay(100);
  }
  throw new Error(`Active run did not start within ${timeoutMs}ms.`);
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // keep polling while the server starts
    }
    await delay(250);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms.`);
}

async function api(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for server exit.")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function prefixLines(prefix, chunk) {
  return String(chunk)
    .split(/(?<=\n)/)
    .map((line) => (line.trim() ? `[${prefix}] ${line}` : line))
    .join("");
}

function logResult(label, payload) {
  process.stdout.write(`[core-flow-smoke] ${label} ${JSON.stringify(payload, null, 2)}\n`);
}
