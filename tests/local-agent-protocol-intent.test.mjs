import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule() {
  const output = "/tmp/local-agent-protocol-intent.test.mjs";
  const build = spawnSync(
    "pnpm",
    [
      "--filter", "@group-chat/server", "exec", "esbuild",
      "src/runtimes/local-agent-protocol.ts",
      "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

const legacyLauncher = {
  mentionType: "reference",
  participantId: "agent-codex",
  referenceProviderId: "workspace-app",
  referenceEntityId: "agent-codex",
  displayNameSnapshot: "Codex",
};
const validApp = {
  mentionType: "reference",
  participantId: "vibe-design",
  referenceProviderId: "workspace-app",
  referenceEntityId: "vibe-design",
  displayNameSnapshot: "Vibe Design",
  referenceScope: { workspaceId: "workspace-1" },
};

test("mixed retired launcher and valid app mentions dispatch only the valid app", async () => {
  const { isWorkspaceAppOnlyTaskMessage, resolveWorkspaceAppIntent } = await loadModule();
  const context = {
    participant: { id: "agent-1", displayName: "Agent" },
    userMessage: {
      content: "Codex Vibe Design build a site",
      mentions: [legacyLauncher, validApp],
    },
  };

  assert.equal(isWorkspaceAppOnlyTaskMessage(context), true);
  const intent = resolveWorkspaceAppIntent(context);
  assert.deepEqual(intent.workspaceApps.map((app) => app.appId), ["vibe-design"]);
  assert.equal(intent.requestText, "build a site");
  assert.doesNotMatch(intent.instruction, /agent-codex|Codex/);
});

test("mixed app labels without request text do not trigger app-only dispatch", async () => {
  const { isWorkspaceAppOnlyTaskMessage } = await loadModule();
  const context = {
    userMessage: {
      content: "Codex Vibe Design",
      mentions: [legacyLauncher, validApp],
    },
  };

  assert.equal(isWorkspaceAppOnlyTaskMessage(context), false);
});
