import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const rootDir = new URL("..", import.meta.url);

test("legacy provider rows migrate only after the complete catalog is uniquely selectable", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-agent-id-db-"));
  const script = join(home, "check.ts");
  await writeFile(script, `
    async function main() {
    process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};
    const { closeDb } = await import(${JSON.stringify(new URL("../apps/server/src/db/database.ts", import.meta.url).href)});
    const { ChatRepository, localAgentTargetRuntimeProfileId } = await import(${JSON.stringify(new URL("../apps/server/src/domains/chat-repository.ts", import.meta.url).href)});
    const { AgentToolGateway } = await import(${JSON.stringify(new URL("../apps/server/src/domains/agent-tool-gateway.ts", import.meta.url).href)});
    const { tuttiAgentParticipantId } = await import(${JSON.stringify(new URL("../packages/shared/src/index.ts", import.meta.url).href)});
    const repo = new ChatRepository();
    repo.ensureSeedData();
    const { conversation } = repo.createRoom({ title: "migration", description: "", participants: [] });
    const identity = repo.createIdentity({ name: "Legacy", defaultRuntimeProfileId: "local-agent:acme" });
    const participant = repo.addParticipantFromIdentity(conversation.id, {
      identityId: identity.id,
      runtimeProfileId: "local-agent:acme",
    });

    repo.syncLocalAgentCatalog({ agents: [
      { agentTargetId: "acme", providerId: "acme", displayName: "A", available: true, runtimeSupported: true },
      { agentTargetId: "agent-b", providerId: "acme", displayName: "B", available: true, runtimeSupported: true },
    ] });
    const ambiguousProfile = repo.getRuntimeProfile("local-agent:acme");
    if (ambiguousProfile?.agentTargetId !== null || ambiguousProfile.enabled !== false) {
      throw new Error("ambiguous legacy profile did not fail closed");
    }
    if (repo.getParticipant(participant.id)?.agentTargetId !== null) {
      throw new Error("ambiguous participant was assigned a guessed target");
    }

    repo.syncLocalAgentCatalog({ agents: [
      { agentTargetId: "workspace/agent:a", providerId: "acme", displayName: "A", available: true, runtimeSupported: true },
    ] });
    const migratedParticipant = repo.getParticipant(participant.id);
    const migratedIdentity = repo.getIdentity(identity.id);
    if (migratedParticipant?.agentTargetId !== "workspace/agent:a") throw new Error("participant target was not migrated");
    if (!migratedParticipant.runtimeProfileId) throw new Error("participant lost its runtime profile");
    const migratedProfile = repo.getRuntimeProfile(migratedParticipant.runtimeProfileId);
    if (!migratedProfile || migratedProfile.agentTargetId !== "workspace/agent:a" || !migratedProfile.enabled) {
      throw new Error("participant profile did not become exact and selectable");
    }
    if (migratedIdentity?.defaultRuntimeProfileId !== migratedParticipant.runtimeProfileId) {
      throw new Error("identity and participant profile migration diverged");
    }
    const modelProfile = repo.ensureRuntimeProfileForModel(
      migratedProfile,
      "alternate-model",
    );
    repo.syncLocalAgentCatalog({ agents: [
      { agentTargetId: "workspace__primary__alternate-model", providerId: "other", displayName: "Separator", available: true, runtimeSupported: true },
    ] });
    const separatorProfile = repo.listRuntimeProfiles().find((profile) =>
      profile.agentTargetId === "workspace__primary__alternate-model"
    );
    if (!separatorProfile || separatorProfile.id === modelProfile.id) {
      throw new Error("open target id collided with a model profile id");
    }
    repo.syncLocalAgentCatalog({ agents: [
      { agentTargetId: "workspace/agent:a", providerId: "acme", displayName: "A", available: true, runtimeSupported: true },
    ] });
    if (!repo.getRuntimeProfile(modelProfile.id)?.enabled) {
      throw new Error("target-scoped model profile was disabled by catalog refresh");
    }
    const gateway = new AgentToolGateway(repo, {}, {});
    const virtualParticipant = (gateway as any).resolveToolParticipant(
      tuttiAgentParticipantId("workspace/agent:a"),
      conversation.id,
    );
    if (virtualParticipant?.agentTargetId !== "workspace/agent:a") {
      throw new Error("tool gateway did not resolve the exact target profile");
    }
    const legacyVirtualParticipant = (gateway as any).resolveToolParticipant(
      "tutti-agent:acme",
      conversation.id,
    );
    if (legacyVirtualParticipant?.agentTargetId !== "workspace/agent:a") {
      throw new Error("unique legacy virtual participant did not migrate");
    }
    repo.syncLocalAgentCatalog({ agents: [
      { agentTargetId: "workspace/agent:a", providerId: "acme", displayName: "A", available: true, runtimeSupported: true },
      { agentTargetId: "workspace/agent:b", providerId: "acme", displayName: "B", available: true, runtimeSupported: true },
    ] });
    if ((gateway as any).resolveToolParticipant("tutti-agent:acme", conversation.id)) {
      throw new Error("ambiguous legacy virtual participant did not fail closed");
    }
    repo.syncLocalAgentCatalog({ agents: [
      { agentTargetId: "codex", providerId: "codex", displayName: "Exact", available: true, runtimeSupported: true },
    ] });
    repo.syncLocalAgentCatalog({ agents: [
      { agentTargetId: "other-codex", providerId: "codex", displayName: "Other", available: true, runtimeSupported: true },
    ] });
    if ((gateway as any).resolveToolParticipant(tuttiAgentParticipantId("codex"), conversation.id)) {
      throw new Error("removed exact target crossed into a same-named legacy provider");
    }

    const legacyModelIdentity = repo.createIdentity({
      name: "Legacy custom model",
      defaultRuntimeProfileId: "local-agent:legacy-model",
    });
    const legacyModelBase = repo.getRuntimeProfile("local-agent:legacy-model");
    if (!legacyModelBase) throw new Error("missing legacy model base profile");
    const legacyCustomProfile = repo.ensureRuntimeProfileForModel(legacyModelBase, "custom-model-v1");
    repo.updateIdentity(legacyModelIdentity.id, { defaultRuntimeProfileId: legacyCustomProfile.id });
    const legacyModelParticipant = repo.addParticipantFromIdentity(conversation.id, {
      identityId: legacyModelIdentity.id,
      runtimeProfileId: legacyCustomProfile.id,
    });
    repo.syncLocalAgentCatalog({ agents: [{
      agentTargetId: "legacy-model-target",
      providerId: "legacy-model",
      displayName: "Legacy Model Agent",
      available: true,
      runtimeSupported: true,
      defaultModelId: "catalog-default-v1",
    }] });
    const migratedCustomParticipant = repo.getParticipant(legacyModelParticipant.id);
    const migratedCustomProfile = repo.getRuntimeProfile(legacyCustomProfile.id);
    if (
      migratedCustomParticipant?.runtimeProfileId !== legacyCustomProfile.id
      || migratedCustomProfile?.agentTargetId !== "legacy-model-target"
      || migratedCustomProfile.model !== "custom-model-v1"
    ) {
      throw new Error("legacy custom model profile was rebound to the catalog default");
    }

    const canonicalId = localAgentTargetRuntimeProfileId("legacy-model-target");
    const canonicalV1 = repo.getRuntimeProfile(canonicalId);
    if (canonicalV1?.model !== "catalog-default-v1") {
      throw new Error("catalog default profile did not use the current default model");
    }
    repo.syncLocalAgentCatalog({ agents: [{
      agentTargetId: "legacy-model-target",
      providerId: "legacy-model",
      displayName: "Legacy Model Agent",
      available: true,
      runtimeSupported: true,
      defaultModelId: "catalog-default-v2",
    }] });
    if (repo.getRuntimeProfile(canonicalId)?.model !== "catalog-default-v2") {
      throw new Error("canonical target profile did not refresh its catalog default model");
    }
    if (repo.getRuntimeProfile(legacyCustomProfile.id)?.model !== "custom-model-v1") {
      throw new Error("catalog default refresh overwrote a target-specific model profile");
    }
    closeDb();
    }
    main().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `);

  try {
    const result = await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", script], {
      cwd: rootDir,
      env: { ...process.env, GROUP_CHAT_HOME: home },
    });
    assert.equal(result.stderr, "");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
