import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadModule() {
  const output = "/tmp/agent-launcher-availability.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", "src/app/agent-launcher-availability.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("filters legacy provider launchers out of Dock discovery and cache", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.window = {
    tuttiExternal: {
      at: {
        query: async () => [{
          providerId: "workspace-app",
          itemId: "agent-codex",
          label: "Codex",
          insert: {
            kind: "mention",
            mention: { entityId: "agent-codex", label: "Codex" },
          },
        }],
      },
    },
  };

  const first = await loadModule();
  assert.deepEqual([...await first.fetchAvailableAgentLauncherAppIds({ force: true })], []);

  delete globalThis.window.tuttiExternal.at;
  const reloaded = await loadModule();
  assert.deepEqual([...reloaded.readCachedAvailableAgentLauncherAppIds()], []);

  delete globalThis.window;
  delete globalThis.localStorage;
});

test("keeps a confirmed local agent available while Dock data is unavailable", async () => {
  const { isAgentLauncherAvailable } = await loadModule();
  assert.equal(isAgentLauncherAvailable("agent-codex", new Set(), true), true);
  assert.equal(isAgentLauncherAvailable("agent-codex", new Set(), false), false);
  assert.equal(isAgentLauncherAvailable("agent-codex", new Set(["agent-codex"]), false), true);
  assert.equal(isAgentLauncherAvailable("agent-codex", new Set(), false, true), true);
});
