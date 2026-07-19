import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const providerModuleUrl = new URL("../apps/server/src/runtimes/local-agent-provider.ts", import.meta.url).href;

test("managed and standalone runs use one effective cwd for detection, skills, runtime, and compaction", async () => {
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

      const credentialHeaders = { "x-tsh-managed-agent-credential": "managed-secret" };

      function createContext(suffix, managed) {
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
          ...(managed
            ? {
                managedAgentHeaders: credentialHeaders,
              }
            : {}),
        };
      }

      async function main() {
        const { LocalAgentRuntimeProvider } = await import(${JSON.stringify(providerModuleUrl)});
        const runtimeInputs = [];
        const fakeRuntime = {
          detect: async () => [],
          listProviders: () => [{ id: "codex" }],
          cancel: async () => undefined,
          async *run(input) {
            runtimeInputs.push(input);
            yield { type: "text_delta", text: "ok" };
            yield { type: "done", status: "completed", sessionId: "provider-session-1" };
          },
        };

        async function runCase(suffix, managed) {
          const provider = new LocalAgentRuntimeProvider();
          provider.localAgentRuntime = fakeRuntime;
          const context = createContext(suffix, managed);
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

        const managed = await runCase("managed", true);
        const managedWorkspace = resolve(join(
          ${JSON.stringify(home)},
          "rooms",
          managed.context.conversation.roomId,
          "agents",
          managed.context.participant.id,
        ));
        const managedCwd = resolve(managed.context.managedAgentRunContext.cwd);
        assert.match(managedCwd, /\\.agent-runs\\//);
        assert.equal(managed.input.cwd, managedCwd);
        assert.equal(managed.input.managedAgentInvocation.cwd, managedCwd);
        assert.deepEqual(managed.input.extraAllowedDirs, [managedCwd, managedWorkspace]);
        assert.equal("GROUP_CHAT_WORKSPACE" in managed.input.env, false);

        const cliCalls = (await readFile(${JSON.stringify(cliLog)}, "utf8"))
          .trim()
          .split("\\n")
          .map((line) => JSON.parse(line));
        const skillCalls = cliCalls.filter((call) => !call.args.includes("list"));
        const detectCalls = cliCalls.filter((call) => call.args.includes("list"));
        assert.equal(detectCalls.length, 4, JSON.stringify(cliCalls));
        for (const call of detectCalls.slice(0, 2)) {
          assert.equal(await realpath(call.cwd), await realpath(standalone.input.cwd));
        }
        for (const call of detectCalls.slice(2)) {
          assert.equal(await realpath(call.cwd), await realpath(managed.input.cwd));
        }
        assert.ok(skillCalls.length >= 2, JSON.stringify(cliCalls));
        assert.equal(await realpath(skillCalls.at(-2).cwd), await realpath(standalone.input.cwd));
        assert.equal(await realpath(skillCalls.at(-1).cwd), await realpath(managed.input.cwd));

        const compactContext = {
          ...managed.context,
          runId: undefined,
          managedAgentRunContext: undefined,
          agentDetectContext: undefined,
        };
        await managed.provider.compactContext(compactContext);
        const compactInput = runtimeInputs.at(-1);
        const compactCwd = resolve(compactContext.managedAgentRunContext.cwd);
        assert.equal(compactInput.prompt, "/compact");
        assert.equal(compactInput.cwd, compactCwd);
        assert.equal(compactInput.managedAgentInvocation.cwd, compactCwd);
        assert.deepEqual(compactInput.extraAllowedDirs, [compactCwd, managedWorkspace]);
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
