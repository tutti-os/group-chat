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

test("role descriptions are custom-only", async () => {
  const { getIdentityRoleLabel, matchRolePresetId, normalizeRoleDescriptionForEditor } = await loadModule();
  const legacyPreset = "You are a senior product manager agent.\\n\\nYour job is to turn ambiguous ideas into clear product direction.";

  assert.equal(matchRolePresetId(""), "custom");
  assert.equal(matchRolePresetId("Use this agent for highly specific room behavior."), "custom");
  assert.equal(getIdentityRoleLabel({ systemPrompt: "", stylePrompt: "" }), null);
  assert.equal(normalizeRoleDescriptionForEditor({ systemPrompt: legacyPreset, stylePrompt: "" }), "");
  assert.equal(getIdentityRoleLabel({ systemPrompt: legacyPreset, stylePrompt: "" }), null);
  assert.equal(getIdentityRoleLabel({ systemPrompt: "Use this agent for highly specific room behavior.", stylePrompt: "" }), "rolePreset.custom");
});
