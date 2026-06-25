import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTuttiBridgeModule() {
  const build = spawnSync(
    "pnpm",
    ["--filter", "@group-chat/web", "exec", "esbuild", "src/app/tutti-bridge.ts", "--bundle", "--platform=browser", "--format=esm", "--outfile=/tmp/tutti-bridge.test.mjs"],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL("/tmp/tutti-bridge.test.mjs")}?t=${Date.now()}`);
}

test("resolveArtifactAgentDraftHref prefers tutti workspace app data absolute paths", async () => {
  const { resolveArtifactAgentDraftHref } = await loadTuttiBridgeModule();
  const localPath = "/Users/test/.tutti-dev/apps/workspaces/workspace-1/group-chat/data/rooms/room-1/uploads/image6.png";
  const href = resolveArtifactAgentDraftHref({
    id: "art-1",
    localPath,
  });
  assert.equal(href, localPath);
});

test("resolveArtifactAgentDraftHref does not downgrade workspace app files to relative paths", async () => {
  const { resolveArtifactAgentDraftHref } = await loadTuttiBridgeModule();
  const href = resolveArtifactAgentDraftHref(
    {
      id: "art-1",
      localPath: "/Users/test/.tutti-dev/apps/workspaces/workspace-1/group-chat/data/rooms/room-1/uploads/image6.png",
    },
    "rooms/room-1/uploads/image6.png",
  );
  assert.match(href, /\/group-chat\/data\/rooms\/room-1\/uploads\/image6\.png$/);
  assert.doesNotMatch(href, /^rooms\//);
});

test("resolveReferenceMentionScope accepts legacy flat mention insert scopes", async () => {
  const { resolveReferenceMentionScope } = await loadTuttiBridgeModule();

  assert.deepEqual(
    resolveReferenceMentionScope(
      {
        kind: "mention",
        scope: { workspaceId: "legacy-ws" },
      },
      { workspaceId: "fallback-ws" },
    ),
    { workspaceId: "legacy-ws" },
  );
});
