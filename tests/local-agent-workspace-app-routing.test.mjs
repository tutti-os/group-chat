import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const providerModuleUrl = new URL("../apps/server/src/runtimes/local-agent-provider.ts", import.meta.url).href;

test("workspace app mentions are routed through the mentioned agent instead of a hard-coded app command", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-workspace-app-routing-"));
  const agentScript = join(home, "agent-command.mjs");
  const checkScript = join(home, "check-workspace-app-routing.ts");

  await mkdir(join(home, "rooms", "room-1", "agents", "product-agent"), { recursive: true });
  await writeFile(
    agentScript,
    `
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const payload = JSON.parse(input);
        const mentions = payload.turn.userMessage.mentions;
        const hasVibeDesign = mentions.some((mention) =>
          mention.mentionType === "reference"
          && mention.referenceProviderId === "workspace-app"
          && mention.referenceEntityId === "vibe-design"
        );
        const hasProductAgent = mentions.some((mention) =>
          mention.mentionType === "participant"
          && mention.participantId === "product-agent"
        );
        if (!hasVibeDesign || !hasProductAgent) {
          console.error("missing structured mentions", JSON.stringify(mentions));
          process.exit(1);
        }
        console.log(JSON.stringify({ type: "final_text", text: "agent-ok" }));
      });
    `,
  );
  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";

      process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};
      process.env.GROUP_CHAT_LOCAL_AGENT_CODEX_COMMAND = \`\${process.execPath} ${agentScript}\`;

      async function main() {
        const { LocalAgentRuntimeProvider } = await import(${JSON.stringify(providerModuleUrl)});
        const provider = new LocalAgentRuntimeProvider();
        const content = "[Vibe Design](mention://workspace-app/vibe-design?workspaceId=ws-1)@产品 做一个贪食蛇网站";
        const userMessage = {
          id: "msg-1",
          conversationId: "conversation-1",
          role: "user",
          senderParticipantId: null,
          senderName: "老板111",
          content,
          mentions: [
            {
              mentionType: "reference",
              referenceProviderId: "workspace-app",
              referenceEntityId: "vibe-design",
              displayNameSnapshot: "Vibe Design",
              referenceScope: { workspaceId: "ws-1" },
              referenceInsert: {
                kind: "mention",
                entityId: "vibe-design",
                label: "Vibe Design",
                scope: { workspaceId: "ws-1" },
              },
            },
            {
              mentionType: "participant",
              participantId: "product-agent",
              displayNameSnapshot: "产品",
            },
          ],
          visibility: "public",
          status: "success",
          branchId: null,
          parentMessageId: null,
          runId: null,
          tokenUsage: null,
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        };

        const context = {
          runId: "run-1",
          conversation: {
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
            lastMessage: content,
            lastMessageAt: "2026-06-24T00:00:00.000Z",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          participant: {
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
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          identity: null,
          runtimeProfile: {
            id: "local-agent:codex",
            kind: "local-agent",
            provider: "codex",
            model: "codex:default",
            displayName: "Codex",
            enabled: true,
            trustedMode: false,
            systemPromptMode: "prompt-prefix",
            capabilities: { streaming: true, toolUse: true, reasoning: true, vision: false, resume: true },
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          userMessage,
          recentMessages: [],
          attachments: [],
        };

        let output = "";
        for await (const event of provider.streamReply(context)) {
          output += typeof event === "string" ? event : event.type === "text_delta" ? event.text : "";
        }
        assert.equal(output, "agent-ok");
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
    await rm(home, { recursive: true, force: true });
  }
});

test("codex local agent retries with isolated user skills when skill metadata is broken", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-skill-fallback-"));
  const agentScript = join(home, "agent-command.mjs");
  const checkScript = join(home, "check-skill-fallback.ts");

  await mkdir(join(home, "rooms", "room-1", "agents", "product-agent"), { recursive: true });
  await writeFile(
    agentScript,
    `
      if (!String(process.env.HOME || "").includes("isolated-skill-home")) {
        console.error("failed to load skill /Users/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---");
        process.exit(1);
      }
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        JSON.parse(input);
        console.log(JSON.stringify({ type: "final_text", text: "agent-ok-after-skill-fallback" }));
      });
    `,
  );
  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";

      process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};
      process.env.GROUP_CHAT_LOCAL_AGENT_CODEX_COMMAND = \`\${process.execPath} ${agentScript}\`;

      async function main() {
        const { LocalAgentRuntimeProvider } = await import(${JSON.stringify(providerModuleUrl)});
        const provider = new LocalAgentRuntimeProvider();
        const content = "@产品 继续做一个音乐网站";
        const userMessage = {
          id: "msg-1",
          conversationId: "conversation-1",
          role: "user",
          senderParticipantId: null,
          senderName: "老板111",
          content,
          mentions: [
            {
              mentionType: "participant",
              participantId: "product-agent",
              displayNameSnapshot: "产品",
            },
          ],
          visibility: "public",
          status: "success",
          branchId: null,
          parentMessageId: null,
          runId: null,
          tokenUsage: null,
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        };

        const context = {
          runId: "run-1",
          conversation: {
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
            lastMessage: content,
            lastMessageAt: "2026-06-24T00:00:00.000Z",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          participant: {
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
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          identity: null,
          runtimeProfile: {
            id: "local-agent:codex",
            kind: "local-agent",
            provider: "codex",
            model: "codex:default",
            displayName: "Codex",
            enabled: true,
            trustedMode: false,
            systemPromptMode: "prompt-prefix",
            capabilities: { streaming: true, toolUse: true, reasoning: true, vision: false, resume: true },
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          userMessage,
          recentMessages: [],
          attachments: [],
        };

        let output = "";
        let sawFallbackNotice = false;
        for await (const event of provider.streamReply(context)) {
          if (event.type === "thinking_delta" && event.text.includes("用户级 skill 元数据损坏")) {
            sawFallbackNotice = true;
          }
          output += typeof event === "string" ? event : event.type === "text_delta" ? event.text : "";
        }
        assert.equal(output, "agent-ok-after-skill-fallback");
        assert.equal(sawFallbackNotice, true);
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
    await rm(home, { recursive: true, force: true });
  }
});
