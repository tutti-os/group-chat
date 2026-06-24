import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadModule() {
  const output = "/tmp/local-agent-runtime-options.test.mjs";
  const build = spawnSync(
    "pnpm",
    [
      "--filter", "@group-chat/web", "exec", "esbuild",
      "src/app/runtime.tsx",
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

test("local agent model options use detected provider models instead of provider-prefixed defaults", async () => {
  const { listRuntimeModels, preferredRuntimeModelId } = await loadModule();
  const providers = [{
    provider: "codex",
    displayName: "Codex",
    available: true,
    authState: "ok",
    executablePath: "/usr/local/bin/codex",
    version: "1.2.3",
    models: [
      { id: "default", label: "Default (CLI config)" },
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
    ],
    defaultModelId: "gpt-5.5",
  }];

  assert.deepEqual(
    listRuntimeModels(codexProfile, providers).map((option) => option.id),
    ["gpt-5.5", "gpt-5.4"],
  );
  assert.equal(preferredRuntimeModelId(codexProfile, providers), "gpt-5.5");
});

test("local agent model options normalize canonical default profiles to CLI default", async () => {
  const { listRuntimeModels, normalizeRuntimeModelId, preferredRuntimeModelId } = await loadModule();

  assert.equal(normalizeRuntimeModelId(codexProfile, "codex:default"), "default");
  assert.deepEqual(
    listRuntimeModels(codexProfile, []).map((option) => option.id),
    ["default"],
  );
  assert.equal(preferredRuntimeModelId(codexProfile, []), "default");
});
