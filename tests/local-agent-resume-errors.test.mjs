import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadModule() {
  const output = "/tmp/local-agent-resume-errors.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/server", "exec", "esbuild", "src/runtimes/local-agent-resume-errors.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("codex context window failures can recover by dropping provider resume state", async () => {
  const { isRecoverableResumeError } = await loadModule();

  assert.equal(
    isRecoverableResumeError("Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying."),
    true,
  );
  assert.equal(
    isRecoverableResumeError("Error running remote compact task: Codex ran out of room in the model's context window."),
    true,
  );
});

test("non-resume local agent failures are not treated as fresh-retryable", async () => {
  const { isRecoverableResumeError } = await loadModule();

  assert.equal(isRecoverableResumeError("local-agent codex failed with exit code 1"), false);
});
