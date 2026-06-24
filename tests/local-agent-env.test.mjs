import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadModule() {
  const output = "/tmp/local-agent-env.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/server", "exec", "esbuild", "src/runtimes/local-agent-env.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("local agent env does not inherit Codex Desktop thread state", async () => {
  const { buildLocalAgentProcessEnv } = await loadModule();

  assert.deepEqual(
    buildLocalAgentProcessEnv({
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
      CODEX_SHELL: "1",
      CODEX_THREAD_ID: "019ef408-0b02-7e62-859f-4161c99bfd34",
      HOME: "/Users/example",
    }),
    {
      HOME: "/Users/example",
    },
  );
});

test("local agent env strips Codex Desktop thread state from overrides", async () => {
  const { buildLocalAgentProcessEnv } = await loadModule();

  assert.deepEqual(
    buildLocalAgentProcessEnv(
      {
        HOME: "/Users/example",
      },
      {
        CODEX_THREAD_ID: "019ef408-0b02-7e62-859f-4161c99bfd34",
        PATH: "/usr/bin",
      },
    ),
    {
      HOME: "/Users/example",
      PATH: "/usr/bin",
    },
  );
});
