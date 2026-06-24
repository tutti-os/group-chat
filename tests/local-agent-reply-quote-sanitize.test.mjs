import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadModule() {
  const output = "/tmp/local-agent-reply-quote-sanitize.test.mjs";
  const build = spawnSync(
    "pnpm",
    [
      "--filter", "@group-chat/server", "exec", "esbuild",
      "src/runtimes/local-agent-protocol.ts",
      "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("local agent input strips generated reply quote markers", async () => {
  const { stripGeneratedReplyQuoteMarkers } = await loadModule();

  assert.equal(
    stripGeneratedReplyQuoteMarkers("> 回复 老板: 颠三倒四\n\n11"),
    "回复 老板: 颠三倒四\n\n11",
  );
  assert.equal(
    stripGeneratedReplyQuoteMarkers("> Reply Alice: status\n> Reply Bob: next step\n\nDone"),
    "Reply Alice: status\nReply Bob: next step\n\nDone",
  );
  assert.equal(
    stripGeneratedReplyQuoteMarkers("> plain markdown quote\n\nbody"),
    "> plain markdown quote\n\nbody",
  );
});
