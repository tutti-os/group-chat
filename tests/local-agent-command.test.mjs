import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function loadModule() {
  const output = path.join(mkdtempSync(path.join(tmpdir(), "local-agent-command-")), "module.mjs");
  const build = spawnSync(
    process.execPath,
    [
      require.resolve("esbuild/bin/esbuild"),
      "apps/server/src/runtimes/local-agent-command.ts",
      "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER_THREADS: "0" } },
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

  assert.deepEqual(resolveLocalAgentCommand("claude-code", env), {
    command: "legacy-claude",
    args: [],
  });
});

test("provider-specific command takes precedence over legacy and global overrides", async () => {
  const { resolveLocalAgentCommand } = await loadModule();
  const env = {
    GROUP_CHAT_LOCAL_AGENT_CLAUDE_CODE_COMMAND: "specific",
    GROUP_CHAT_LOCAL_AGENT_CLAUDE_COMMAND: "legacy-claude",
    GROUP_CHAT_LOCAL_AGENT_COMMAND: "global",
  };

  assert.deepEqual(resolveLocalAgentCommand("claude-code", env), {
    command: "specific",
    args: [],
  });
  assert.deepEqual(resolveLocalAgentCommand("cursor", env), {
    command: "global",
    args: [],
  });
});

test("JSON argv preserves paths with spaces without a shell", async () => {
  const { resolveLocalAgentCommand } = await loadModule();
  const command = String.raw`C:\Program Files\Group Chat\agent.exe`;
  assert.deepEqual(
    resolveLocalAgentCommand("codex", {
      GROUP_CHAT_LOCAL_AGENT_CODEX_COMMAND: JSON.stringify([command, "--mode", "json"]),
    }),
    { command, args: ["--mode", "json"] },
  );
});
