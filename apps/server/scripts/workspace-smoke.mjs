#!/usr/bin/env node
import { access, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? (9900 + Math.floor(Math.random() * 200)));
const timeoutMs = Number(args.timeoutMs ?? 60_000);
const keepHome = Boolean(args.keepHome);
const home = args.home ? resolve(String(args.home)) : await mkdtemp(`${tmpdir()}/group-chat-workspace-smoke-`);
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

  await waitForHealth(timeoutMs);
  const roomBundle = await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      title: "Workspace smoke",
      description: "Temporary workspace materialization smoke room.",
    }),
  });
  const { room, conversation } = roomBundle;
  const identityResult = await api("/api/identities", {
    method: "POST",
    body: JSON.stringify({
      name: "Workspace Smoke",
      icon: "WS",
      systemPrompt: "You are a workspace materialization smoke-test agent.",
      stylePrompt: "Keep replies short.",
      defaultRuntimeProfileId: "local-agent:codex",
    }),
  });
  const participantResult = await api(`/api/conversations/${conversation.id}/participants`, {
    method: "POST",
    body: JSON.stringify({
      identityId: identityResult.identity.id,
      runtimeProfileId: "local-agent:codex",
      listenMode: "active",
      reasoningEffort: "high",
      roomInstructions: "Workspace smoke participant instructions.",
    }),
  });
  const participant = participantResult.participant;

  const identityRoot = join(home, "identities", safePathSegment(identityResult.identity.id));
  const participantRoot = join(home, "rooms", room.id, "agents", safePathSegment(participant.id));
  await assertFiles(identityRoot, ["IDENTITY.md", "SOUL.md", "MEMORY.md", "DISTILLED_CONTEXT.md"]);
  await assertFiles(participantRoot, [
    "AGENTS.md",
    "BOOTSTRAP.md",
    "CLAUDE.md",
    "IDENTITY.md",
    "SOUL.md",
    "OWNER.md",
    "MEMORY.md",
    "DISTILLED_CONTEXT.md",
  ]);
  await assertFiles(join(participantRoot, "memory", "users"), []);
  await assertFiles(join(participantRoot, "skills"), []);
  await assertFiles(join(participantRoot, "conversations"), []);

  await assertFileContains(join(participantRoot, "AGENTS.md"), [
    "Workspace Smoke",
    "Reasoning effort: high",
    "Workspace smoke participant instructions.",
  ]);
  await assertFileContains(join(participantRoot, "IDENTITY.md"), ["Reasoning effort: high"]);
  await assertFileContains(join(participantRoot, "BOOTSTRAP.md"), [
    "Workspace smoke",
    "Room-Specific Instructions",
  ]);

  await api(`/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content:
        "prefer concise smoke-test answers. Confirm that workspace memory can be updated.",
      mentions: [
        {
          participantId: participant.id,
          displayNameSnapshot: participant.displayName,
          mentionType: "participant",
        },
      ],
    }),
  });
  const { assistant } = await waitForAssistant(conversation.id, participant.id, timeoutMs);
  assert(assistant.status === "success", `assistant finished with ${assistant.status}`);

  await assertFiles(participantRoot, [
    join("memory", "users", "local-user.md"),
    join("conversations", `${conversation.id}.md`),
    join("conversations", `${conversation.id}.summary.md`),
    "DISTILLED_CONTEXT.md",
  ]);
  await assertFileContains(join(participantRoot, "conversations", `${conversation.id}.md`), [
    "prefer concise smoke-test answers",
    "Workspace Smoke",
  ]);
  await assertFileContains(join(participantRoot, "DISTILLED_CONTEXT.md"), [
    "User Signals",
    "prefer concise smoke-test answers",
    conversation.id,
  ]);
  await assertFileContains(join(participantRoot, "MEMORY.md"), [
    "group-chat:generated-memory:start",
    "Recent Conversation Digest",
  ]);
  await assertFileContains(join(participantRoot, "memory", "users", "local-user.md"), [
    "Extracted Signals",
    "prefer concise smoke-test answers",
  ]);

  logResult("summary", {
    ok: true,
    elapsedMs: Date.now() - startedAt,
    identityRoot,
    participantRoot,
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

async function waitForHealth(timeoutMs) {
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

async function assertFiles(root, files) {
  await access(root, constants.F_OK);
  const stat = await lstat(root);
  assert(stat.isDirectory(), `${root} is not a directory`);
  for (const file of files) {
    await access(join(root, file), constants.F_OK);
  }
}

async function assertFileContains(path, expectedSnippets) {
  const content = await readFile(path, "utf8");
  for (const snippet of expectedSnippets) {
    assert(content.includes(snippet), `${path} does not include ${JSON.stringify(snippet)}`);
  }
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

function safePathSegment(value) {
  return value.replace(/[^\w.-]/g, "_") || "unknown";
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
  process.stdout.write(`[workspace-smoke] ${label} ${JSON.stringify(payload, null, 2)}\n`);
}
