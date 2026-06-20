import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadModule() {
  const output = "/tmp/composer-paste-content.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", "src/app/composer-paste-content.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("removes leaked group-chat protocol tokens from pasted text", async () => {
  const { sanitizeComposerPasteText } = await loadModule();
  assert.equal(sanitizeComposerPasteText("group-chat://\n消息总结"), "消息总结");
  assert.equal(sanitizeComposerPasteText("前文 group-chat://unknown/value 后文"), "前文  后文");
});

test("retains internal links that become meaningful composer elements", async () => {
  const { sanitizeComposerPasteText } = await loadModule();
  assert.equal(
    sanitizeComposerPasteText("查看 group-chat://message/message-1 和 group-chat://summary/task-1"),
    "查看 group-chat://message/message-1 和 group-chat://summary/task-1",
  );
  assert.equal(
    sanitizeComposerPasteText("[@产品](group-chat://participant/participant-1) 处理 [文件](group-chat://reference/file/artifact-1)"),
    "[@产品](group-chat://participant/participant-1) 处理 [文件](group-chat://reference/file/artifact-1)",
  );
});
