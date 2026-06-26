import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDispatchModule() {
  const build = spawnSync(
    "pnpm",
    ["--filter", "@group-chat/web", "exec", "esbuild", "src/app/agent-gui-dispatch.ts", "--bundle", "--platform=browser", "--format=esm", "--outfile=/tmp/agent-gui-dispatch.test.mjs"],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL("/tmp/agent-gui-dispatch.test.mjs")}?t=${Date.now()}`);
}

test("resolveAgentGuiDispatchFromMentions keeps workspace-app references in prompt", async () => {
  const { resolveAgentGuiDispatchFromMentions } = await loadDispatchModule();
  const codexHref = "mention://workspace-app/agent-codex?workspaceId=ws-1";
  const radarHref = "mention://workspace-app/daily-product-radar?workspaceId=ws-1";
  const content = `[Codex](${codexHref}) 帮我看看 [每日产品雷达](${radarHref}) 里面说了什么`;
  const mentions = [
    {
      mentionType: "reference",
      referenceProviderId: "workspace-app",
      referenceEntityId: "agent-codex",
      displayNameSnapshot: "Codex",
    },
    {
      mentionType: "reference",
      referenceProviderId: "workspace-app",
      referenceEntityId: "daily-product-radar",
      displayNameSnapshot: "每日产品雷达",
    },
  ];

  const dispatch = resolveAgentGuiDispatchFromMentions(content, mentions, { workspaceId: "ws-1" });
  assert.ok(dispatch);
  assert.equal(dispatch.provider, "codex");
  assert.match(dispatch.prompt, /帮我看看/);
  assert.match(dispatch.prompt, /里面说了什么/);
  assert.doesNotMatch(dispatch.prompt, /\[Codex\]\(mention:\/\/workspace-app\/agent-codex/);
  assert.match(dispatch.prompt, /\[每日产品雷达\]\(mention:\/\/workspace-app\/daily-product-radar/);
});

test("resolveAgentGuiDispatchFromMentions upgrades bare message links for agent gui", async () => {
  const { resolveAgentGuiDispatchFromMentions } = await loadDispatchModule();
  const content = "[Codex](mention://workspace-app/agent-codex?workspaceId=ws-1) 你看看 group-chat://message/msg-1 这些东西";
  const mentions = [
    {
      mentionType: "reference",
      referenceProviderId: "workspace-app",
      referenceEntityId: "agent-codex",
      displayNameSnapshot: "Codex",
    },
  ];

  const dispatch = resolveAgentGuiDispatchFromMentions(content, mentions, { workspaceId: "ws-1" });
  assert.ok(dispatch);
  assert.doesNotMatch(dispatch.prompt, /agent-codex/);
  assert.doesNotMatch(dispatch.prompt, /(?<!\])group-chat:\/\/message\/msg-1/);
  assert.match(dispatch.prompt, /mention:\/\/workspace-app\/group-chat\?[^)]*messageId=msg-1/);
});

test("resolveAgentGuiDispatchFromMentions upgrades summary links for agent gui", async () => {
  const { resolveAgentGuiDispatchFromMentions } = await loadDispatchModule();
  const content = "[Codex](mention://workspace-app/agent-codex?workspaceId=ws-1) group-chat://summary/task-1";
  const mentions = [{
    mentionType: "reference",
    referenceProviderId: "workspace-app",
    referenceEntityId: "agent-codex",
    displayNameSnapshot: "Codex",
  }];

  const dispatch = resolveAgentGuiDispatchFromMentions(content, mentions, { workspaceId: "ws-1" });
  assert.ok(dispatch);
  assert.match(dispatch.prompt, /mention:\/\/workspace-app\/group-chat\?[^)]*summaryTaskId=task-1/);
});

test("resolveAgentGuiDispatchFromMentions ignores room custom agent participant mentions", async () => {
  const { resolveAgentGuiDispatchFromMentions } = await loadDispatchModule();
  const content = "[@徐勇](group-chat://participant/participant-1) 帮我整理一下";
  const mentions = [
    {
      mentionType: "participant",
      participantId: "participant-1",
      displayNameSnapshot: "徐勇",
    },
  ];

  const dispatch = resolveAgentGuiDispatchFromMentions(content, mentions);
  assert.equal(dispatch, null);
});

test("resolveAgentGuiDispatchFromMentions ignores composer local Tutti agent mentions", async () => {
  const { resolveAgentGuiDispatchFromMentions } = await loadDispatchModule();
  const content = "[Codex CLI](mention://workspace-app/agent-codex?workspaceId=ws-1) 今天星期几";
  const mentions = [
    {
      mentionType: "reference",
      participantId: "tutti-at:workspace-app:agent-codex",
      referenceProviderId: "workspace-app",
      referenceEntityId: "agent-codex",
      displayNameSnapshot: "Codex CLI",
      referenceScope: {
        workspaceId: "ws-1",
        groupChatLocalAgentMention: "true",
        groupChatRuntimeProvider: "codex",
        groupChatRuntimeProfileId: "local-agent:codex",
      },
      referenceInsert: {
        kind: "mention",
        mention: {
          entityId: "agent-codex",
          label: "Codex CLI",
          scope: {
            workspaceId: "ws-1",
            groupChatLocalAgentMention: "true",
            groupChatRuntimeProvider: "codex",
            groupChatRuntimeProfileId: "local-agent:codex",
          },
        },
      },
    },
  ];

  const dispatch = resolveAgentGuiDispatchFromMentions(content, mentions, { workspaceId: "ws-1" });
  assert.equal(dispatch, null);
});
