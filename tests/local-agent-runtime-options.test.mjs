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
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER_THREADS: "0" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

const codexProfile = {
  id: "local-agent:codex",
  kind: "local-agent",
  agentTargetId: "agent:codex:primary",
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

const claudeProfile = {
  ...codexProfile,
  id: "local-agent:claude-code",
  agentTargetId: "agent:claude:primary",
  provider: "claude-code",
  model: "claude-code:default",
  displayName: "Claude Local Agent",
};

test("default runtime skips available providers without a matching profile", async () => {
  const { preferredDefaultRuntimeProfile } = await loadModule();
  const providers = [
    { agentTargetId: "agent:cursor:primary", provider: "cursor", available: true },
    { agentTargetId: "agent:claude:primary", provider: "claude-code", available: true },
  ];

  assert.equal(preferredDefaultRuntimeProfile([codexProfile, claudeProfile], providers), claudeProfile);
});

test("same-provider Agent targets keep independent runtime status", async () => {
  const { localAgentStatus } = await loadModule();
  const cloneProfile = { ...codexProfile, id: "local-agent:codex-clone", agentTargetId: "agent:codex:clone" };
  const agents = [
    { agentTargetId: "agent:codex:primary", provider: "codex", displayName: "Primary", available: true, models: [] },
    { agentTargetId: "agent:codex:clone", provider: "codex", displayName: "Clone", available: false, models: [] },
  ];
  assert.equal(localAgentStatus(codexProfile, agents)?.displayName, "Primary");
  assert.equal(localAgentStatus(cloneProfile, agents)?.displayName, "Clone");
});

test("Agent target ids containing model separators remain visible as canonical profiles", async () => {
  const { listCanonicalRuntimeProfiles, resolveCanonicalRuntimeProfile } = await loadModule();
  const base = {
    ...codexProfile,
    id: "local-agent-target:workspace__primary",
    agentTargetId: "workspace__primary",
    model: "gpt-default",
  };
  const variant = { ...base, id: `${base.id}__gpt-fast`, model: "gpt-fast" };

  assert.deepEqual(listCanonicalRuntimeProfiles([base, variant]).map((profile) => profile.id), [base.id]);
  assert.equal(resolveCanonicalRuntimeProfile(variant, [base, variant])?.id, base.id);
});

test("catalog canonical profile wins over an older migrated custom-model profile", async () => {
  const { listCanonicalRuntimeProfiles } = await loadModule();
  const migratedCustom = {
    ...codexProfile,
    id: "local-agent:codex__custom",
    model: "custom-model",
  };
  const catalogCanonical = {
    ...codexProfile,
    id: "local-agent-target:v1:6167656e743a636f6465783a7072696d617279",
    model: "catalog-default",
  };

  assert.deepEqual(
    listCanonicalRuntimeProfiles([migratedCustom, catalogCanonical]).map((profile) => profile.id),
    [catalogCanonical.id],
  );
});

test("local agent model options use detected provider models instead of provider-prefixed defaults", async () => {
  const { listRuntimeModels, preferredRuntimeModelId, resolveRuntimeModelId } = await loadModule();
  const providers = [{
    agentTargetId: "agent:codex:primary",
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
  assert.equal(resolveRuntimeModelId(codexProfile, providers, "codex:default"), "gpt-5.5");
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

test("speed options do not infer provider-specific choices", async () => {
  const { listRuntimeSpeedOptions, resolveRuntimeSpeedMode } = await loadModule();

  assert.deepEqual(
    listRuntimeSpeedOptions(codexProfile, []).map((option) => option.id),
    ["standard"],
  );
  assert.equal(resolveRuntimeSpeedMode(codexProfile, [], "fast"), "standard");
  assert.equal(resolveRuntimeSpeedMode(codexProfile, [], "unknown"), "standard");
});

test("local agent reasoning options follow provider options without auto", async () => {
  const { listRuntimeReasoningOptions } = await loadModule();
  const allOptions = [
    { value: "", label: "Auto", description: "" },
    { value: "low", label: "Low", description: "" },
    { value: "medium", label: "Medium", description: "" },
    { value: "high", label: "High", description: "" },
    { value: "xhigh", label: "Very high", description: "" },
  ];
  const providers = [{
    agentTargetId: "agent:codex:primary",
    provider: "codex",
    displayName: "Codex",
    available: true,
    authState: "ok",
    executablePath: "/usr/local/bin/codex",
    version: "1.2.3",
    models: [
      {
        id: "gpt-5.5",
        label: "GPT-5.5",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
      },
    ],
  }];

  assert.deepEqual(
    listRuntimeReasoningOptions(codexProfile, providers, "gpt-5.5", allOptions).map((option) => option.value),
    ["low", "medium", "high", "xhigh"],
  );
});
