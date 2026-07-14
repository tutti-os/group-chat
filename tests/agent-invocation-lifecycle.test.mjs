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

      const observedCredentials = [];
      let releaseFirstReply;
      let markFirstReplyStarted;
      let markSecondReplyFinished;
      const firstReplyStarted = new Promise((resolve) => { markFirstReplyStarted = resolve; });
      const secondReplyFinished = new Promise((resolve) => { markSecondReplyFinished = resolve; });
      service.generateForParticipant = async (_roomId, _conversationId, _message, _participant, _run, invocation) => {
        observedCredentials.push(invocation?.managedAgentHeaders?.["x-tutti-agent-invocation-credential"] ?? "missing");
        if (observedCredentials.length === 1) {
          markFirstReplyStarted();
          await new Promise((resolve) => { releaseFirstReply = resolve; });
        } else {
          markSecondReplyFinished();
        }
        return null;
      };
      const first = service.sendMessage(conversation.id, {
        content: "first for agent",
        mentions: [{
          mentionType: "participant",
          participantId: participant.id,
          displayNameSnapshot: participant.displayName,
        }],
      }, {
        managedAgentHeaders: { "x-tutti-agent-invocation-credential": "first-secret" },
        agentDetectContext: { managedAgentInvocation: { credential: "first-secret" } },
      });
      await firstReplyStarted;
      const edited = await service.updateMessage(first.message.id, {
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
      const queuedInvocation = service.messageInvocationContexts.get(first.message.id)?.get(participant.id);
      assert.equal(
        queuedInvocation?.managedAgentHeaders?.["x-tutti-agent-invocation-credential"],
        "edited-secret",
      );
      releaseFirstReply();
      await secondReplyFinished;
      await Promise.resolve();
      assert.deepEqual(observedCredentials, ["first-secret", "edited-secret"]);
      assert.equal(service.messageInvocationContexts.size, 0);

      const runQueuedScenario = async ({ supersedeFollowup }) => {
        const credentials = [];
        let releaseActive;
        let markActiveStarted;
        let markQueuedFinished;
        const activeStarted = new Promise((resolve) => { markActiveStarted = resolve; });
        const queuedFinished = new Promise((resolve) => { markQueuedFinished = resolve; });
        service.generateForParticipant = async (_roomId, _conversationId, message, _participant, _run, invocation) => {
          credentials.push(invocation?.managedAgentHeaders?.["x-tutti-agent-invocation-credential"] ?? "missing");
          if (credentials.length === 1) {
            markActiveStarted();
            await new Promise((resolve) => { releaseActive = resolve; });
          } else {
            markQueuedFinished(message.id);
          }
          return null;
        };
        const active = service.sendMessage(conversation.id, {
          content: "active request",
          mentions: [{
            mentionType: "participant",
            participantId: participant.id,
            displayNameSnapshot: participant.displayName,
          }],
        }, {
          managedAgentHeaders: { "x-tutti-agent-invocation-credential": "active-secret" },
        });
        await activeStarted;
        const assistantFollowup = repo.createMessage({
          conversationId: conversation.id,
          role: "assistant",
          senderParticipantId: "another-agent",
          content: "assistant follow-up",
          status: "success",
        });
        await service.scheduleReply(
          conversation.roomId,
          conversation.id,
          assistantFollowup,
          participant,
          null,
          { managedAgentHeaders: { "x-tutti-agent-invocation-credential": "followup-secret" } },
        );
        assert.equal(
          service.messageInvocationContexts.get(assistantFollowup.id)?.get(participant.id)
            ?.managedAgentHeaders?.["x-tutti-agent-invocation-credential"],
          "followup-secret",
        );
        let supersedingMessage = null;
        if (supersedeFollowup) {
          supersedingMessage = service.sendMessage(conversation.id, {
            content: "newest queued request",
            mentions: [{
              mentionType: "participant",
              participantId: participant.id,
              displayNameSnapshot: participant.displayName,
            }],
          }, {
            managedAgentHeaders: { "x-tutti-agent-invocation-credential": "newest-secret" },
          }).message;
          assert.equal(service.messageInvocationContexts.has(assistantFollowup.id), false);
          assert.equal(
            service.messageInvocationContexts.get(supersedingMessage.id)?.get(participant.id)
              ?.managedAgentHeaders?.["x-tutti-agent-invocation-credential"],
            "newest-secret",
          );
        }
        releaseActive();
        const generatedMessageId = await queuedFinished;
        await Promise.resolve();
        assert.equal(generatedMessageId, supersedingMessage?.id ?? assistantFollowup.id);
        assert.deepEqual(
          credentials,
          supersedeFollowup ? ["active-secret", "newest-secret"] : ["active-secret", "followup-secret"],
        );
        assert.equal(service.messageInvocationContexts.has(active.message.id), false);
        assert.equal(service.messageInvocationContexts.has(assistantFollowup.id), false);
        if (supersedingMessage) assert.equal(service.messageInvocationContexts.has(supersedingMessage.id), false);
      };

      await runQueuedScenario({ supersedeFollowup: false });
      await runQueuedScenario({ supersedeFollowup: true });

      const staleCredentials = [];
      let releaseStaleActive;
      let markStaleActiveStarted;
      let markStaleActiveFinished;
      const staleActiveStarted = new Promise((resolve) => { markStaleActiveStarted = resolve; });
      const staleActiveFinished = new Promise((resolve) => { markStaleActiveFinished = resolve; });
      service.generateForParticipant = async (_roomId, _conversationId, _message, _participant, _run, invocation) => {
        staleCredentials.push(invocation?.managedAgentHeaders?.["x-tutti-agent-invocation-credential"] ?? "missing");
        if (staleCredentials.length === 1) {
          markStaleActiveStarted();
          await new Promise((resolve) => { releaseStaleActive = resolve; });
          markStaleActiveFinished();
        }
        return null;
      };
      service.sendMessage(conversation.id, {
        content: "active while another message is edited",
        mentions: [{
          mentionType: "participant",
          participantId: participant.id,
          displayNameSnapshot: participant.displayName,
        }],
      }, {
        managedAgentHeaders: { "x-tutti-agent-invocation-credential": "stale-active-secret" },
      });
      await staleActiveStarted;
      const staleQueued = service.sendMessage(conversation.id, {
        content: "queued before edit",
        mentions: [{
          mentionType: "participant",
          participantId: participant.id,
          displayNameSnapshot: participant.displayName,
        }],
      }, {
        managedAgentHeaders: { "x-tutti-agent-invocation-credential": "stale-queued-secret" },
      });
      assert.equal(repo.getPendingReply(conversation.id, participant.id)?.messageId, staleQueued.message.id);
      const removedTarget = await service.updateMessage(staleQueued.message.id, {
        content: "edited into a human-only note",
        mentions: [],
      }, {
        managedAgentHeaders: { "x-tutti-agent-invocation-credential": "edited-human-secret" },
      });
      assert.deepEqual(removedTarget?.targets, []);
      assert.equal(repo.getPendingReply(conversation.id, participant.id), null);
      assert.equal(service.messageInvocationContexts.has(staleQueued.message.id), false);
      // Simulate a durable stale queue row left by an older process/version.
      // The absence of a matching per-message invocation must fail closed.
      repo.upsertPendingReply({
        roomId: conversation.roomId,
        conversationId: conversation.id,
        participantId: participant.id,
        messageId: staleQueued.message.id,
      });
      releaseStaleActive();
      await staleActiveFinished;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(staleCredentials, ["stale-active-secret"]);
      assert.equal(repo.getPendingReply(conversation.id, participant.id), null);

      const recoveredMessage = repo.createMessage({
        conversationId: conversation.id,
        role: "user",
        content: "durable queued message without recoverable credentials",
        status: "success",
      });
      repo.upsertPendingReply({
        roomId: conversation.roomId,
        conversationId: conversation.id,
        participantId: participant.id,
        messageId: recoveredMessage.id,
      });
      const recoveredService = new ChatService(repo, new EventHub(), new AgentToolTokenStore());
      let recoveredRuns = 0;
      recoveredService.generateForParticipant = async () => {
        recoveredRuns += 1;
        return null;
      };
      recoveredService.recoverReplyQueueOnce();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(recoveredRuns, 0);
      assert.equal(repo.getPendingReply(conversation.id, participant.id), null);
      assert.equal(recoveredService.messageInvocationContexts.size, 0);

      let releaseDeleteActive;
      let markDeleteActiveStarted;
      const deleteActiveStarted = new Promise((resolve) => { markDeleteActiveStarted = resolve; });
      service.generateForParticipant = async () => {
        markDeleteActiveStarted();
        await new Promise((resolve) => { releaseDeleteActive = resolve; });
        return null;
      };
      service.sendMessage(conversation.id, {
        content: "active before room deletion",
        mentions: [{
          mentionType: "participant",
          participantId: participant.id,
          displayNameSnapshot: participant.displayName,
        }],
      }, {
        managedAgentHeaders: { "x-tutti-agent-invocation-credential": "delete-active-secret" },
      });
      await deleteActiveStarted;
      const deleteQueued = service.sendMessage(conversation.id, {
        content: "queued before room deletion",
        mentions: [{
          mentionType: "participant",
          participantId: participant.id,
          displayNameSnapshot: participant.displayName,
        }],
      }, {
        managedAgentHeaders: { "x-tutti-agent-invocation-credential": "delete-queued-secret" },
      });
      assert.equal(repo.getPendingReply(conversation.id, participant.id)?.messageId, deleteQueued.message.id);
      assert.equal(service.messageInvocationContexts.size > 0, true);
      const deletedRoom = await service.deleteRoom(conversation.roomId);
      assert.equal(deletedRoom?.id, conversation.roomId);
      assert.equal(repo.getPendingReply(conversation.id, participant.id), null);
      assert.equal(service.messageInvocationContexts.size, 0);
      releaseDeleteActive();
      await new Promise((resolve) => setTimeout(resolve, 0));

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
      const legacyLauncherMention = {
        mentionType: "reference",
        participantId: "agent-codex",
        referenceProviderId: "workspace-app",
        referenceEntityId: "agent-codex",
        displayNameSnapshot: "Codex",
      };
      const sendWithDefault = (defaultAgentTargetId) => scopedService.sendMessage(
        scopedRoom.conversation.id,
        {
          content: "Codex [Vibe Design](mention://workspace-app/vibe-design?workspaceId=ws-1) build a site",
          mentions: [legacyLauncherMention, appMention],
        },
        { defaultAgentTargetId },
      );
      const targetAResult = sendWithDefault(catalogA.defaultAgentTargetId);
      assert.equal(targetAResult.targets[0]?.agentTargetId, "target-a");
      assert.equal(targetAResult.targets[0]?.displayName, "Vibe Design");
      assert.equal(sendWithDefault(catalogB.defaultAgentTargetId).targets[0]?.agentTargetId, "target-b");

      const virtualParticipant = targetAResult.targets[0];
      assert.ok(virtualParticipant);
      assert.equal(scopedRepo.getParticipant(virtualParticipant.id), null);
      let releaseVirtualRun;
      let markVirtualRunStarted;
      let markVirtualStreamStopped;
      let cancelledVirtualRunId = null;
      const virtualRunStarted = new Promise((resolve) => { markVirtualRunStarted = resolve; });
      const virtualStreamStopped = new Promise((resolve) => { markVirtualStreamStopped = resolve; });
      const virtualProvider = {
        id: "local-agent",
        describeRun(context) {
          return {
            runtime: context.runtimeProfile.kind,
            agentTargetId: context.runtimeProfile.agentTargetId,
            provider: context.runtimeProfile.provider,
            model: context.runtimeProfile.model,
          };
        },
        async detect() {
          return { available: true };
        },
        async *streamReply(context) {
          markVirtualRunStarted(context.runId);
          await new Promise((resolve) => { releaseVirtualRun = resolve; });
          markVirtualStreamStopped();
        },
        async cancel(runId) {
          cancelledVirtualRunId = runId;
          releaseVirtualRun();
          await virtualStreamStopped;
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { cancelled: true };
        },
      };
      scopedService.runtimes = {
        getProvider(runtimeProfile) {
          assert.equal(runtimeProfile?.id, virtualParticipant.runtimeProfileId);
          return virtualProvider;
        },
      };
      const virtualMessage = scopedRepo.createMessage({
        conversationId: scopedRoom.conversation.id,
        role: "user",
        content: "run the workspace app until the room is deleted",
        status: "success",
      });
      const virtualGeneration = scopedService.scheduleReply(
        scopedRoom.room.id,
        scopedRoom.conversation.id,
        virtualMessage,
        virtualParticipant,
        null,
        { managedAgentHeaders: { "x-tutti-agent-invocation-credential": "virtual-secret" } },
      );
      const virtualRunId = await virtualRunStarted;
      assert.equal(scopedRepo.getAgentRun(virtualRunId)?.status, "running");
      assert.equal(scopedService.messageInvocationContexts.size > 0, true);
      const deletedVirtualRoom = await scopedService.deleteRoom(scopedRoom.room.id);
      assert.equal(deletedVirtualRoom?.id, scopedRoom.room.id);
      assert.equal(cancelledVirtualRunId, virtualRunId);
      assert.equal(scopedService.messageInvocationContexts.size, 0);
      await virtualGeneration;
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
