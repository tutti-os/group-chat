import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const instructionsModuleUrl = new URL("../apps/server/src/domains/agent-instructions.ts", import.meta.url).href;
const providerModuleUrl = new URL("../apps/server/src/runtimes/local-agent-provider.ts", import.meta.url).href;
const acpModuleUrl = new URL("../apps/server/src/runtimes/local-agent-acp.ts", import.meta.url).href;

test("roles are custom-only and empty roles do not take effect", async () => {
  const checkScript = join(await mkdtemp(join(tmpdir(), "group-chat-agent-instructions-")), "check-instructions.ts");
  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";

      async function main() {
        const { buildAgentInstructions, buildEffectiveRoleDescription } = await import(${JSON.stringify(instructionsModuleUrl)});
        const { buildKitSystemPrompt } = await import(${JSON.stringify(providerModuleUrl)});
        const { acpPromptFromLocalAgentInput } = await import(${JSON.stringify(acpModuleUrl)});
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
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
        };
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
          lastMessage: "@产品 帮我写一个详细的可口可乐的prd，500字左右",
          lastMessageAt: "2026-06-25T00:00:00.000Z",
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
        };
        const userMessage = {
          id: "msg-1",
          conversationId: "conversation-1",
          role: "user",
          senderParticipantId: null,
          senderName: "老板",
          content: "@产品 帮我写一个详细的可口可乐的prd，500字左右",
          mentions: [{ mentionType: "participant", participantId: "product-agent", displayNameSnapshot: "产品" }],
          visibility: "public",
          status: "success",
          branchId: null,
          parentMessageId: null,
          runId: null,
          tokenUsage: null,
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
        };
        const emptyIdentity = {
          id: "identity-product",
          name: "产品",
          icon: "",
          systemPrompt: "",
          stylePrompt: "",
          defaultRuntimeProfileId: "local-agent:codex",
          defaultListenMode: "passive",
          defaultReasoningEffort: null,
          defaultSpeedMode: null,
          temperature: 0.7,
          skillIds: [],
          toolAccessPolicy: { mode: "read-only", allowedToolIds: [] },
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
        };

        assert.equal(buildEffectiveRoleDescription(participant, emptyIdentity), "");
        assert.match(buildAgentInstructions({ conversation, participant, identity: emptyIdentity }), /No role description configured\\./);
        assert.equal(
          buildEffectiveRoleDescription(participant, {
            ...emptyIdentity,
            systemPrompt: "You are a senior product manager agent.\\n\\nYour job is to turn ambiguous ideas into clear product direction.",
          }),
          "",
        );

        const customIdentity = {
          ...emptyIdentity,
          systemPrompt: "你是用户自定义的产品顾问，输出前先说明关键假设。",
        };
        assert.equal(buildEffectiveRoleDescription(participant, customIdentity), customIdentity.systemPrompt);

        const systemPrompt = buildKitSystemPrompt({
          runId: "run-1",
          conversation,
          participant,
          identity: emptyIdentity,
          runtimeProfile: null,
          userMessage,
          recentMessages: [],
          attachments: [],
        });
        assert.match(systemPrompt, /target length such as 500字左右/);
        assert.match(systemPrompt, /honor that request even when the reply is longer/);

        const acpPrompt = acpPromptFromLocalAgentInput({
          protocolVersion: "group-chat.local-agent.v1",
          workspaceRoot: "/tmp/group-chat",
          conversation,
          participant,
          turn: { kind: "message", userMessage, attachments: [] },
          tools: {
            contextUrl: "http://127.0.0.1/context",
            artifactUrlTemplate: "http://127.0.0.1/artifacts/{artifactId}",
            sendMessageUrl: "http://127.0.0.1/messages",
            saveArtifactUrl: "http://127.0.0.1/artifacts",
          },
        });
        assert.match(acpPrompt, /target length such as 500字左右/);
        assert.match(acpPrompt, /honor that request even when the reply is longer/);
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
    });
  } finally {
    await rm(dirname(checkScript), { recursive: true, force: true });
  }
});
