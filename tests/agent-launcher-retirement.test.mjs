import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule() {
  const output = "/tmp/agent-launcher-retirement.test.mjs";
  const build = spawnSync(
    "pnpm",
    [
      "--filter", "@group-chat/web", "exec", "esbuild",
      "src/app/agent-launcher-mentions.ts",
      "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER_THREADS: "0" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("retired provider launcher ids stay classified as legacy references", async () => {
  const { isAgentLauncherAppId } = await loadModule();

  assert.equal(isAgentLauncherAppId("workspace-app", "agent-codex"), true);
  assert.equal(isAgentLauncherAppId("workspace-app", "agent-claude-code"), true);
  assert.equal(isAgentLauncherAppId("workspace-app", "agent-cursor"), false);
  assert.equal(isAgentLauncherAppId("workspace-issue", "agent-codex"), false);
});

test("composer no longer queries provider launcher availability", () => {
  const source = readFileSync(path.join(rootDir, "apps/web/src/app/components/chat/Composer.tsx"), "utf8");

  assert.doesNotMatch(source, /agent-launcher-availability|fetchAgentLauncherAvailability/);
});

test("retired provider forwarding handlers and UI are removed", () => {
  const appSource = readFileSync(path.join(rootDir, "apps/web/src/app/App.tsx"), "utf8");
  const timelineSource = readFileSync(path.join(rootDir, "apps/web/src/app/components/chat/MessageTimeline.tsx"), "utf8");

  assert.doesNotMatch(appSource, /agentForwardTargets|forwardMessagesToAgent|forwardSummaryToAgent/);
  assert.doesNotMatch(timelineSource, /AgentForwardTarget|ForwardToAgent|onForwardToAgent/);
});
