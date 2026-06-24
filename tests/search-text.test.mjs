import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadSearchTextModule() {
  const output = "/tmp/search-text.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", "src/app/search-text.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("search text matching ignores whitespace in recorded content", async () => {
  const { normalizeSearchQuery, searchTextIncludes } = await loadSearchTextModule();
  const query = normalizeSearchQuery("你好");

  assert.equal(searchTextIncludes("你 好 这个会话讲的什么", query), true);
});

test("search text matching ignores whitespace in query", async () => {
  const { normalizeSearchQuery, searchTextIncludes } = await loadSearchTextModule();
  const query = normalizeSearchQuery("你 好");

  assert.equal(searchTextIncludes("你好这个会话讲的什么", query), true);
});

test("search text match ranges include skipped whitespace for highlighting", async () => {
  const { findSearchTextMatches, normalizeSearchQuery } = await loadSearchTextModule();

  assert.deepEqual(
    findSearchTextMatches("老板说：你 好呀", normalizeSearchQuery("你好")),
    [{ start: 4, end: 7 }],
  );
});
