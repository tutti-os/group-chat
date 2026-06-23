import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadSharedModule() {
  const output = "/tmp/assistant-skill-details.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/shared", "exec", "esbuild", "src/index.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("assistant skill details strip base directory and skill document body", async () => {
  const { stripAssistantSkillDetails } = await loadSharedModule();
  const content = `好的，我来调用 baoyu-comic skill 生成阿袁漫画。 Base directory for this skill:
/Users/Sun/.claude/skills/baoyu-comic

# Knowledge Comic Creator

Create original knowledge comics with flexible art style x tone combinations.

## User Input Tools

When this skill prompts the user, follow this tool-selection rule.`;

  assert.equal(stripAssistantSkillDetails(content), "好的，我来调用 baoyu-comic skill 生成阿袁漫画。");
});

test("assistant skill details strip leaked skill markdown without base directory", async () => {
  const { stripAssistantSkillDetails } = await loadSharedModule();
  const content = `I will call the baoyu-comic skill.

# Knowledge Comic Creator

Create original knowledge comics with flexible art style x tone combinations.

## User Input Tools

When this skill prompts the user, follow this tool-selection rule.`;

  assert.equal(stripAssistantSkillDetails(content), "I will call the baoyu-comic skill.");
});

test("assistant skill details keep normal assistant content", async () => {
  const { stripAssistantSkillDetails } = await loadSharedModule();
  const content = "已完成漫画生成，文件在 [result.png](group-chat://reference/file/artifact-1)。";

  assert.equal(stripAssistantSkillDetails(content), content);
});
