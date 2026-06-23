import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadRunFileArtifactsModule() {
  const output = "/tmp/run-file-artifacts.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/server", "exec", "esbuild", "src/domains/run-file-artifacts.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("run file artifact links replace raw local paths with file reference markdown", async () => {
  const { linkRunFileArtifactPathsInContent } = await loadRunFileArtifactsModule();
  const localPath = "/Users/example/workspace/requested_1111.md";
  const content = `已创建文件。\n\n文件路径：\`${localPath}\``;

  assert.equal(
    linkRunFileArtifactPathsInContent(content, [{
      path: localPath,
      artifact: { id: "artifact-1", filename: "requested_1111.md" },
    }]),
    "已创建文件。\n\n文件路径：[requested_1111.md](group-chat://reference/file/artifact-1)",
  );
});

test("run file artifact path extraction reads backticked assistant file paths", async () => {
  const { extractLocalFilePathsFromContent } = await loadRunFileArtifactsModule();
  const localPath = "/Users/example/.tutti-dev/apps/installations/group-chat/install/data/rooms/room/agents/agent/boss_1111.md";
  const content = `已新建 Markdown 文档。\n\n文件路径：\`${localPath}\``;

  assert.deepEqual(extractLocalFilePathsFromContent(content), [localPath]);
});

test("run file artifact links preserve existing markdown link hrefs", async () => {
  const { linkRunFileArtifactPathsInContent } = await loadRunFileArtifactsModule();
  const localPath = "/Users/example/workspace/requested_1111.md";
  const content = `[already linked](${localPath})\n\n${localPath}`;

  assert.equal(
    linkRunFileArtifactPathsInContent(content, [{
      path: localPath,
      artifact: { id: "artifact-1", filename: "requested_1111.md" },
    }]),
    "[already linked](/Users/example/workspace/requested_1111.md)\n\n[requested_1111.md](group-chat://reference/file/artifact-1)",
  );
});

test("run file artifact mime inference treats markdown as text", async () => {
  const { inferMimeTypeForPath } = await loadRunFileArtifactsModule();
  assert.equal(inferMimeTypeForPath("/tmp/requested_1111.md"), "text/markdown");
  assert.equal(inferMimeTypeForPath("/tmp/pixel.png"), "image/png");
});
