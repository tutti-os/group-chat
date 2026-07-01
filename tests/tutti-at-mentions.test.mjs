import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadModule() {
  const output = "/tmp/tutti-at-mentions.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", "src/app/tutti-at-mentions.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("keeps workspace app icon urls usable for mention chips", async () => {
  const { resolveMentionThumbnailUrl } = await loadModule();

  assert.equal(
    resolveMentionThumbnailUrl("tutti://workspace-apps/vibe-design/icon.png"),
    "tutti://workspace-apps/vibe-design/icon.png",
  );
});
