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

test("retains raw and structured internal message links", async () => {
  const { sanitizeComposerPasteText } = await loadModule();
  assert.equal(
    sanitizeComposerPasteText("查看 group-chat://message/message-1 和 group-chat://summary/task-1"),
    "查看 group-chat://message/message-1 和 group-chat://summary/task-1",
  );
  assert.equal(
    sanitizeComposerPasteText("[@产品](group-chat://participant/participant-1) 处理 [文件](group-chat://reference/file/artifact-1)"),
    "[@产品](group-chat://participant/participant-1) 处理 [文件](group-chat://reference/file/artifact-1)",
  );
  assert.equal(
    sanitizeComposerPasteText("[消息](group-chat://message/message-1) 和 [总结](group-chat://summary/task-1)"),
    "[消息](group-chat://message/message-1) 和 [总结](group-chat://summary/task-1)",
  );
});

test("both raw and structured internal links become composer message elements", async () => {
  const { splitComposerPasteContent } = await loadModule();
  const context = {
    participants: [],
    runtimeProfiles: [],
    localAgentProviders: [],
    identities: [],
  };

  assert.deepEqual(
    splitComposerPasteContent("查看 group-chat://message/message-1", context),
    [
      { kind: "text", text: "查看 " },
      { kind: "message", id: "message-1" },
    ],
  );
  assert.deepEqual(
    splitComposerPasteContent("[消息](group-chat://message/message-1) 和 [总结](group-chat://summary/task-1)", context),
    [
      { kind: "message", id: "message-1" },
      { kind: "text", text: " 和 " },
      { kind: "summary", id: "task-1" },
    ],
  );
});

test("merges structured HTML paste with missing plain text suffix", async () => {
  const { mergeHtmlPasteWithPlainText } = await loadModule();

  assert.equal(
    mergeHtmlPasteWithPlainText(
      "[Vibe Design @产品](mention://workspace-app/vibe-design?workspaceId=workspace-1)",
      "Vibe Design @产品 你去做一个音乐网站",
    ),
    "[Vibe Design @产品](mention://workspace-app/vibe-design?workspaceId=workspace-1) 你去做一个音乐网站",
  );
});

test("keeps unresolved at signs in plain pasted text", async () => {
  const { splitComposerPasteContent } = await loadModule();

  assert.deepEqual(
    splitComposerPasteContent("发给 @未知 继续", {
      participants: [],
      runtimeProfiles: [],
      localAgentProviders: [],
      identities: [],
    }),
    [{ kind: "text", text: "发给 @未知 继续" }],
  );
});

test("restores workspace app icon scope from pasted mention links", async () => {
  const { buildReferencePasteTarget } = await loadModule();
  const target = buildReferencePasteTarget(
    "mention://workspace-app/vibe-design?workspaceId=workspace-1&iconUrl=tutti%3A%2F%2Fworkspace-apps%2Fvibe-design%2Ficon.png",
    "Vibe Design @产品",
  );

  assert.equal(target?.reference.providerId, "workspace-app");
  assert.equal(target?.reference.itemId, "vibe-design");
  assert.equal(target?.reference.thumbnailUrl, "tutti://workspace-apps/vibe-design/icon.png");
  assert.equal(target?.reference.insert.kind, "mention");
  assert.equal(target?.reference.insert.scope.iconUrl, "tutti://workspace-apps/vibe-design/icon.png");
});

test("copies generated reply quotes without leaking markdown quote markers", async () => {
  const { enrichMessageContentForCopy } = await loadModule();

  assert.equal(
    enrichMessageContentForCopy("> 回复 老板: 颠三倒四\n\n11", []),
    "回复 老板: 颠三倒四\n\n11",
  );
  assert.equal(
    enrichMessageContentForCopy("> Reply Alice: status\n> Reply Bob: next step\n\nDone", []),
    "Reply Alice: status\nReply Bob: next step\n\nDone",
  );
  assert.equal(
    enrichMessageContentForCopy("> plain markdown quote\n\nbody", []),
    "> plain markdown quote\n\nbody",
  );
});
