import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const moduleUrl = new URL("../apps/server/src/domains/workspace-app-direct-run.ts", import.meta.url).href;

test("direct workspace app mention produces a clean CLI intent", async () => {
  const checkScript = join(await mkdtemp(join(tmpdir(), "group-chat-direct-workspace-app-")), "check.ts");
  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";

      async function main() {
        const { resolveDirectWorkspaceAppIntent, workspaceAppResultMessage, workspaceAppMentionTarget, resolveTuttiCliBinary } = await import(${JSON.stringify(moduleUrl)});

        const content = "用 [Vibe Design](mention://workspace-app/vibe-design?workspaceId=ws-1&iconUrl=tutti%3A%2F%2Fworkspace-apps%2Fvibe-design%2Ficon.png) 做一个音乐app网站";
        const intent = resolveDirectWorkspaceAppIntent(content, [{
          mentionType: "reference",
          participantId: "tutti-at:workspace-app:vibe-design",
          displayNameSnapshot: "Vibe Design",
          referenceProviderId: "workspace-app",
          referenceEntityId: "vibe-design",
          referenceScope: { workspaceId: "ws-1", iconUrl: "tutti://workspace-apps/vibe-design/icon.png" },
          referenceInsert: {
            kind: "mention",
            entityId: "vibe-design",
            label: "Vibe Design",
            scope: { workspaceId: "ws-1", iconUrl: "tutti://workspace-apps/vibe-design/icon.png" },
          },
        }]);

        assert.deepEqual(intent, {
          appId: "vibe-design",
          label: "Vibe Design",
          prompt: "做一个音乐app网站",
          workspaceId: "ws-1",
          iconUrl: "tutti://workspace-apps/vibe-design/icon.png",
        });

        const result = {
          ...intent,
          projectId: "project-1",
          conversationId: "conversation-1",
          fallbackProvider: null,
        };
        const message = workspaceAppResultMessage(result);
        assert.match(message, /mention:\\/\\/workspace-app\\/vibe-design\\?workspaceId=ws-1/);
        assert.match(message, /projectId=project-1/);
        assert.match(message, /conversationId=conversation-1/);

        const mentions = workspaceAppMentionTarget(result);
        assert.equal(mentions[0].referenceProviderId, "workspace-app");
        assert.equal(mentions[0].referenceScope.projectId, "project-1");

        process.env.GROUP_CHAT_TUTTI_CLI = "/tmp/custom-tutti";
        assert.equal(resolveTuttiCliBinary(), "/tmp/custom-tutti");
        delete process.env.GROUP_CHAT_TUTTI_CLI;
      }
      main().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `,
  );

  try {
    await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", checkScript], {
      cwd: new URL("..", import.meta.url),
    });
  } finally {
    await rm(dirname(checkScript), { recursive: true, force: true });
  }
});

test("workspace app plus participant mention still direct-routes the app", async () => {
  const checkScript = join(await mkdtemp(join(tmpdir(), "group-chat-direct-workspace-app-")), "check.ts");
  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";

      async function main() {
        const { resolveDirectWorkspaceAppIntent } = await import(${JSON.stringify(moduleUrl)});
        const intent = resolveDirectWorkspaceAppIntent("[Vibe Design](mention://workspace-app/vibe-design?workspaceId=ws-1) @产品 做一个音乐网站", [
          {
            mentionType: "reference",
            participantId: "tutti-at:workspace-app:vibe-design",
            displayNameSnapshot: "Vibe Design",
            referenceProviderId: "workspace-app",
            referenceEntityId: "vibe-design",
            referenceScope: { workspaceId: "ws-1" },
          },
          {
            mentionType: "participant",
            participantId: "product-agent",
            displayNameSnapshot: "产品",
          },
        ]);
        assert.deepEqual(intent, {
          appId: "vibe-design",
          label: "Vibe Design",
          prompt: "做一个音乐网站",
          workspaceId: "ws-1",
          iconUrl: null,
        });
      }
      main().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `,
  );

  try {
    await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", checkScript], {
      cwd: new URL("..", import.meta.url),
    });
  } finally {
    await rm(dirname(checkScript), { recursive: true, force: true });
  }
});
