import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const workspaceModuleUrl = new URL("../apps/server/src/domains/agent-workspace.ts", import.meta.url).href;

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
