import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("run output artifacts can keep original filenames inside an isolated upload subdirectory", async () => {
  const home = await mkdtemp(join(tmpdir(), "group-chat-artifact-storage-"));
  const script = join(home, "check-artifact-storage.ts");

  await writeFile(
    script,
    `
      import assert from "node:assert/strict";
      import { relative } from "node:path";
      import { writeFileSync } from "node:fs";
      import { closeDb } from ${JSON.stringify(new URL("../apps/server/src/db/database.ts", import.meta.url).href)};
      import { ChatRepository } from ${JSON.stringify(new URL("../apps/server/src/domains/chat-repository.ts", import.meta.url).href)};

      const repo = new ChatRepository();
      const { room, conversation } = repo.createRoom({ title: "Artifact storage regression" });
      const chineseFilename = "【hr专员_深圳 20-25K】7_3.pdf";

      const first = repo.createArtifact(conversation.id, {
        filename: "styles.css",
        mimeType: "text/css",
        dataBase64: Buffer.from("body { color: red; }", "utf8").toString("base64"),
      });
      const duplicate = repo.createArtifact(conversation.id, {
        filename: "styles.css",
        mimeType: "text/css",
        dataBase64: Buffer.from("body { color: blue; }", "utf8").toString("base64"),
      });
      const runOutput = repo.createArtifact(conversation.id, {
        filename: "styles.css",
        mimeType: "text/css",
        dataBase64: Buffer.from("body { color: green; }", "utf8").toString("base64"),
      }, {
        kind: "run-output",
        sourceRunId: "run_1",
        uploadSubdir: "run-run_1",
      });
      const prepared = repo.prepareArtifactUpload(conversation.id, chineseFilename);
      writeFileSync(prepared.localPath, Buffer.from("pdf", "utf8"));
      const uploadedChinese = repo.createArtifactFromFile(conversation.id, {
        filename: prepared.filename,
        mimeType: "application/pdf",
        localPath: prepared.localPath,
      });

      assert.equal(first.filename, "styles.css");
      assert.equal(duplicate.filename, "styles2.css");
      assert.equal(runOutput.filename, "styles.css");
      assert.equal(relative(room.artifactRoot, runOutput.localPath).replace(/\\\\/g, "/"), "uploads/run-run_1/styles.css");
      assert.equal(prepared.filename, chineseFilename);
      assert.equal(uploadedChinese.filename, chineseFilename);
      assert.equal(relative(room.artifactRoot, uploadedChinese.localPath).replace(/\\\\/g, "/"), "uploads/" + chineseFilename);

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
