import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("pinning a conversation does not refresh its activity timestamp", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-pin-activity-"));
  const script = join(home, "check-conversation-pin-activity.ts");

  await writeFile(
    script,
    `
      import assert from "node:assert/strict";
      import { closeDb, getDb } from ${JSON.stringify(new URL("../apps/server/src/db/database.ts", import.meta.url).href)};
      import { ChatRepository } from ${JSON.stringify(new URL("../apps/server/src/domains/chat-repository.ts", import.meta.url).href)};

      const repo = new ChatRepository();
      const { conversation } = repo.createRoom({ title: "Pinned activity regression" });
      const lastMessageAt = "2026-01-01T12:34:56.000Z";

      getDb()
        .prepare("UPDATE conversations SET last_message = ?, last_message_at = ?, updated_at = ? WHERE id = ?")
        .run("last group message", lastMessageAt, lastMessageAt, conversation.id);

      const pinned = repo.updateConversationPinned(conversation.id, true);
      assert.ok(pinned);
      assert.equal(pinned.pinned, true);
      assert.equal(pinned.lastMessageAt, lastMessageAt);
      assert.equal(pinned.updatedAt, lastMessageAt);

      const unpinned = repo.updateConversationPinned(conversation.id, false);
      assert.ok(unpinned);
      assert.equal(unpinned.pinned, false);
      assert.equal(unpinned.lastMessageAt, lastMessageAt);
      assert.equal(unpinned.updatedAt, lastMessageAt);

      closeDb();
    `,
  );

  try {
    await execFileAsync("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", script], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, GROUP_CHAT_HOME: home },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
