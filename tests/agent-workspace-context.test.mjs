import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const workspaceModuleUrl = new URL("../apps/server/src/domains/agent-workspace.ts", import.meta.url).href;
const sessionStoreModuleUrl = new URL("../apps/server/src/runtimes/local-agent-session-store.ts", import.meta.url).href;
const chatServiceModuleUrl = new URL("../apps/server/src/domains/chat-service.ts", import.meta.url).href;
const chatRepositoryModuleUrl = new URL("../apps/server/src/domains/chat-repository.ts", import.meta.url).href;
const databaseModuleUrl = new URL("../apps/server/src/db/database.ts", import.meta.url).href;
const eventHubModuleUrl = new URL("../apps/server/src/ws/event-hub.ts", import.meta.url).href;
const tokenStoreModuleUrl = new URL("../apps/server/src/domains/agent-tool-tokens.ts", import.meta.url).href;

test("manual agent context compaction trims raw conversation log and refreshes usage", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-agent-context-"));
  const checkScript = join(home, "check-agent-context.ts");

  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";
      import { readFile } from "node:fs/promises";
      import { join } from "node:path";

      process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};

      function message(id, role, content, timestamp) {
        return {
          id,
          conversationId: "conversation-1",
          role,
          senderParticipantId: role === "assistant" ? "product-agent" : null,
          senderName: role === "assistant" ? "产品" : "老板",
          content,
          mentions: [],
          visibility: "public",
          status: "success",
          branchId: null,
          parentMessageId: null,
          runId: null,
          tokenUsage: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }

      async function main() {
        const { AgentWorkspaceService } = await import(${JSON.stringify(workspaceModuleUrl)});
        const service = new AgentWorkspaceService();
        const conversation = {
          id: "conversation-1",
          roomId: "room-1",
          type: "group",
          title: "AI 讨论室",
          groupSystemPrompt: "",
          collaborationRules: "",
          collaborationRulesVersion: 1,
          replyPolicy: { mode: "mentioned", order: "sequential", maxRounds: 1, mentionFollowupRounds: 0 },
          activeBranchId: null,
          pinned: false,
          lastMessage: "",
          lastMessageAt: "2026-07-02T00:00:00.000Z",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        };
        const participant = {
          id: "product-agent",
          conversationId: "conversation-1",
          kind: "ai",
          displayName: "产品",
          avatar: null,
          runtimeProfileId: "local-agent:codex",
          identityId: "identity-product",
          roomInstructions: "",
          status: "active",
          listenMode: "passive",
          sortOrder: 0,
          reasoningEffort: null,
          speedMode: null,
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        };

        service.materializeParticipant({ conversation, participant, identity: null });
        for (let index = 0; index < 25; index += 1) {
          const timestamp = \`2026-07-02T00:\${String(index).padStart(2, "0")}:00.000Z\`;
          service.recordInteractionMemory({
            conversation,
            participant,
            userMessage: message(\`user-\${index}\`, "user", \`old-user-\${index} \${"u".repeat(1400)}\`, timestamp),
            assistantMessage: message(\`assistant-\${index}\`, "assistant", \`latest-assistant-\${index} \${"a".repeat(1400)}\`, timestamp),
          });
        }

        const before = service.getContextUsage({ conversation, participant });
        assert.equal(before.compacted, false);
        assert.ok(before.rawConversationLogChars > before.rawConversationLogKeepChars);

        const result = service.compactConversationContext({ conversation, participant });
        assert.equal(result.before.rawConversationLogChars, before.rawConversationLogChars);
        assert.equal(result.after.compacted, true);
        assert.ok(result.after.rawConversationLogChars < before.rawConversationLogChars);
        assert.ok(result.after.totalChars < before.totalChars);

        const logPath = join(${JSON.stringify(home)}, "rooms", "room-1", "agents", "product-agent", "conversations", "conversation-1.md");
        const log = await readFile(logPath, "utf8");
        assert.match(log, /Manually compacted at/);
        assert.doesNotMatch(log, /old-user-0/);
        assert.match(log, /latest-assistant-24/);

        const distilled = await readFile(join(${JSON.stringify(home)}, "rooms", "room-1", "agents", "product-agent", "DISTILLED_CONTEXT.md"), "utf8");
        assert.match(distilled, /Raw conversation log chars:/);
      }

      main().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `,
  );

  try {
    await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", checkScript], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, GROUP_CHAT_HOME: home },
    });
  } finally {
    await rm(dirname(checkScript), { recursive: true, force: true });
  }
});

