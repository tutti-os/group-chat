import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

async function loadFormatter() {
  const output = "/tmp/agent-forward-format.test.mjs";
  await execFileAsync("pnpm", ["--filter", "@group-chat/web", "exec", "esbuild", "src/app/agent-forward-format.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("single sender is omitted and consecutive messages share one line", async () => {
  const { groupAgentForwardSections } = await loadFormatter();
  assert.equal(groupAgentForwardSections([
    { senderKey: "a", senderLabel: "Alice", content: "第一段" },
    { senderKey: "a", senderLabel: "Alice", content: "第二段。" },
  ]), "第一段。第二段。");
});

test("multiple senders are labeled and only consecutive messages are grouped", async () => {
  const { groupAgentForwardSections } = await loadFormatter();
  assert.equal(groupAgentForwardSections([
    { senderKey: "a", senderLabel: "Alice", content: "一" },
    { senderKey: "a", senderLabel: "Alice", content: "二" },
    { senderKey: "b", senderLabel: "Bob", content: "三" },
    { senderKey: "a", senderLabel: "Alice", content: "四" },
  ]), "Alice: 一。二\nBob: 三\nAlice: 四");
});
