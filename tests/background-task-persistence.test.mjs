import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function loadBackgroundTasksModule() {
  const outfile = "/tmp/background-tasks.test.mjs";
  const build = spawnSync(
    "pnpm",
    ["--filter", "@group-chat/web", "exec", "esbuild", "src/app/background-tasks.ts", "--bundle", "--platform=browser", "--format=esm", `--outfile=${outfile}`],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, ESBUILD_WORKER: "false" } },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  return import(`${pathToFileURL(outfile)}?t=${Date.now()}`);
}

test("summary task ids survive window storage replacement until manually removed", async () => {
  globalThis.localStorage = createMemoryStorage();
  globalThis.sessionStorage = createMemoryStorage();
  const tasks = await loadBackgroundTasksModule();

  tasks.addLocalTaskBarTaskId("summary-1");
  assert.deepEqual([...tasks.loadLocalTaskBarTaskIds()], ["summary-1"]);

  globalThis.sessionStorage = createMemoryStorage();
  assert.deepEqual([...tasks.loadLocalTaskBarTaskIds()], ["summary-1"]);

  tasks.removeLocalTaskBarTaskId("summary-1");
  assert.deepEqual([...tasks.loadLocalTaskBarTaskIds()], []);
});

test("legacy session task ids migrate to persistent storage", async () => {
  const key = "group-chat:local-task-bar-task-ids";
  globalThis.localStorage = createMemoryStorage();
  globalThis.sessionStorage = createMemoryStorage({ [key]: JSON.stringify(["summary-legacy"]) });
  const tasks = await loadBackgroundTasksModule();

  assert.deepEqual([...tasks.loadLocalTaskBarTaskIds()], ["summary-legacy"]);
  assert.equal(globalThis.localStorage.getItem(key), JSON.stringify(["summary-legacy"]));
  assert.equal(globalThis.sessionStorage.getItem(key), null);
});

test("background task bar visibility is scoped to the current conversation", async () => {
  globalThis.localStorage = createMemoryStorage();
  globalThis.sessionStorage = createMemoryStorage();
  const tasks = await loadBackgroundTasksModule();
  const task = { id: "summary-1", conversationId: "conversation-1" };
  const localTaskIds = new Set(["summary-1"]);
  const dismissedTaskIds = new Set();

  assert.equal(
    tasks.isBackgroundTaskVisibleInConversation(task, "conversation-1", localTaskIds, dismissedTaskIds),
    true,
  );
  assert.equal(
    tasks.isBackgroundTaskVisibleInConversation(task, "conversation-2", localTaskIds, dismissedTaskIds),
    false,
  );
  assert.equal(
    tasks.isBackgroundTaskVisibleInConversation(task, null, localTaskIds, dismissedTaskIds),
    false,
  );
});
