import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("hover time stays outside the message body when a card anchor is indented", async () => {
  const output = "/tmp/message-hover-layout.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", "src/app/message-hover-layout.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  const { resolveMessageHoverTimePosition } = await import(`${pathToFileURL(output)}?t=${Date.now()}`);

  assert.deepEqual(
    resolveMessageHoverTimePosition({ top: 10, left: 28, width: 300, height: 80 }),
    { top: 50, left: -6 },
  );
});
