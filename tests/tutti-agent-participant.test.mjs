import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadModule() {
  const output = "/tmp/tutti-agent-participant.test.mjs";
  const build = spawnSync(
    "pnpm",
    [
      "--filter", "@group-chat/server", "exec", "esbuild",
      "src/domains/tutti-agent-participant.ts",
      "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

const conversation = {
  id: "conversation-1",
};

const runtimeProfile = {
  id: "local-agent:codex",
  kind: "local-agent",
  agentTargetId: "workspace/agent:primary",
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

test("virtual Tutti agent participants use stable non-clone ids", async () => {
  const {
    createVirtualTuttiAgentParticipant,
    localAgentTargetFromLauncherAppId,
    parseLegacyTuttiAgentProviderParticipantId,
    parseTuttiAgentParticipantId,
    tuttiAgentParticipantId,
  } = await loadModule();

  assert.equal(localAgentTargetFromLauncherAppId("agent-target:workspace/agent:primary"), "workspace/agent:primary");
  assert.equal(tuttiAgentParticipantId("workspace/agent:primary"), "tutti-agent:target:workspace%2Fagent%3Aprimary");
  assert.equal(parseTuttiAgentParticipantId("tutti-agent:target:workspace%2Fagent%3Aprimary"), "workspace/agent:primary");
  assert.equal(parseTuttiAgentParticipantId("tutti-agent:codex"), "");
  assert.equal(parseLegacyTuttiAgentProviderParticipantId("tutti-agent:codex"), "codex");
  assert.equal(parseLegacyTuttiAgentProviderParticipantId("tutti-agent:target:codex"), "");

  const participant = createVirtualTuttiAgentParticipant(conversation, runtimeProfile);
  assert.equal(participant.id, "tutti-agent:target:workspace%2Fagent%3Aprimary");
  assert.equal(participant.conversationId, "conversation-1");
  assert.equal(participant.displayName, "Codex Local Agent");
  assert.equal(participant.agentTargetId, "workspace/agent:primary");
  assert.equal(participant.runtimeProfileId, "local-agent:codex");
  assert.equal(participant.identityId, null);
  assert.equal(participant.status, "active");
});
