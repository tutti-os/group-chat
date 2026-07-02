import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const providerModuleUrl = new URL("../apps/server/src/runtimes/local-agent-provider.ts", import.meta.url).href;
const protocolModuleUrl = new URL("../apps/server/src/runtimes/local-agent-protocol.ts", import.meta.url).href;
const acpModuleUrl = new URL("../apps/server/src/runtimes/local-agent-acp.ts", import.meta.url).href;
const chatServiceModuleUrl = new URL("../apps/server/src/domains/chat-service.ts", import.meta.url).href;
const chatRepositoryModuleUrl = new URL("../apps/server/src/domains/chat-repository.ts", import.meta.url).href;
const databaseModuleUrl = new URL("../apps/server/src/db/database.ts", import.meta.url).href;
const eventHubModuleUrl = new URL("../apps/server/src/ws/event-hub.ts", import.meta.url).href;
const tokenStoreModuleUrl = new URL("../apps/server/src/domains/agent-tool-tokens.ts", import.meta.url).href;

test("workspace app and agent mentions produce a clean intent prompt", async () => {
  const checkScript = join(await mkdtemp(join(tmpdir(), "group-chat-workspace-app-intent-")), "check-intent.ts");
  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";
      async function main() {
        const { buildLocalAgentInput } = await import(${JSON.stringify(protocolModuleUrl)});
        const { acpPromptFromLocalAgentInput } = await import(${JSON.stringify(acpModuleUrl)});
        const content = "[Vibe Design](mention://workspace-app/vibe-design?workspaceId=ws-1) @产品 你去做一个音乐网站";
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
          runtimeProfile: null,
          userMessage: {
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
                referenceScope: { workspaceId: "ws-1", iconUrl: "data:image/png;base64,bad" },
                referenceInsert: {
                  kind: "mention",
                  mention: {
                    entityId: "vibe-design",
                    label: "Vibe Design",
                    scope: { workspaceId: "ws-1", iconUrl: "data:image/png;base64,bad" },
                  },
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
          },
          recentMessages: [],
          attachments: [],
        };
        const input = buildLocalAgentInput(context);
        assert.equal(input.turn.intent.requestText, "你去做一个音乐网站");
        assert.equal(input.turn.intent.workspaceApps[0].appId, "vibe-design");
        assert.deepEqual(input.turn.intent.workspaceApps[0].scope, { workspaceId: "ws-1" });
        const prompt = acpPromptFromLocalAgentInput(input);
        assert.match(prompt, /<intent>/);
        assert.equal(prompt.includes("data:image/png;base64"), false);
        assert.match(prompt, /request_text: 你去做一个音乐网站/);
        assert.match(prompt, /Handle the referenced workspace app through the injected Tutti workspace-app skill/);
        assert.match(prompt, /Do not treat the app label as a generic design keyword, Figma document, shell command, or MCP server name/);
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

test("workspace app mentions keep structured context for the mentioned agent", async () => {
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
        const intent = payload.turn.intent;
        if (
          !intent
          || intent.requestText !== "做一个贪食蛇网站"
          || !intent.instruction.includes("Vibe Design")
          || !intent.instruction.includes("vibe-design")
          || !intent.instruction.includes("Handle the referenced workspace app through the injected Tutti workspace-app skill")
        ) {
          console.error("missing workspace app intent", JSON.stringify(intent));
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
                mention: {
                  entityId: "vibe-design",
                  label: "Vibe Design",
                  scope: { workspaceId: "ws-1" },
                },
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

test("workspace app-only task routes to a local app dispatcher", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-workspace-app-only-"));
  const agentScript = join(home, "agent-command.mjs");
  const checkScript = join(home, "check-workspace-app-only.ts");

  await writeFile(
    agentScript,
    `
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const payload = JSON.parse(input);
        const mentions = payload.turn.userMessage.mentions;
        const intent = payload.turn.intent;
        if (
          !intent
          || intent.requestText !== "做一个音乐 app 的网站"
          || intent.workspaceApps?.[0]?.appId !== "vibe-design"
          || !intent.instruction.includes("app-only dispatch rule")
          || mentions.some((mention) => mention.mentionType === "participant")
          || !mentions.some((mention) => mention.mentionType === "reference" && mention.referenceProviderId === "workspace-app")
        ) {
          console.error("bad app-only payload", JSON.stringify({ intent, mentions }));
          process.exit(1);
        }
        console.log(JSON.stringify({ type: "final_text", text: "app-agent-ok" }));
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
        const { closeDb } = await import(${JSON.stringify(databaseModuleUrl)});
        const { ChatService } = await import(${JSON.stringify(chatServiceModuleUrl)});
        const { ChatRepository } = await import(${JSON.stringify(chatRepositoryModuleUrl)});
        const { EventHub } = await import(${JSON.stringify(eventHubModuleUrl)});
        const { AgentToolTokenStore } = await import(${JSON.stringify(tokenStoreModuleUrl)});
        const service = new ChatService(new ChatRepository(), new EventHub(), new AgentToolTokenStore());
        service.bootstrap();
        const { conversation } = service.createRoom({ title: "Workspace app-only", description: "" });
        const content = "[产品原型设计](mention://workspace-app/vibe-design?workspaceId=ws-1) 做一个音乐 app 的网站";
        const result = service.sendMessage(conversation.id, {
          content,
          mentions: [{
            mentionType: "reference",
            participantId: "vibe-design",
            referenceProviderId: "workspace-app",
            referenceEntityId: "vibe-design",
            displayNameSnapshot: "产品原型设计",
            referenceScope: { workspaceId: "ws-1" },
            referenceInsert: {
              kind: "mention",
              mention: {
                entityId: "vibe-design",
                label: "产品原型设计",
                scope: { workspaceId: "ws-1" },
              },
            },
          }],
          maxReplyRounds: 1,
        });

        assert.equal(result.targets.length, 1);
        assert.equal(result.targets[0].runtimeProfileId, "local-agent:codex");
        assert.equal(result.targets[0].displayName, "产品原型设计");
        assert.equal(result.message.mentions.length, 1);
        assert.equal(result.message.mentions[0].mentionType, "reference");

        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const snapshot = service.bootstrap();
          const assistant = snapshot.messages.find((message) =>
            message.conversationId === conversation.id
            && message.role === "assistant"
            && message.content === "app-agent-ok"
          );
          if (assistant) {
            closeDb();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        closeDb();
        assert.fail("timed out waiting for app-only dispatcher reply");
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

test("codex local agent falls back to minimal context after repeated context window failures", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-context-fallback-"));
  const binDir = join(home, "bin");
  const promptDir = join(home, "prompts");
  const codexHome = join(home, "codex-home");
  const fakeCodex = join(binDir, "codex");
  const fakeTutti = join(binDir, "tutti-dev");
  const attemptFile = join(home, "attempt-count.txt");
  const checkScript = join(home, "check-context-fallback.ts");

  await mkdir(binDir, { recursive: true });
  await mkdir(promptDir, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await mkdir(join(home, "rooms", "room-1", "agents", "product-agent"), { recursive: true });
  await writeFile(join(codexHome, "auth.json"), "{}");
  await writeFile(
    fakeTutti,
    `#!/usr/bin/env node
      const repeated = "PROMPT_INJECTION_MARKER ".repeat(200);
      console.log(JSON.stringify({
        provider: "codex",
        recommendedSystemPrompt: { content: "RECOMMENDED_PROMPT_MARKER ".repeat(200) },
        skills: [{ skillId: "big-skill", slug: "big-skill", deliveryMode: "prompt-injection", content: repeated }]
      }));
    `,
  );
  await chmod(fakeTutti, 0o755);
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env node
      const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const prompt = readFileSync(0, "utf8");
      const attemptFile = process.env.FAKE_CODEX_ATTEMPT_FILE;
      const promptDir = process.env.FAKE_CODEX_PROMPT_DIR;
      const attempt = (attemptFile && existsSync(attemptFile) ? Number(readFileSync(attemptFile, "utf8")) : 0) + 1;
      writeFileSync(attemptFile, String(attempt));
      writeFileSync(join(promptDir, \`attempt-\${attempt}.txt\`), prompt);
      if (attempt < 3) {
        console.error("Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.");
        process.exit(1);
      }
      for (const marker of [
        "PROMPT_INJECTION_MARKER",
        "RECOMMENDED_PROMPT_MARKER",
        "Conversation history:",
        "old-message-",
        "COLLAB_RULE_MARKER",
        "<tool_gateway>"
      ]) {
        if (prompt.includes(marker)) {
          console.error(\`minimal retry still contains \${marker}\`);
          process.exit(1);
        }
      }
      console.log(JSON.stringify({ type: "text_delta", text: "recovered-minimal" }));
    `,
  );
  await chmod(fakeCodex, 0o755);
  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";
      import { readFile } from "node:fs/promises";
      import { join } from "node:path";

      process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};
      process.env.GROUP_CHAT_TUTTI_CLI = ${JSON.stringify(fakeTutti)};
      process.env.CODEX_HOME = ${JSON.stringify(codexHome)};
      process.env.FAKE_CODEX_ATTEMPT_FILE = ${JSON.stringify(attemptFile)};
      process.env.FAKE_CODEX_PROMPT_DIR = ${JSON.stringify(promptDir)};
      process.env.PATH = ${JSON.stringify(binDir)} + ":" + (process.env.PATH || "");
      delete process.env.GROUP_CHAT_LOCAL_AGENT_COMMAND;
      delete process.env.GROUP_CHAT_LOCAL_AGENT_CODEX_COMMAND;

      async function main() {
        const { LocalAgentRuntimeProvider } = await import(${JSON.stringify(providerModuleUrl)});
        const provider = new LocalAgentRuntimeProvider();
        const content = "@产品 帮我修复上下文超限后的死局";
        const userMessage = {
          id: "msg-1",
          conversationId: "conversation-1",
          role: "user",
          senderParticipantId: null,
          senderName: "老板",
          content,
          mentions: [{ mentionType: "participant", participantId: "product-agent", displayNameSnapshot: "产品" }],
          visibility: "public",
          status: "success",
          branchId: null,
          parentMessageId: null,
          runId: null,
          tokenUsage: null,
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        };
        const recentMessages = Array.from({ length: 8 }, (_, index) => ({
          ...userMessage,
          id: \`old-\${index}\`,
          role: index % 2 ? "assistant" : "user",
          senderName: index % 2 ? "产品" : "老板",
          content: \`old-message-\${index} \${"history ".repeat(200)}\`,
        }));
        const context = {
          runId: "run-1",
          conversation: {
            id: "conversation-1",
            roomId: "room-1",
            type: "group",
            title: "AI 讨论室",
            groupSystemPrompt: "",
            collaborationRules: "COLLAB_RULE_MARKER ".repeat(200),
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
            speedMode: null,
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
          recentMessages,
          attachments: [],
        };

        let output = "";
        let sawFreshRetry = false;
        let sawMinimalRetry = false;
        for await (const event of provider.streamReply(context)) {
          if (event.type === "thinking_delta" && event.text.includes("减少历史上下文")) sawFreshRetry = true;
          if (event.type === "thinking_delta" && event.text.includes("紧急最小上下文")) sawMinimalRetry = true;
          output += event.type === "text_delta" ? event.text : "";
        }

        assert.equal(output, "recovered-minimal");
        assert.equal(sawFreshRetry, true);
        assert.equal(sawMinimalRetry, true);
        assert.equal(await readFile(${JSON.stringify(attemptFile)}, "utf8"), "3");
        const compactPrompt = await readFile(join(${JSON.stringify(promptDir)}, "attempt-2.txt"), "utf8");
        assert.match(compactPrompt, /old-message-7/);
        assert.doesNotMatch(compactPrompt, /old-message-0/);
        const minimalPrompt = await readFile(join(${JSON.stringify(promptDir)}, "attempt-3.txt"), "utf8");
        assert.doesNotMatch(minimalPrompt, /PROMPT_INJECTION_MARKER/);
        assert.doesNotMatch(minimalPrompt, /RECOMMENDED_PROMPT_MARKER/);
        assert.doesNotMatch(minimalPrompt, /Conversation history:/);
        assert.doesNotMatch(minimalPrompt, /COLLAB_RULE_MARKER/);
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

test("local agent command bridge forwards thinking deltas", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-command-thinking-"));
  const agentScript = join(home, "agent-command.mjs");
  const checkScript = join(home, "check-command-thinking.ts");

  await mkdir(join(home, "rooms", "room-1", "agents", "product-agent"), { recursive: true });
  await writeFile(
    agentScript,
    `
      process.stdin.resume();
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ type: "thinking_delta", text: "先读取上下文，再执行请求。" }));
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
        const content = "@产品 处理一下";
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
            speedMode: null,
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
          userMessage: {
            id: "msg-1",
            conversationId: "conversation-1",
            role: "user",
            senderParticipantId: null,
            senderName: "老板111",
            content,
            mentions: [{ mentionType: "participant", participantId: "product-agent", displayNameSnapshot: "产品" }],
            visibility: "public",
            status: "success",
            branchId: null,
            parentMessageId: null,
            runId: null,
            tokenUsage: null,
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          recentMessages: [],
          attachments: [],
        };

        let output = "";
        let thinking = "";
        for await (const event of provider.streamReply(context)) {
          if (event.type === "thinking_delta") thinking += event.text;
          output += typeof event === "string" ? event : event.type === "text_delta" ? event.text : "";
        }
        assert.equal(thinking, "先读取上下文，再执行请求。");
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

test("completed local agent replies keep explicit thinking events", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-explicit-thinking-"));
  const agentScript = join(home, "agent-command.mjs");
  const checkScript = join(home, "check-explicit-thinking.ts");

  await mkdir(join(home, "rooms", "room-1", "agents", "product-agent"), { recursive: true });
  await writeFile(
    agentScript,
    `
      process.stdin.resume();
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ type: "thinking_delta", text: "先读取上下文，再执行请求。" }));
        console.log(JSON.stringify({ type: "final_text", text: "处理完成。" }));
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
        const { closeDb } = await import(${JSON.stringify(databaseModuleUrl)});
        const { ChatService } = await import(${JSON.stringify(chatServiceModuleUrl)});
        const { ChatRepository } = await import(${JSON.stringify(chatRepositoryModuleUrl)});
        const { EventHub } = await import(${JSON.stringify(eventHubModuleUrl)});
        const { AgentToolTokenStore } = await import(${JSON.stringify(tokenStoreModuleUrl)});
        const service = new ChatService(new ChatRepository(), new EventHub(), new AgentToolTokenStore());
        service.bootstrap();
        const { conversation } = service.createRoom({ title: "Thinking test", description: "" });
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
        service.sendMessage(conversation.id, {
          content: "@产品 处理一下",
          mentions: [{ mentionType: "participant", participantId: participant.id, displayNameSnapshot: participant.displayName }],
          maxReplyRounds: 1,
        });

        let snapshot = service.bootstrap();
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          snapshot = service.bootstrap();
          const run = snapshot.agentRuns.find((item) => item.participantId === participant.id);
          if (run?.status === "completed") break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const run = snapshot.agentRuns.find((item) => item.participantId === participant.id);
        assert.equal(run?.status, "completed");
        const thinking = snapshot.agentRunEvents.find((event) => event.runId === run.id && event.type === "thinking_delta");
        assert.equal(thinking?.content, "先读取上下文，再执行请求。");
        const assistant = snapshot.messages.find((message) => message.id === run.assistantMessageId);
        assert.equal(assistant?.content, "处理完成。");
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
    await rm(home, { recursive: true, force: true });
  }
});
