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

test("run file artifact path extraction reads relative assistant file paths", async () => {
  const { extractLocalFilePathsFromContent } = await loadRunFileArtifactsModule();
  const content = "已创建 Markdown 文件。\n\n文件路径：[boss111_20260623_235016.md](boss111_20260623_235016.md)";

  assert.deepEqual(extractLocalFilePathsFromContent(content), ["boss111_20260623_235016.md"]);
});

test("run file artifact links replace relative markdown file links", async () => {
  const { linkRunFileArtifactPathsInContent } = await loadRunFileArtifactsModule();
  const content = "文件路径：[boss111_20260623_235016.md](boss111_20260623_235016.md)";

  assert.equal(
    linkRunFileArtifactPathsInContent(content, [{
      path: "boss111_20260623_235016.md",
      artifact: { id: "artifact-1", filename: "boss111_20260623_235016.md" },
    }]),
    "文件路径：[boss111_20260623_235016.md](group-chat://reference/file/artifact-1)",
  );
});

test("run file artifact links replace markdown links to local files", async () => {
  const { linkRunFileArtifactPathsInContent } = await loadRunFileArtifactsModule();
  const localPath = "/Users/example/workspace/requested_1111.md";
  const content = `[already linked](${localPath})\n\n${localPath}`;

  assert.equal(
    linkRunFileArtifactPathsInContent(content, [{
      path: localPath,
      artifact: { id: "artifact-1", filename: "requested_1111.md" },
    }]),
    "[requested_1111.md](group-chat://reference/file/artifact-1)\n\n[requested_1111.md](group-chat://reference/file/artifact-1)",
  );
});

test("run file artifact mime inference treats markdown as text", async () => {
  const { inferMimeTypeForPath } = await loadRunFileArtifactsModule();
  assert.equal(inferMimeTypeForPath("/tmp/requested_1111.md"), "text/markdown");
  assert.equal(inferMimeTypeForPath("/tmp/pixel.png"), "image/png");
});

test("run file artifact import skips internal agent workspace files", async () => {
  const { shouldImportRunFileArtifactPath } = await loadRunFileArtifactsModule();
  const workspaceRoot = "/Users/example/.tutti-dev/apps/installations/group-chat/install/data/rooms/room/agents/agent";

  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/IDENTITY.md`, workspaceRoot), false);
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/MEMORY.md`, workspaceRoot), false);
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/source.md`, workspaceRoot), false);
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/memory/users/local-user.md`, workspaceRoot), false);
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/Memory/users/local-user.md`, workspaceRoot), false);
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/skills/some-skill/SKILL.md`, workspaceRoot), false);
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/requested_1111.md`, workspaceRoot), true);
  assert.equal(shouldImportRunFileArtifactPath("/Users/example/workspace/requested_1111.md", workspaceRoot), true);
});

test("run file artifact import only skips the auto-generated conversation log for the active conversation", async () => {
  const { shouldImportRunFileArtifactPath } = await loadRunFileArtifactsModule();
  const workspaceRoot = "/Users/example/.tutti-dev/apps/installations/group-chat/install/data/rooms/room/agents/agent";

  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/conversations/room-1.md`, workspaceRoot, "room-1"), false);
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/conversations/room-1.summary.md`, workspaceRoot, "room-1"), false);
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/conversations/room-1.summary.md`, workspaceRoot, "room-2"), true);
  // A deliverable the agent itself chose to save under "conversations/" should still surface as a file card.
  assert.equal(shouldImportRunFileArtifactPath(`${workspaceRoot}/conversations/coca-cola-prd.md`, workspaceRoot, "room-1"), true);
});