test("agent context usage prefers real provider context window when available", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-agent-context-usage-"));
  const checkScript = join(home, "check-agent-context-usage.ts");

  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";
      import { mkdir, readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path";

      process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};

      async function main() {
        const { AgentWorkspaceService } = await import(${JSON.stringify(workspaceModuleUrl)});
        const { LocalAgentSessionStore, extractContextWindowUsage } = await import(${JSON.stringify(sessionStoreModuleUrl)});
        const service = new AgentWorkspaceService();
        const conversation = {
          id: "conversation-1",
          roomId: "room-1",
          type: "group",
          title: "AI 讨论室",
          groupSystemPrompt: "",
          collaborationRules: "",
          collaborationRulesVersion: 1,
          replyPolicy: { mode: "mentioned", order: "sequential", maxRounds: 1, mentionFollowupRounds: 0 },
          activeBranchId: null,
          pinned: false,
          lastMessage: "",
          lastMessageAt: "2026-07-02T00:00:00.000Z",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        };
        const participant = {
          id: "product-agent",
          conversationId: "conversation-1",
          kind: "ai",
          displayName: "产品",
          avatar: null,
          runtimeProfileId: "local-agent:codex",
          identityId: "identity-product",
          roomInstructions: "",
          status: "active",
          listenMode: "passive",
          sortOrder: 0,
          reasoningEffort: null,
          speedMode: null,
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        };
        service.materializeParticipant({ conversation, participant, identity: null });
        const root = join(${JSON.stringify(home)}, "rooms", "room-1", "agents", "product-agent");
        const store = new LocalAgentSessionStore(root);
        store.write(conversation.id, {
          provider: "codex",
          providerSessionId: "provider-session-1",
          model: "codex:gpt-5",
        });
        store.updateUsage(conversation.id, {
          provider: "codex",
          model: "codex:gpt-5",
          usage: { contextWindow: { usedTokens: 50_000, totalTokens: 200_000 } },
        });

        assert.deepEqual(
          extractContextWindowUsage({ tokenUsage: { last: { totalTokens: 12_000 }, modelContextWindow: 200_000 } }),
          { usedTokens: 12_000, totalTokens: 200_000, percentUsed: 6 },
        );

        const usage = service.getContextUsage({ conversation, participant });
        assert.equal(usage.source, "provider");
        assert.equal(usage.provider, "codex");
        assert.equal(usage.providerSessionId, "provider-session-1");
        assert.equal(usage.contextWindowUsedTokens, 50_000);
        assert.equal(usage.contextWindowTotalTokens, 200_000);
        assert.equal(usage.contextWindowPercentUsed, 25);
      }

      main().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `,
  );

  try {
    await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", checkScript], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, GROUP_CHAT_HOME: home },
    });
  } finally {
    await rm(dirname(checkScript), { recursive: true, force: true });
  }
});

test("manual context compaction tries provider compact before local log fallback", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-provider-compact-"));
  const checkScript = join(home, "check-provider-compact.ts");

  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";
      import { mkdir, readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path";

      process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};

      async function main() {
        const { closeDb } = await import(${JSON.stringify(databaseModuleUrl)});
        const { ChatService } = await import(${JSON.stringify(chatServiceModuleUrl)});
        const { ChatRepository } = await import(${JSON.stringify(chatRepositoryModuleUrl)});
        const { EventHub } = await import(${JSON.stringify(eventHubModuleUrl)});
        const { AgentToolTokenStore } = await import(${JSON.stringify(tokenStoreModuleUrl)});
        const { LocalAgentSessionStore } = await import(${JSON.stringify(sessionStoreModuleUrl)});

        const service = new ChatService(new ChatRepository(), new EventHub(), new AgentToolTokenStore());
        service.bootstrap();
        const { conversation } = service.createRoom({ title: "Provider compact", description: "" });
        const identity = service.createIdentity({
          name: "产品",
          icon: "产",
          systemPrompt: "",
          stylePrompt: "",
          defaultRuntimeProfileId: "local-agent:codex",
          temperature: 0.7,
          skillIds: [],
          toolAccessPolicy: { mode: "none", approvedToolIds: [] },
        });
        const { participant } = service.addParticipant(conversation.id, {
          identityId: identity.id,
          runtimeProfileId: "local-agent:codex",
        });
        const rawLogPath = join(${JSON.stringify(home)}, "rooms", conversation.roomId, "agents", participant.id, "conversations", \`\${conversation.id}.md\`);
        await mkdir(join(${JSON.stringify(home)}, "rooms", conversation.roomId, "agents", participant.id, "conversations"), { recursive: true });
        await writeFile(rawLogPath, \`# Raw Conversation Log\\n\\nold-message \${"x".repeat(120_000)}\\nlatest-message keep me\\n\`, "utf8");

        let compactCalls = 0;
        service.runtimes = {
          getProvider() {
            return {
              id: "fake-local-agent",
              canHandle: () => true,
              describeRun: () => ({ runtime: "local-agent", provider: "codex", model: "codex:default" }),
              detect: async () => ({ available: true }),
              cancel: async () => ({ cancelled: false }),
              compactContext: async (context) => {
                compactCalls += 1;
                const root = join(${JSON.stringify(home)}, "rooms", context.conversation.roomId, "agents", context.participant.id);
                const store = new LocalAgentSessionStore(root);
                store.write(context.conversation.id, {
                  provider: "codex",
                  providerSessionId: "provider-session-1",
                  model: "codex:default",
                });
                store.updateUsage(context.conversation.id, {
                  provider: "codex",
                  model: "codex:default",
                  usage: { contextWindow: { usedTokens: 42_000, totalTokens: 200_000 } },
                });
                store.markCompacted(context.conversation.id, {
                  provider: "codex",
                  model: "codex:default",
                });
              },
            };
          },
          listLocalAgentProviders: async () => [],
        };

        const before = service.getParticipantContextUsage(conversation.id, participant.id);
        assert.equal(before.source, "workspace-estimate");
        assert.ok(before.rawConversationLogChars > before.rawConversationLogKeepChars);

        const result = await service.compactParticipantContext(conversation.id, participant.id);
        assert.equal(compactCalls, 1);
        assert.equal(result.before.source, "workspace-estimate");
        assert.equal(result.after.source, "provider");
        assert.equal(result.after.contextWindowUsedTokens, 42_000);
        assert.equal(result.after.providerCompactedAt !== null, true);
        assert.equal(result.after.compacted, true);
        assert.ok(result.after.rawConversationLogChars < before.rawConversationLogChars);
        assert.ok(result.after.totalChars < before.totalChars);
        const compactedLog = await readFile(rawLogPath, "utf8");
        assert.doesNotMatch(compactedLog, /old-message/);
        assert.match(compactedLog, /latest-message keep me/);

        closeDb();
      }

      main().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `,
  );

  try {
    await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", checkScript], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, GROUP_CHAT_HOME: home },
    });
  } finally {
    await rm(dirname(checkScript), { recursive: true, force: true });
  }
});
