import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const providerModuleUrl = new URL("../apps/server/src/runtimes/local-agent-provider.ts", import.meta.url).href;

test("request-scoped and standalone runs use one effective cwd for detection, skills, runtime, and compaction", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-effective-cwd-"));
  const fakeTutti = join(home, "fake-tutti.mjs");
  const cliLog = join(home, "cli-cwds.jsonl");
  const checkScript = join(home, "check-effective-cwd.ts");

  await Promise.all([
    mkdir(join(home, "rooms", "room-standalone", "agents", "participant-standalone"), { recursive: true }),
    mkdir(join(home, "rooms", "room-managed", "agents", "participant-managed"), { recursive: true }),
  ]);

  await writeFile(
    fakeTutti,
    `#!/usr/bin/env node
      const { appendFileSync } = await import("node:fs");
      appendFileSync(${JSON.stringify(cliLog)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
      if (process.argv.includes("list")) {
        console.log(JSON.stringify({
          schemaVersion: 1,
          defaultAgentTargetId: "agent-1",
          agents: [{
            id: "agent-1",
            provider: "codex",
            name: "Primary Agent",
            availability: { status: "available", reasonCode: "ready", detail: "" }
          }]
        }));
      } else {
        console.log(JSON.stringify({
          provider: "codex",
          agentTargetId: "agent-1",
          recommendedSystemPrompt: { content: "Use the injected workspace app skill." },
          skills: []
        }));
      }
    `,
  );
  await chmod(fakeTutti, 0o755);

  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";
      import { readFile, realpath } from "node:fs/promises";
      import { join, resolve } from "node:path";

      process.env.GROUP_CHAT_HOME = ${JSON.stringify(home)};
      process.env.TUTTI_APP_DATA_DIR = ${JSON.stringify(home)};
      process.env.GROUP_CHAT_TUTTI_CLI = ${JSON.stringify(fakeTutti)};
      delete process.env.GROUP_CHAT_LOCAL_AGENT_COMMAND;
      delete process.env.GROUP_CHAT_LOCAL_AGENT_CODEX_COMMAND;

      function createContext(suffix, requestScoped) {
        const conversationId = \`conversation-\${suffix}\`;
        const roomId = \`room-\${suffix}\`;
        const participantId = \`participant-\${suffix}\`;
        const content = "[Vibe Design](mention://workspace-app/vibe-design) build a page";
        const userMessage = {
          id: \`message-\${suffix}\`,
          conversationId,
          role: "user",
          senderParticipantId: null,
          senderName: "User",
          content,
          mentions: [{
            mentionType: "reference",
            referenceProviderId: "workspace-app",
            referenceEntityId: "vibe-design",
            displayNameSnapshot: "Vibe Design",
          }],
          visibility: "public",
          status: "success",
          branchId: null,
          parentMessageId: null,
          runId: null,
          tokenUsage: null,
          createdAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:00:00.000Z",
        };
        return {
          runId: \`run-\${suffix}\`,
          conversation: {
            id: conversationId,
            roomId,
            type: "group",
            title: "Effective cwd",
            groupSystemPrompt: "",
            collaborationRules: "",
            collaborationRulesVersion: 1,
            replyPolicy: { mode: "mentioned", order: "sequential", maxRounds: 1, mentionFollowupRounds: 0 },
            activeBranchId: null,
            pinned: false,
            lastMessage: content,
            lastMessageAt: "2026-07-19T00:00:00.000Z",
            createdAt: "2026-07-19T00:00:00.000Z",
            updatedAt: "2026-07-19T00:00:00.000Z",
          },
          participant: {
            id: participantId,
            conversationId,
            kind: "ai",
            displayName: "Agent",
            avatar: null,
            runtimeProfileId: "local-agent:codex",
            agentTargetId: "agent-1",
            identityId: null,
            roomInstructions: "",
            status: "active",
            listenMode: "passive",
            sortOrder: 0,
            reasoningEffort: null,
            speedMode: null,
            createdAt: "2026-07-19T00:00:00.000Z",
            updatedAt: "2026-07-19T00:00:00.000Z",
          },
          identity: null,
          runtimeProfile: {
            id: "local-agent:codex",
            kind: "local-agent",
            provider: "codex",
            agentTargetId: "agent-1",
            model: "codex:default",
            displayName: "Codex",
            enabled: true,
            trustedMode: false,
            systemPromptMode: "prompt-prefix",
            capabilities: { streaming: true, toolUse: true, reasoning: true, vision: false, resume: true },
            createdAt: "2026-07-19T00:00:00.000Z",
            updatedAt: "2026-07-19T00:00:00.000Z",
          },
          userMessage,
          recentMessages: [],
          attachments: [],
          ...(requestScoped ? { agentDetectContext: { cwd: process.cwd() } } : {}),
        };
      }

      async function main() {
        const { LocalAgentRuntimeProvider } = await import(${JSON.stringify(providerModuleUrl)});
        const runtimeInputs = [];
        const detectInputs = [];
        const fakeRuntime = {
          detect: async (input) => {
            detectInputs.push(input);
            return [{
              agentTargetId: "agent-1",
              provider: "codex",
              displayName: "Primary Agent",
              supported: true,
              executablePath: process.execPath,
              models: [{ id: "default", label: "Default" }],
              defaultModelId: "default",
              isDefault: true,
            }];
          },
          listProviders: () => [{ id: "codex" }],
          cancel: async () => undefined,
          async *run(input) {
            runtimeInputs.push(input);
            yield { type: "text_delta", text: "ok" };
            yield { type: "done", status: "completed", sessionId: "provider-session-1" };
          },
        };

        async function runCase(suffix, requestScoped) {
          const provider = new LocalAgentRuntimeProvider();
          provider.localAgentRuntime = fakeRuntime;
          const context = createContext(suffix, requestScoped);
          for await (const _event of provider.streamReply(context)) {
            // Drain the stream so the session is persisted for compaction.
          }
          return { provider, context, input: runtimeInputs.at(-1) };
        }

        const standalone = await runCase("standalone", false);
        const standaloneWorkspace = resolve(join(
          ${JSON.stringify(home)},
          "rooms",
          standalone.context.conversation.roomId,
          "agents",
          standalone.context.participant.id,
        ));
        assert.equal(standalone.input.cwd, standaloneWorkspace);
        assert.deepEqual(standalone.input.extraAllowedDirs, [standaloneWorkspace]);
        assert.equal("GROUP_CHAT_WORKSPACE" in standalone.input.env, false);

        const requestScoped = await runCase("request-scoped", true);
        const requestScopedWorkspace = resolve(join(
          ${JSON.stringify(home)},
          "rooms",
          requestScoped.context.conversation.roomId,
          "agents",
          requestScoped.context.participant.id,
        ));
        assert.equal(requestScoped.input.cwd, requestScopedWorkspace);
        assert.deepEqual(requestScoped.input.extraAllowedDirs, [requestScopedWorkspace]);
        assert.equal("GROUP_CHAT_WORKSPACE" in requestScoped.input.env, false);
        assert.equal(await realpath(detectInputs[0].cwd), await realpath(standalone.input.cwd));
        assert.equal(await realpath(detectInputs[1].cwd), await realpath(requestScoped.input.cwd));

        const cliCalls = (await readFile(${JSON.stringify(cliLog)}, "utf8"))
          .trim()
          .split("\\n")
          .map((line) => JSON.parse(line));
        const skillCalls = cliCalls.filter((call) => !call.args.includes("list"));
        assert.ok(skillCalls.length >= 1, JSON.stringify(cliCalls));
        assert.equal(await realpath(skillCalls[0].cwd), await realpath(standalone.input.cwd));

        const compactContext = {
          ...requestScoped.context,
          runId: undefined,
          agentDetectContext: undefined,
        };
        await requestScoped.provider.compactContext(compactContext);
        const compactInput = runtimeInputs.at(-1);
        assert.equal(compactInput.prompt, "/compact");
        assert.equal(compactInput.cwd, requestScopedWorkspace);
        assert.deepEqual(compactInput.extraAllowedDirs, [requestScopedWorkspace]);
        assert.equal("GROUP_CHAT_WORKSPACE" in compactInput.env, false);
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
      env: { ...process.env, GROUP_CHAT_HOME: home, TUTTI_APP_DATA_DIR: home },
    });
  } finally {
    await rm(dirname(checkScript), { recursive: true, force: true });
  }
});
