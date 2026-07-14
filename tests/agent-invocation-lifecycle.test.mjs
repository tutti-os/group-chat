import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("message invocation state is request-scoped, leak-free, and retained for queued edits", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-invocation-lifecycle-"));
  const check = join(home, "check.ts");
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
      }] });
      const profile = repo.listRuntimeProfiles().find((item) => item.agentTargetId === "target-a");
      assert.ok(profile);
      const service = new ChatService(repo, new EventHub(), new AgentToolTokenStore());
      const { conversation } = service.createRoom({ title: "Lifecycle", description: "" });
      const identity = service.createIdentity({ name: "Agent", defaultRuntimeProfileId: profile.id });
      const { participant } = service.addParticipant(conversation.id, {
        identityId: identity.id,
        runtimeProfileId: profile.id,
      });

      const humanOnly = service.sendMessage(conversation.id, { content: "human note" }, {
        managedAgentHeaders: { "x-tutti-agent-invocation-credential": "unused-secret" },
      });
      assert.equal(humanOnly.targets.length, 0);
      assert.equal(service.messageInvocationContexts.size, 0);

      service.activeReplyKeys.add(conversation.id + ":" + participant.id);
      const edited = await service.updateMessage(humanOnly.message.id, {
        content: "edited for agent",
        mentions: [{
          mentionType: "participant",
          participantId: participant.id,
          displayNameSnapshot: participant.displayName,
        }],
      }, {
        managedAgentHeaders: { "x-tutti-agent-invocation-credential": "edited-secret" },
        agentDetectContext: { managedAgentInvocation: { credential: "edited-secret" } },
      });
      assert.equal(edited?.targets[0]?.id, participant.id);
      await Promise.resolve();
      const queuedInvocation = service.messageInvocationContexts.get(humanOnly.message.id);
      assert.equal(
        queuedInvocation?.managedAgentHeaders?.["x-tutti-agent-invocation-credential"],
        "edited-secret",
      );
      service.activeReplyKeys.delete(conversation.id + ":" + participant.id);

      const scopedRepo = new ChatRepository();
      const scopedService = new ChatService(scopedRepo, new EventHub(), new AgentToolTokenStore());
      scopedService.runtimes = {
        async listLocalAgentTargets(context) {
          const credential = context?.managedAgentInvocation?.credential;
          if (credential === "credential-a") {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          const suffix = credential === "credential-a" ? "a" : "b";
          return {
            defaultAgentTargetId: "target-" + suffix,
            agents: [{
              agentTargetId: "target-" + suffix,
              providerId: "codex",
              provider: "codex",
              displayName: "Target " + suffix.toUpperCase(),
              runtimeSupported: true,
              availabilityStatus: "available",
              available: true,
              authState: "ok",
              executablePath: "",
              version: "test",
              models: [],
            }],
          };
        },
      };
      const [catalogA, catalogB] = await Promise.all([
        scopedService.listLocalAgentTargets({ managedAgentInvocation: { credential: "credential-a" } }),
        scopedService.listLocalAgentTargets({ managedAgentInvocation: { credential: "credential-b" } }),
      ]);
      scopedService.generateReplies = async () => {};
      const scopedRoom = scopedService.createRoom({ title: "Scoped defaults", description: "" });
      const appMention = {
        mentionType: "reference",
        participantId: "vibe-design",
        referenceProviderId: "workspace-app",
        referenceEntityId: "vibe-design",
        displayNameSnapshot: "Vibe Design",
        referenceScope: { workspaceId: "ws-1" },
      };
      const sendWithDefault = (defaultAgentTargetId) => scopedService.sendMessage(
        scopedRoom.conversation.id,
        {
          content: "[Vibe Design](mention://workspace-app/vibe-design?workspaceId=ws-1) build a site",
          mentions: [appMention],
        },
        { defaultAgentTargetId },
      );
      assert.equal(sendWithDefault(catalogA.defaultAgentTargetId).targets[0]?.agentTargetId, "target-a");
      assert.equal(sendWithDefault(catalogB.defaultAgentTargetId).targets[0]?.agentTargetId, "target-b");
      closeDb();
    }

    main().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `);

  try {
    const result = await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", check], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, GROUP_CHAT_HOME: home },
    });
    assert.equal(result.stderr, "");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
