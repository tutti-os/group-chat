#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

const args = parseArgs(process.argv.slice(2));
const provider = args.provider ?? "codex";
const port = Number(args.port ?? (9300 + Math.floor(Math.random() * 400)));
const timeoutMs = Number(args.timeoutMs ?? 180_000);
const prompt =
  args.prompt ??
  "This is a group-chat local-agent smoke test. Reply with one short sentence that starts with: group-chat smoke ok";
const keepHome = Boolean(args.keepHome);
const detectOnly = Boolean(args.detectOnly);
const home = args.home ? resolve(String(args.home)) : await mkdtemp(`${tmpdir()}/group-chat-local-agent-smoke-`);
const baseUrl = `http://127.0.0.1:${port}`;
const startedAt = Date.now();

let server;
try {
  server = spawn("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", "src/main.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GROUP_CHAT_HOME: home,
      GROUP_CHAT_LOCAL_AGENT_TIMEOUT_MS: String(timeoutMs),
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => process.stdout.write(prefixLines("server", chunk)));
  server.stderr.on("data", (chunk) => process.stderr.write(prefixLines("server", chunk)));

  await waitForHealth(baseUrl, timeoutMs);
  const detections = await api(baseUrl, "/api/local-agent/providers");
  const detection = detections.providers.find((item) => item.provider === provider);
  if (!detection) throw new Error(`Provider ${provider} is not registered.`);
  if (!detection.available) {
    throw new Error(`Provider ${provider} is unavailable: ${detection.reason ?? "unknown reason"}`);
  }
  logResult("detect", {
    provider: detection.provider,
    displayName: detection.displayName,
    version: detection.version,
    executablePath: detection.executablePath,
    authState: detection.authState,
  });
  if (detectOnly) {
    logResult("summary", { ok: true, provider, mode: "detect-only", home });
    process.exitCode = 0;
  } else {
    const roomBundle = await api(baseUrl, "/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        title: `Local ${provider} smoke`,
        description: "Temporary local-agent compatibility smoke room.",
      }),
    });
    const conversationId = roomBundle.conversation.id;
    const identityResult = await api(baseUrl, "/api/identities", {
      method: "POST",
      body: JSON.stringify({
        name: `${detection.displayName} Smoke`,
        icon: provider.slice(0, 2).toUpperCase(),
        systemPrompt:
          "You are running inside an automated group-chat smoke test. Keep the answer short and do not modify files unless explicitly asked.",
        stylePrompt: "",
        defaultRuntimeProfileId: `local-agent:${provider}`,
      }),
    });
    await api(baseUrl, `/api/conversations/${conversationId}/participants`, {
      method: "POST",
      body: JSON.stringify({
        identityId: identityResult.identity.id,
        runtimeProfileId: `local-agent:${provider}`,
      }),
    });
    await api(baseUrl, `/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: prompt }),
    });

    const { assistant, blocks } = await waitForAssistant(baseUrl, conversationId, timeoutMs);
    if (assistant.status !== "success") {
      throw new Error(`Assistant finished with ${assistant.status}: ${assistant.content}`);
    }
    if (!assistant.content.trim()) {
      throw new Error("Assistant succeeded with empty content.");
    }
    logResult("assistant", {
      status: assistant.status,
      content: assistant.content,
      blockTypes: blocks.map((block) => `${block.type}:${block.status}`),
    });
    logResult("summary", {
      ok: true,
      provider,
      elapsedMs: Date.now() - startedAt,
      home,
    });
  }
} finally {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await waitForExit(server, 5_000).catch(() => server.kill("SIGKILL"));
  }
  if (!keepHome && !args.home) {
    await rm(home, { recursive: true, force: true });
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

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // keep polling while the dev server starts
    }
    await delay(250);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms.`);
}

async function waitForAssistant(baseUrl, conversationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await api(baseUrl, "/api/bootstrap");
    const assistant = snapshot.messages.find(
      (message) => message.conversationId === conversationId && message.role === "assistant",
    );
    if (assistant && ["success", "error", "cancelled"].includes(assistant.status)) {
      const blocks = snapshot.messageBlocks.filter((block) => block.messageId === assistant.id);
      return { assistant, blocks };
    }
    await delay(500);
  }
  throw new Error(`Assistant did not finish within ${timeoutMs}ms.`);
}

async function api(baseUrl, path, init) {
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
  process.stdout.write(`[local-agent-smoke] ${label} ${JSON.stringify(payload, null, 2)}\n`);
}
