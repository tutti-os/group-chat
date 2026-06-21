import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadModule() {
  const output = "/tmp/local-agent-mention-options.test.mjs";
  const build = spawnSync(
    "pnpm",
    [
      "--filter", "@group-chat/web", "exec", "esbuild",
      "src/app/local-agent-mention-options.ts",
      "--bundle", "--platform=browser", "--format=esm", `--outfile=${output}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

const runtimeProfile = {
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

function providerStatus(available) {
  return {
    provider: "codex",
    displayName: "Codex",
    available,
    authState: available ? "ok" : "missing",
    executablePath: available ? "/usr/local/bin/codex" : "",
    version: available ? "1.2.3" : "not-installed",
    models: [],
  };
}

test("lists Tutti agents using the same availability fallbacks as the forward menu", async () => {
  const { buildLocalAgentMentionOptions } = await loadModule();

  const localProviderOptions = buildLocalAgentMentionOptions(
    [runtimeProfile],
    [providerStatus(true)],
    [],
    [],
    "",
    new Set(),
  );
  assert.deepEqual(localProviderOptions.map((option) => option.label), ["Codex"]);

  const bridgeOptions = buildLocalAgentMentionOptions(
    [runtimeProfile],
    [providerStatus(false)],
    [],
    [],
    "",
    new Set(),
    true,
  );
  assert.deepEqual(bridgeOptions.map((option) => option.label), ["Codex"]);

  const unavailableOptions = buildLocalAgentMentionOptions(
    [runtimeProfile],
    [providerStatus(false)],
    [],
    [],
    "",
    new Set(),
  );
  assert.deepEqual(unavailableOptions, []);
});
