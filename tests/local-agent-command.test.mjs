import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule() {
  const output = "/tmp/local-agent-command.test.mjs";
  const build = spawnSync(
    "pnpm",
    [
      "--filter", "@group-chat/server", "exec", "esbuild",
      "src/runtimes/local-agent-command.ts",
      "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("Claude Code command resolution keeps the legacy Claude override", async () => {
  const { resolveLocalAgentCommand } = await loadModule();
  const env = {
    GROUP_CHAT_LOCAL_AGENT_CLAUDE_COMMAND: "legacy-claude",
    GROUP_CHAT_LOCAL_AGENT_COMMAND: "global",
  };

  assert.equal(resolveLocalAgentCommand("claude-code", env), "legacy-claude");
});

test("provider-specific command takes precedence over legacy and global overrides", async () => {
  const { resolveLocalAgentCommand } = await loadModule();
  const env = {
    GROUP_CHAT_LOCAL_AGENT_CLAUDE_CODE_COMMAND: "specific",
    GROUP_CHAT_LOCAL_AGENT_CLAUDE_COMMAND: "legacy-claude",
    GROUP_CHAT_LOCAL_AGENT_COMMAND: "global",
  };

  assert.equal(resolveLocalAgentCommand("claude-code", env), "specific");
  assert.equal(resolveLocalAgentCommand("cursor", env), "global");
});
