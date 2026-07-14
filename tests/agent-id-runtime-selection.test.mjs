import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("exact target selection rejects TOCTOU, unknown targets, and ambiguous provider migration", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-agent-id-runtime-"));
  const modeFile = join(home, "mode.txt");
  const fakeTutti = join(home, "tutti");
  const fakeAgent = join(home, "agent.mjs");
  const check = join(home, "check.ts");
  await writeFile(modeFile, "available");
  await writeFile(fakeAgent, `process.stdin.resume(); process.stdin.on("end", () => console.log('{"type":"final_text","text":"unexpected"}'));`);
  await writeFile(fakeTutti, `#!/usr/bin/env node
    const { readFileSync } = await import("node:fs");
    const mode = readFileSync(${JSON.stringify(modeFile)}, "utf8").trim();
    const availability = (status) => ({ status, reasonCode: status === "available" ? "ready" : "offline", detail: status });
    const agents = mode === "ambiguous"
      ? [
          { id: "target-a", provider: "codex", name: "A", availability: availability("available") },
          { id: "target-b", provider: "codex", name: "B", availability: availability("available") },
        ]
      : [{ id: "target-a", provider: "codex", name: "A", availability: availability(mode === "available" ? "available" : "unavailable") }];
    console.log(JSON.stringify({ schemaVersion: 1, defaultAgentTargetId: agents[0].id, agents }));
  `);
  await chmod(fakeTutti, 0o755);
  await writeFile(check, `
    async function main() {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};
    process.env.GROUP_CHAT_TUTTI_CLI = ${JSON.stringify(fakeTutti)};
    process.env.GROUP_CHAT_LOCAL_AGENT_COMMAND = process.execPath + " " + ${JSON.stringify(fakeAgent)};
    const { LocalAgentRuntimeProvider } = await import(${JSON.stringify(new URL("../apps/server/src/runtimes/local-agent-provider.ts", import.meta.url).href)});
    const { agentRunMatchesRuntimeDescriptor } = await import(${JSON.stringify(new URL("../apps/server/src/runtimes/runtime-provider.ts", import.meta.url).href)});
    const { closeDb } = await import(${JSON.stringify(new URL("../apps/server/src/db/database.ts", import.meta.url).href)});
    const { ChatRepository } = await import(${JSON.stringify(new URL("../apps/server/src/domains/chat-repository.ts", import.meta.url).href)});
    const { ChatService } = await import(${JSON.stringify(new URL("../apps/server/src/domains/chat-service.ts", import.meta.url).href)});
    const { AgentToolTokenStore } = await import(${JSON.stringify(new URL("../apps/server/src/domains/agent-tool-tokens.ts", import.meta.url).href)});
    const { AgentWorkspaceService } = await import(${JSON.stringify(new URL("../apps/server/src/domains/agent-workspace.ts", import.meta.url).href)});
    const { participantWorkspaceRoot } = await import(${JSON.stringify(new URL("../apps/server/src/local/paths.ts", import.meta.url).href)});
    const { LocalAgentSessionStore } = await import(${JSON.stringify(new URL("../apps/server/src/runtimes/local-agent-session-store.ts", import.meta.url).href)});
    const { EventHub } = await import(${JSON.stringify(new URL("../apps/server/src/ws/event-hub.ts", import.meta.url).href)});
    const provider = new LocalAgentRuntimeProvider();
    const acceptedRun = { runtime: "local-agent", agentTargetId: "target-a", provider: "codex", model: "default" };
    if (!agentRunMatchesRuntimeDescriptor(acceptedRun, acceptedRun)) throw new Error("unchanged accepted run was rejected");
    if (agentRunMatchesRuntimeDescriptor(acceptedRun, { ...acceptedRun, agentTargetId: "target-b" })) {
      throw new Error("preaccepted run target change was accepted");
    }
    const context = {
      runId: "run-1",
      conversation: { id: "c", roomId: "r", type: "group", title: "r", groupSystemPrompt: "", collaborationRules: "", collaborationRulesVersion: 1, replyPolicy: { mode: "mentioned", order: "sequential", maxRounds: 1, mentionFollowupRounds: 0 }, activeBranchId: null, pinned: false, lastMessage: "hi", lastMessageAt: null, createdAt: "", updatedAt: "" },
      participant: { id: "p", conversationId: "c", kind: "ai", displayName: "A", avatar: null, runtimeProfileId: "profile", agentTargetId: "target-a", identityId: null, roomInstructions: "", status: "active", listenMode: "passive", sortOrder: 0, reasoningEffort: null, speedMode: null, createdAt: "", updatedAt: "" },
      identity: null,
      runtimeProfile: { id: "profile", kind: "local-agent", agentTargetId: "target-a", provider: "codex", model: "default", displayName: "A", enabled: true, trustedMode: false, systemPromptMode: "prompt-prefix", capabilities: { streaming: true, toolUse: true, reasoning: true, vision: false, resume: true }, createdAt: "", updatedAt: "" },
      userMessage: { id: "m", conversationId: "c", role: "user", senderParticipantId: null, senderName: "u", content: "hi", mentions: [], visibility: "public", status: "success", branchId: null, parentMessageId: null, runId: null, tokenUsage: null, createdAt: "", updatedAt: "" },
      recentMessages: [], attachments: [],
    };
    if (!(await provider.detect(context)).available) throw new Error("exact target should initially be available");
    const malformedProvider = {
      ...context,
      runtimeProfile: { ...context.runtimeProfile, provider: "co dex" },
    };
    if ((await provider.detect(malformedProvider)).available) {
      throw new Error("lossy provider metadata normalization selected another provider");
    }
    await writeFile(${JSON.stringify(modeFile)}, "unavailable");
    try {
      for await (const _event of provider.streamReply(context)) {}
      throw new Error("TOCTOU target change was accepted");
    } catch (error) {
      if (!String(error).includes("unavailable")) throw error;
    }
    await writeFile(${JSON.stringify(modeFile)}, "available");
    const unknown = { ...context, participant: { ...context.participant, agentTargetId: "missing" }, runtimeProfile: { ...context.runtimeProfile, agentTargetId: "missing" } };
    if ((await provider.detect(unknown)).available) throw new Error("unknown exact target was accepted");
    await writeFile(${JSON.stringify(modeFile)}, "ambiguous");
    const legacy = { ...context, participant: { ...context.participant, agentTargetId: null }, runtimeProfile: { ...context.runtimeProfile, agentTargetId: null } };
    if ((await provider.detect(legacy)).available) throw new Error("ambiguous provider-only migration was accepted");

    const repo = new ChatRepository();
    repo.syncLocalAgentCatalog({ agents: [
      { agentTargetId: "target-a", providerId: "codex", displayName: "A", available: true, runtimeSupported: true },
    ] });
    const runtimeProfile = repo.listRuntimeProfiles().find((item) => item.agentTargetId === "target-a" && item.enabled);
    if (!runtimeProfile) throw new Error("missing target-a runtime profile");
    const bundle = repo.createRoom({ title: "preaccepted identity", description: "", participants: [] });
    const identity = repo.createIdentity({ name: "A", defaultRuntimeProfileId: runtimeProfile.id });
    const runParticipant = repo.addParticipantFromIdentity(bundle.conversation.id, {
      identityId: identity.id,
      runtimeProfileId: runtimeProfile.id,
    });
    const trigger = repo.createMessage({
      conversationId: bundle.conversation.id,
      role: "user",
      senderName: "user",
      content: "run",
      status: "success",
    });
    const preaccepted = repo.createAgentRun({
      roomId: bundle.room.id,
      conversationId: bundle.conversation.id,
      participantId: runParticipant.id,
      assistantMessageId: null,
      triggerMessageId: trigger.id,
      runtime: "local-agent",
      agentTargetId: "target-a",
      provider: "codex",
      model: "default",
    });
    repo.updateAgentRun(preaccepted.id, { status: "running" });
    let streamed = false;
    const service = new ChatService(repo, new EventHub(), new AgentToolTokenStore());
    (service as any).runtimes = {
      getProvider() {
        return {
          id: "local-agent",
          describeRun: () => ({ ...acceptedRun, agentTargetId: "target-b" }),
          detect: async () => ({ available: true }),
          cancel: async () => ({ cancelled: false }),
          async *streamReply() {
            streamed = true;
            yield { type: "text_delta", text: "must not execute" };
          },
        };
      },
    };
    const generated = await (service as any).generateForParticipant(
      bundle.room.id,
      bundle.conversation.id,
      trigger,
      runParticipant,
      preaccepted,
    );
    if (generated !== null || streamed) throw new Error("changed preaccepted Agent target executed");
    const failedRun = repo.getAgentRun(preaccepted.id);
    if (failedRun?.status !== "failed" || !failedRun.error?.includes("changed before execution")) {
      throw new Error("changed preaccepted run did not fail closed");
    }
    const sessionStore = new LocalAgentSessionStore(participantWorkspaceRoot(bundle.room.id, runParticipant.id));
    sessionStore.write(bundle.conversation.id, {
      agentTargetId: "target-b",
      provider: "codex",
      providerSessionId: "target-b-session",
      model: "default",
      contextWindow: { usedTokens: 50, totalTokens: 100, percentUsed: 50 },
    });
    const workspace = new AgentWorkspaceService();
    const staleUsage = workspace.getContextUsage({ conversation: bundle.conversation, participant: runParticipant });
    if (staleUsage.source !== "workspace-estimate" || staleUsage.providerSessionActive) {
      throw new Error("context usage exposed another Agent target session");
    }
    sessionStore.write(bundle.conversation.id, {
      agentTargetId: "target-a",
      provider: "codex",
      providerSessionId: "target-a-session",
      model: "default",
      contextWindow: { usedTokens: 25, totalTokens: 100, percentUsed: 25 },
    });
    const matchingUsage = workspace.getContextUsage({ conversation: bundle.conversation, participant: runParticipant });
    if (matchingUsage.source !== "provider" || matchingUsage.providerSessionId !== "target-a-session") {
      throw new Error("context usage did not expose the matching Agent target session");
    }
    sessionStore.write(bundle.conversation.id, {
      agentTargetId: "target-a",
      provider: "codex",
      providerSessionId: "target-a-resume",
      resumeToken: "resume-target-a",
      model: "default",
      usage: { contextWindow: { usedTokens: 80, totalTokens: 100 } },
      contextWindow: { usedTokens: 80, totalTokens: 100, percentUsed: 80 },
    });
    sessionStore.updateUsage(bundle.conversation.id, {
      agentTargetId: "target-b",
      provider: "codex",
      model: "default",
      usage: { contextWindow: { usedTokens: 10, totalTokens: 100 } },
    });
    const switchedSession = sessionStore.read(bundle.conversation.id);
    if (
      switchedSession?.agentTargetId !== "target-b"
      || switchedSession.providerSessionId
      || switchedSession.resumeToken
      || switchedSession.contextWindow?.usedTokens !== 10
    ) {
      throw new Error("target switch retained target-scoped resume state");
    }
    sessionStore.write("legacy-switch", {
      provider: "codex",
      providerSessionId: "codex-session",
      resumeToken: "codex-resume",
      model: "default",
    });
    sessionStore.write("legacy-switch", {
      provider: "claude-code",
      model: "default",
    });
    const legacySwitched = sessionStore.read("legacy-switch");
    if (legacySwitched?.providerSessionId || legacySwitched?.resumeToken) {
      throw new Error("legacy provider switch retained provider-scoped resume state");
    }
    const malformedSessionPath = join(
      participantWorkspaceRoot(bundle.room.id, runParticipant.id),
      ".group-chat",
      "local-agent-sessions",
      bundle.conversation.id + ".json",
    );
    await writeFile(malformedSessionPath, JSON.stringify({
      agentTargetId: 42,
      provider: "codex",
      model: "default",
      updatedAt: new Date().toISOString(),
    }));
    if (sessionStore.read(bundle.conversation.id) !== null) {
      throw new Error("malformed durable Agent target id was accepted");
    }
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
