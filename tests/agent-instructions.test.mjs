import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const instructionsModuleUrl = new URL("../apps/server/src/domains/agent-instructions.ts", import.meta.url).href;

test("product agents receive a PRD contract in their effective role instructions", async () => {
  const checkScript = join(await mkdtemp(join(tmpdir(), "group-chat-agent-instructions-")), "check-instructions.ts");
  await writeFile(
    checkScript,
    `
      import assert from "node:assert/strict";

      async function main() {
        const { buildEffectiveRoleDescription } = await import(${JSON.stringify(instructionsModuleUrl)});
        const participant = {
          id: "product-agent",
          conversationId: "conversation-1",
          kind: "ai",
          displayName: "产品",
          avatar: null,
          runtimeProfileId: "local-agent:codex",
          identityId: "identity-product",
          roomInstructions: "",
          status: "active",
          listenMode: "passive",
          sortOrder: 0,
          reasoningEffort: null,
          speedMode: null,
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
        };
        const identity = {
          id: "identity-product",
          name: "Product Manager",
          icon: "",
          systemPrompt: "You are a senior product manager agent.",
          stylePrompt: "",
          defaultRuntimeProfileId: "local-agent:codex",
          defaultListenMode: "passive",
          defaultReasoningEffort: null,
          defaultSpeedMode: null,
          temperature: 0.7,
          skillIds: [],
          toolAccessPolicy: { mode: "read-only", allowedToolIds: [] },
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
        };

        const description = buildEffectiveRoleDescription(participant, identity);

        assert.match(description, /## PRD Request Contract/);
        assert.match(description, /Do not answer with only acceptance criteria/);
        assert.match(description, /Do not silently turn a brand or physical product, such as Coca-Cola, into a website/);

        const alreadyGuided = buildEffectiveRoleDescription(
          participant,
          {
            ...identity,
            systemPrompt: [
              "You are a senior product manager agent.",
              "When the user asks for a PRD, produce a real product requirements document.",
              "Do not silently turn a brand or physical product, such as Coca-Cola, into a website.",
            ].join("\\n"),
          },
        );
        assert.doesNotMatch(alreadyGuided, /## PRD Request Contract/);

        const unrelated = buildEffectiveRoleDescription(
          { ...participant, displayName: "工程", identityId: "identity-dev" },
          { ...identity, id: "identity-dev", name: "Developer", systemPrompt: "You are a senior software engineer agent." },
        );
        assert.doesNotMatch(unrelated, /## PRD Request Contract/);
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
