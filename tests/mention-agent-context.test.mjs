import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadSharedModule() {
  const output = "/tmp/group-chat-shared-mention-agent-context.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/shared", "exec", "esbuild", "src/index.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

async function loadAcpModule() {
  const output = "/tmp/group-chat-local-agent-acp.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/server", "exec", "esbuild", "src/runtimes/local-agent-acp.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

function referenceMention(overrides = {}) {
  return {
    participantId: "tutti-at:workspace-app:automation",
    displayNameSnapshot: "Automation",
    mentionType: "reference",
    referenceProviderId: "workspace-app",
    referenceEntityId: "automation",
    referenceScope: {
      workspaceId: "ws-1",
      topicId: "topic-1",
      iconUrl: "data:image/png;base64,presentation",
      thumbnailUrl: "https://example.test/thumb.png",
      large: "x".repeat(2049),
    },
    referenceInsert: {
      kind: "mention",
      mention: {
        entityId: "automation",
        label: "Automation",
        scope: {
          workspaceId: "ws-1",
          iconUrl: "data:image/png;base64,presentation",
        },
        presentation: {
          iconUrl: "data:image/png;base64,presentation",
        },
      },
    },
    ...overrides,
  };
}

test("mention target agent context drops presentation-only scope fields", async () => {
  const { sanitizeMentionTargetForAgentContext } = await loadSharedModule();

  assert.deepEqual(sanitizeMentionTargetForAgentContext(referenceMention()), {
    participantId: "tutti-at:workspace-app:automation",
    displayNameSnapshot: "Automation",
    mentionType: "reference",
    referenceProviderId: "workspace-app",
    referenceEntityId: "automation",
    referenceScope: {
      topicId: "topic-1",
      workspaceId: "ws-1",
    },
    referenceInsert: {
      kind: "mention",
      mention: {
        entityId: "automation",
        label: "Automation",
        scope: {
          workspaceId: "ws-1",
        },
      },
    },
  });
});

test("mention target agent context drops non-mention inserts", async () => {
  const { sanitizeMentionTargetForAgentContext } = await loadSharedModule();

  assert.deepEqual(
    sanitizeMentionTargetForAgentContext(
      referenceMention({
        referenceInsert: {
          kind: "markdown-link",
          href: "data:text/plain;base64,bad",
          text: "Automation",
        },
      }),
    ),
    {
      participantId: "tutti-at:workspace-app:automation",
      displayNameSnapshot: "Automation",
      mentionType: "reference",
      referenceProviderId: "workspace-app",
      referenceEntityId: "automation",
      referenceScope: {
        topicId: "topic-1",
        workspaceId: "ws-1",
      },
    },
  );
});

test("local agent prompt serializes sanitized mention context", async () => {
  const { acpPromptFromLocalAgentInput } = await loadAcpModule();
  const hugeIcon = `data:image/png;base64,${"a".repeat(500_000)}`;
  const prompt = acpPromptFromLocalAgentInput({
    protocolVersion: "1",
    workspaceRoot: "/tmp/workspace",
    conversation: { id: "conversation-1", type: "group", title: "Room" },
    participant: { id: "codex", displayName: "Codex" },
    turn: {
      userMessage: {
        id: "message-1",
        senderName: "Ryan",
        content: "Use Automation",
        mentions: [
          referenceMention({
            referenceScope: {
              workspaceId: "ws-1",
              iconUrl: hugeIcon,
            },
            referenceInsert: {
              kind: "mention",
              mention: {
                entityId: "automation",
                label: "Automation",
                scope: {
                  workspaceId: "ws-1",
                  iconUrl: hugeIcon,
                },
                presentation: {
                  iconUrl: hugeIcon,
                },
              },
            },
          }),
        ],
      },
      attachments: [],
    },
    tools: {
      contextUrl: "http://127.0.0.1/context",
      sendMessageUrl: "http://127.0.0.1/send",
      saveArtifactUrl: "http://127.0.0.1/artifact",
    },
  });

  assert.equal(prompt.includes(hugeIcon), false);
  assert.equal(prompt.includes("data:image/png;base64"), false);
  assert.match(prompt, /"workspaceId":"ws-1"/);
  assert.ok(prompt.length < 10_000, `prompt length ${prompt.length}`);
});

test("assistant parsed mention links sanitize scope before storage", async () => {
  const { resolveTriggerUserMentions } = await loadSharedModule();

  const mentions = resolveTriggerUserMentions(
    {
      conversationId: "conversation-1",
      createdAt: "2026-06-24T00:01:00.000Z",
      role: "assistant",
    },
    [
      {
        conversationId: "conversation-1",
        createdAt: "2026-06-24T00:00:00.000Z",
        role: "user",
        status: "success",
        content:
          "[Automation](mention://workspace-app/automation?workspaceId=ws-1&iconUrl=DATA%3Aimage%2Fpng%3Bbase64%2Cbad&meta.source=ui)",
        mentions: [],
      },
    ],
  );

  assert.deepEqual(mentions, [
    {
      participantId: "automation",
      displayNameSnapshot: "Automation",
      mentionType: "reference",
      referenceProviderId: "workspace-app",
      referenceEntityId: "automation",
      referenceScope: {
        workspaceId: "ws-1",
      },
      referenceInsert: {
        kind: "mention",
        mention: {
          entityId: "automation",
          label: "Automation",
          scope: {
            workspaceId: "ws-1",
          },
        },
      },
    },
  ]);
});
