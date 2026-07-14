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

function providerStatus(available, displayName = "Codex") {
  return {
    agentTargetId: "agent:codex:primary",
    providerId: "codex",
    provider: "codex",
    displayName,
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
  );
  assert.deepEqual(localProviderOptions.map((option) => option.label), ["Codex"]);

  const bridgeOptions = buildLocalAgentMentionOptions(
    [runtimeProfile],
    [providerStatus(false)],
    [],
    [],
    "",
  );
  assert.deepEqual(bridgeOptions, []);

  const unavailableOptions = buildLocalAgentMentionOptions(
    [runtimeProfile],
    [providerStatus(false)],
    [],
    [],
    "",
  );
  assert.deepEqual(unavailableOptions, []);
});

test("local Tutti agent launcher references retain the matching room participant", async () => {
  const { buildLocalAgentLauncherReference, buildLocalAgentMentionOptions } = await loadModule();
  const participant = {
    id: "participant-codex",
    conversationId: "conversation-1",
    kind: "ai",
    displayName: "Codex CLI",
    avatar: null,
    runtimeProfileId: "local-agent:codex",
    agentTargetId: "agent:codex:primary",
    identityId: null,
    roomInstructions: "",
    status: "active",
    listenMode: "passive",
    sortOrder: 0,
    reasoningEffort: null,
    speedMode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const options = buildLocalAgentMentionOptions(
    [runtimeProfile],
    [providerStatus(true, "Codex CLI")],
    [participant],
    [],
    "",
  );

  assert.equal(options[0]?.label, "Codex CLI");
  assert.equal(options[0]?.participant?.id, "participant-codex");
  const reference = buildLocalAgentLauncherReference(options[0]);
  assert.equal(reference.providerId, "agent-session");
  assert.equal(reference.itemId, "agent:codex:primary");
  assert.equal(reference.insert.mention.scope.groupChatAgentTargetId, "agent:codex:primary");
  assert.equal(reference.insert.mention.scope.groupChatParticipantId, "participant-codex");
  assert.equal(reference.insert.mention.scope.groupChatParticipantLabel, "Codex CLI");
});

test("local agent participant binding honors an identity default runtime profile", async () => {
  const { buildLocalAgentLauncherReference, buildLocalAgentMentionOptions } = await loadModule();
  const identity = {
    id: "identity-legacy",
    name: "Codex CLI",
    icon: null,
    rolePrompt: "",
    stylePrompt: "",
    defaultRuntimeProfileId: runtimeProfile.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const participant = {
    id: "participant-legacy",
    conversationId: "conversation-1",
    kind: "ai",
    displayName: "Codex CLI",
    avatar: null,
    runtimeProfileId: null,
    agentTargetId: runtimeProfile.agentTargetId,
    identityId: identity.id,
    roomInstructions: "",
    status: "active",
    listenMode: "passive",
    sortOrder: 0,
    reasoningEffort: null,
    speedMode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const options = buildLocalAgentMentionOptions(
    [runtimeProfile],
    [providerStatus(true, "Codex CLI")],
    [participant],
    [identity],
    "",
  );
  assert.equal(options[0]?.participant?.id, participant.id);
  const reference = buildLocalAgentLauncherReference(options[0]);
  assert.equal(reference.insert.mention.scope.groupChatParticipantId, participant.id);
  assert.equal(reference.insert.mention.scope.groupChatRuntimeProfileId, runtimeProfile.id);
});

test("participant mentions preserve the participant's model-specific runtime profile", async () => {
  const { buildLocalAgentLauncherReference, buildLocalAgentMentionOptions } = await loadModule();
  const modelProfile = {
    ...runtimeProfile,
    id: `${runtimeProfile.id}__gpt-fast`,
    model: "gpt-fast",
  };
  const participant = {
    id: "participant-fast",
    conversationId: "conversation-1",
    kind: "ai",
    displayName: "Codex CLI",
    avatar: null,
    runtimeProfileId: modelProfile.id,
    agentTargetId: modelProfile.agentTargetId,
    identityId: null,
    roomInstructions: "",
    status: "active",
    listenMode: "passive",
    sortOrder: 0,
    reasoningEffort: null,
    speedMode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const options = buildLocalAgentMentionOptions(
    [runtimeProfile, modelProfile],
    [providerStatus(true, "Codex CLI")],
    [participant],
    [],
    "",
  );
  const option = options[0];
  assert.equal(option?.participant?.id, participant.id);
  assert.equal(option?.runtimeProfile.id, modelProfile.id);
  const reference = buildLocalAgentLauncherReference(option);
  assert.equal(reference.insert.mention.scope.groupChatRuntimeProfileId, modelProfile.id);
});

test("local Tutti agent launcher does not bind custom personas that share the runtime", async () => {
  const { buildLocalAgentLauncherReference, buildLocalAgentMentionOptions } = await loadModule();
  const productParticipant = {
    id: "product-agent",
    conversationId: "conversation-1",
    kind: "ai",
    displayName: "产品",
    avatar: null,
    runtimeProfileId: "local-agent:codex",
    agentTargetId: "agent:codex:primary",
    identityId: "identity-product",
    roomInstructions: "",
    status: "active",
    listenMode: "passive",
    sortOrder: 0,
    reasoningEffort: null,
    speedMode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const options = buildLocalAgentMentionOptions(
    [runtimeProfile],
    [providerStatus(true, "Codex CLI")],
    [productParticipant],
    [],
    "",
  );

  assert.equal(options[0]?.participant, null);
  const reference = buildLocalAgentLauncherReference(options[0]);
  assert.equal(reference.insert.mention.scope.groupChatLocalAgentMention, "true");
  assert.equal(reference.insert.mention.scope.groupChatAgentTargetId, "agent:codex:primary");
  assert.equal(reference.insert.mention.scope.groupChatParticipantId, undefined);
});
