import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadModule() {
  const output = "/tmp/identity-role.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", "src/app/identity-role.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("unmatched role descriptions keep the custom preset selected", async () => {
  const { matchRolePresetId } = await loadModule();

  assert.equal(matchRolePresetId(""), "custom");
  assert.equal(matchRolePresetId("Use this agent for highly specific room behavior."), "custom");
});
