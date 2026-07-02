import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadModule() {
  const output = "/tmp/identity-avatar.test.mjs";
  const build = spawnSync(
    "pnpm",
    [
      "--filter", "@group-chat/web", "exec", "esbuild",
      "src/app/identity-avatar.ts",
      "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

const codexProfile = {
  id: "local-agent:codex",
  kind: "local-agent",
  provider: "codex",
  model: "codex:default",
  displayName: "Codex Local Agent",
  enabled: true,
  trustedMode: false,
  systemPromptMode: "prompt-prefix",
  capabilities: { streaming: true, toolUse: true, reasoning: true, vision: false, resume: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("local agents without custom avatars fall back to their runtime provider icon", async () => {
  const { resolveAgentAvatar } = await loadModule();

  assert.deepEqual(
    resolveAgentAvatar({
      avatar: null,
      icon: null,
      participantId: "participant-codex",
      runtimeProfile: codexProfile,
    }),
    { avatar: null, provider: "codex" },
  );
});

test("custom agent avatars still override runtime provider icons", async () => {
  const { resolveAgentAvatar } = await loadModule();

  assert.deepEqual(
    resolveAgentAvatar({
      avatar: "https://example.test/avatar.png",
      icon: null,
      participantId: "participant-codex",
      runtimeProfile: codexProfile,
    }),
    { avatar: "https://example.test/avatar.png", provider: null },
  );
});
