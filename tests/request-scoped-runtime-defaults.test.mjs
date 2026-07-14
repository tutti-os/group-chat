import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("request-scoped defaults fail closed and identity fallback mentions keep their room participant", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-request-defaults-"));
  const check = join(home, "check.ts");
  try {
    await writeFile(check, `
    process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};

    async function main() {
      const assert = (await import("node:assert/strict")).default;
      const { closeDb } = await import(${JSON.stringify(new URL("../apps/server/src/db/database.ts", import.meta.url).href)});
      const { ChatRepository } = await import(${JSON.stringify(new URL("../apps/server/src/domains/chat-repository.ts", import.meta.url).href)});
      const { ChatService } = await import(${JSON.stringify(new URL("../apps/server/src/domains/chat-service.ts", import.meta.url).href)});
      const { EventHub } = await import(${JSON.stringify(new URL("../apps/server/src/ws/event-hub.ts", import.meta.url).href)});
      const { AgentToolTokenStore } = await import(${JSON.stringify(new URL("../apps/server/src/domains/agent-tool-tokens.ts", import.meta.url).href)});

      const repo = new ChatRepository();
      repo.syncLocalAgentCatalog({ agents: [{
        agentTargetId: "target-a",
        providerId: "codex",
        displayName: "Target A",
        available: true,
        runtimeSupported: true,
        defaultModelId: "model-default",
      }] });
      const canonical = repo.listRuntimeProfiles().find((profile) => profile.agentTargetId === "target-a");
      assert.ok(canonical);
      const modelProfile = repo.ensureRuntimeProfileForModel(canonical, "model-fast");
      const service = new ChatService(repo, new EventHub(), new AgentToolTokenStore());

      const noDefaultRoom = service.createRoom({
        title: "No request default",
        participants: [{ displayName: "No Runtime" }],
      });
      assert.equal(noDefaultRoom.participants[0]?.runtimeProfileId, null);

      const noDefaultIdentity = service.createIdentity({ name: "No Default" });
      assert.equal(noDefaultIdentity.defaultRuntimeProfileId, null);
      const explicitDefaultIdentity = service.createIdentity(
        { name: "Request Default" },
        "target-a",
      );
      assert.equal(explicitDefaultIdentity.defaultRuntimeProfileId, canonical.id);

      const cleared = service.createIdentity({ name: "Cleared", defaultRuntimeProfileId: null });
      const clearedPatched = service.updateIdentity(cleared.id, { name: "Cleared Renamed" }, "target-a");
      assert.equal(clearedPatched?.defaultRuntimeProfileId, null);
      const valuedPatched = service.updateIdentity(explicitDefaultIdentity.id, { name: "Default Renamed" });
      assert.equal(valuedPatched?.defaultRuntimeProfileId, canonical.id);

      const mentionRoom = service.createRoom({ title: "Legacy identity fallback" });
      const legacyIdentity = service.createIdentity({
        name: "Target A",
        defaultRuntimeProfileId: modelProfile.id,
      });
      const legacyParticipant = repo.createParticipant(mentionRoom.conversation.id, {
        displayName: "Target A",
        kind: "ai",
        runtimeProfileId: null,
        identityId: legacyIdentity.id,
        roomInstructions: "",
        listenMode: "passive",
        sortOrder: 0,
      });
      service.generateReplies = async () => {};
      const mention = {
        mentionType: "reference",
        participantId: "target-a",
        referenceProviderId: "agent-session",
        referenceEntityId: "target-a",
        displayNameSnapshot: "Target A",
        referenceScope: {
          groupChatLocalAgentMention: "true",
          groupChatAgentTargetId: "target-a",
          groupChatRuntimeProfileId: modelProfile.id,
          groupChatParticipantId: legacyParticipant.id,
          groupChatParticipantLabel: legacyParticipant.displayName,
        },
      };
      const sent = service.sendMessage(mentionRoom.conversation.id, {
        content: "Target A check the model-specific task",
        mentions: [mention],
      });
      assert.equal(sent.targets.length, 1);
      assert.equal(sent.targets[0]?.id, legacyParticipant.id);
      const effective = service.resolveEffectiveParticipant(mentionRoom.conversation, legacyParticipant);
      assert.equal(effective?.runtimeProfileId, modelProfile.id);
      assert.equal(effective?.agentTargetId, "target-a");
      closeDb();
    }

    main().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `);

    const result = await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", check], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, GROUP_CHAT_HOME: home },
    });
    assert.equal(result.stderr, "");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
