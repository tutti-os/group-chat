import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Tutti CLI handlers expose public conversation data only", async (t) => {
  const buildShared = spawnSync("pnpm", ["--filter", "@group-chat/shared", "build"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  assert.equal(buildShared.status, 0, buildShared.stderr || buildShared.stdout);

  const server = await startServer(t);
  const list = await postJson(server.baseUrl, "/tutti/cli/conversations/list", {
    input: { limit: 1 },
    outputMode: "json",
  });
  assert.equal(list.status, 200);
  const conversationId = list.body.value.conversations[0].id;

  const publicArtifact = await postJson(server.baseUrl, `/api/conversations/${conversationId}/artifacts`, {
    filename: "public.txt",
    mimeType: "text/plain",
    dataBase64: "UHVibGljIGFydGlmYWN0Cg==",
  });
  assert.equal(publicArtifact.status, 200);
  assert.match(publicArtifact.body.artifact.contentHash, /^[a-f0-9]{64}$/);

  const publicMessage = await postJson(server.baseUrl, `/api/conversations/${conversationId}/messages`, {
    artifactIds: [publicArtifact.body.artifact.id],
    content: "public hello",
    mentions: [],
    visibility: "public",
  });
  assert.equal(publicMessage.status, 200);

  const whisperArtifact = await postJson(server.baseUrl, `/api/conversations/${conversationId}/artifacts`, {
    filename: "secret.txt",
    mimeType: "text/plain",
    dataBase64: "U2VjcmV0IGFydGlmYWN0Cg==",
  });
  assert.equal(whisperArtifact.status, 200);

  const whisperMessage = await postJson(server.baseUrl, `/api/conversations/${conversationId}/messages`, {
    artifactIds: [whisperArtifact.body.artifact.id],
    content: "secret whisper",
    mentions: [],
    visibility: "whisper",
  });
  assert.equal(whisperMessage.status, 200);

  const detail = await postJson(server.baseUrl, "/tutti/cli/conversations/get", {
    input: { "conversation-id": conversationId, "recent-message-limit": 10 },
    outputMode: "json",
  });
  assert.equal(detail.status, 200);
  assert.deepEqual(
    detail.body.value.conversation.recentMessages.map((message) => message.content),
    ["public hello"],
  );
  assert.equal(detail.body.value.conversation.lastMessage, "public hello");
  assert.equal(detail.body.value.warnings[0].code, "public_only");
  assert.equal(detail.body.value.warnings[0].omittedWhisperMessageCount, 1);
  assert.equal(detail.body.value.warnings[0].omittedWhisperArtifactCount, 1);

  const artifacts = await postJson(server.baseUrl, "/tutti/cli/artifacts/list", {
    input: { "conversation-id": conversationId },
    outputMode: "json",
  });
  assert.equal(artifacts.status, 200);
  assert.deepEqual(
    artifacts.body.value.artifacts.map((artifact) => artifact.id),
    [publicArtifact.body.artifact.id],
  );
  assert.equal(artifacts.body.value.warnings[0].omittedWhisperArtifactCount, 1);

  const duplicatePublicArtifact = await postJson(server.baseUrl, `/api/conversations/${conversationId}/artifacts`, {
    filename: "public-copy.txt",
    mimeType: "text/plain",
    dataBase64: "UHVibGljIGFydGlmYWN0Cg==",
  });
  assert.equal(duplicatePublicArtifact.status, 200);
  assert.notEqual(duplicatePublicArtifact.body.artifact.localPath, publicArtifact.body.artifact.localPath);
  assert.equal(duplicatePublicArtifact.body.artifact.contentHash, publicArtifact.body.artifact.contentHash);
  const repeatedPublicMessage = await postJson(server.baseUrl, `/api/conversations/${conversationId}/messages`, {
    artifactIds: [duplicatePublicArtifact.body.artifact.id],
    content: "same public file sent again",
    mentions: [],
    visibility: "public",
  });
  assert.equal(repeatedPublicMessage.status, 200);
  assert.equal(repeatedPublicMessage.body.artifacts[0].id, duplicatePublicArtifact.body.artifact.id);

  const imageArtifact = await postJson(server.baseUrl, `/api/conversations/${conversationId}/artifacts`, {
    filename: "pixel.png",
    mimeType: "image/png",
    dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2mQAAAABJRU5ErkJggg==",
  });
  assert.equal(imageArtifact.status, 200);
  assert.match(imageArtifact.body.artifact.contentHash, /^[a-f0-9]{64}$/);
  const imageMessage = await postJson(server.baseUrl, `/api/conversations/${conversationId}/messages`, {
    artifactIds: [imageArtifact.body.artifact.id],
    content: "public image",
    mentions: [],
    visibility: "public",
  });
  assert.equal(imageMessage.status, 200);
  const duplicateImageArtifact = await postJson(server.baseUrl, `/api/conversations/${conversationId}/artifacts`, {
    filename: "pixel-copy.png",
    mimeType: "image/png",
    dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2mQAAAABJRU5ErkJggg==",
  });
  assert.equal(duplicateImageArtifact.status, 200);
  assert.notEqual(duplicateImageArtifact.body.artifact.localPath, imageArtifact.body.artifact.localPath);
  assert.equal(duplicateImageArtifact.body.artifact.contentHash, imageArtifact.body.artifact.contentHash);
  const repeatedImageMessage = await postJson(server.baseUrl, `/api/conversations/${conversationId}/messages`, {
    artifactIds: [duplicateImageArtifact.body.artifact.id],
    content: "same public image sent again",
    mentions: [],
    visibility: "public",
  });
  assert.equal(repeatedImageMessage.status, 200);
  assert.equal(repeatedImageMessage.body.artifacts[0].localPath, duplicateImageArtifact.body.artifact.localPath);

  const emptyRecentRoom = await postJson(server.baseUrl, "/api/rooms", {
    title: "Empty recent room",
  });
  assert.equal(emptyRecentRoom.status, 200);
  const attachmentCopyRoom = await postJson(server.baseUrl, "/api/rooms", {
    title: "Attachment copy room",
  });
  assert.equal(attachmentCopyRoom.status, 200);

  const copiedAttachmentMessage = await postJson(
    server.baseUrl,
    `/api/conversations/${attachmentCopyRoom.body.conversation.id}/messages`,
    {
      artifactIds: [publicArtifact.body.artifact.id],
      content: "cross-conversation attachment copy",
      mentions: [],
      visibility: "public",
    },
  );
  assert.equal(copiedAttachmentMessage.status, 200);
  const copiedArtifact = copiedAttachmentMessage.body.artifacts[0];
  assert.notEqual(copiedArtifact.id, publicArtifact.body.artifact.id);
  assert.equal(copiedArtifact.messageId, copiedAttachmentMessage.body.message.id);
  assert.equal(copiedArtifact.conversationId, attachmentCopyRoom.body.conversation.id);
  assert.equal(copiedArtifact.roomId, attachmentCopyRoom.body.room.id);

  const repeatedCrossRoomCopy = await postJson(
    server.baseUrl,
    `/api/conversations/${attachmentCopyRoom.body.conversation.id}/messages`,
    {
      artifactIds: [publicArtifact.body.artifact.id],
      content: "same cross-room attachment copied again",
      mentions: [],
      visibility: "public",
    },
  );
  assert.equal(repeatedCrossRoomCopy.status, 200);
  assert.equal(repeatedCrossRoomCopy.body.artifacts[0].localPath, publicArtifact.body.artifact.localPath);

  const independentlyUploadedCrossRoomArtifact = await postJson(
    server.baseUrl,
    `/api/conversations/${attachmentCopyRoom.body.conversation.id}/artifacts`,
    {
      filename: "public-cross-room.txt",
      mimeType: "text/plain",
      dataBase64: "UHVibGljIGFydGlmYWN0Cg==",
    },
  );
  assert.equal(independentlyUploadedCrossRoomArtifact.status, 200);
  assert.notEqual(independentlyUploadedCrossRoomArtifact.body.artifact.localPath, publicArtifact.body.artifact.localPath);
  assert.equal(independentlyUploadedCrossRoomArtifact.body.artifact.contentHash, publicArtifact.body.artifact.contentHash);
  const independentlyUploadedCrossRoomMessage = await postJson(
    server.baseUrl,
    `/api/conversations/${attachmentCopyRoom.body.conversation.id}/messages`,
    {
      artifactIds: [independentlyUploadedCrossRoomArtifact.body.artifact.id],
      content: "same bytes uploaded independently in another room",
      mentions: [],
      visibility: "public",
    },
  );
  assert.equal(independentlyUploadedCrossRoomMessage.status, 200);

  const snapshotAfterCopy = await getJson(server.baseUrl, "/api/bootstrap");
  assert.equal(snapshotAfterCopy.status, 200);
  const originalArtifactAfterCopy = snapshotAfterCopy.body.artifacts.find(
    (artifact) => artifact.id === publicArtifact.body.artifact.id,
  );
  assert.equal(originalArtifactAfterCopy.messageId, publicMessage.body.message.id);

  const legacyDb = new DatabaseSync(server.dbPath);
  legacyDb.exec("UPDATE artifacts SET content_hash = NULL");
  legacyDb.close();

  const rootReferences = await postJson(server.baseUrl, "/tutti/references/list", {
    limit: 50,
    kinds: ["file"],
  });
  assert.equal(rootReferences.status, 200);
  const roomGroup = rootReferences.body.items.find(
    (item) => item.type === "group" && item.id === list.body.value.conversations[0].roomId,
  );
  assert.ok(roomGroup);
  assert.equal(roomGroup.referenceCount, 2);
  const attachmentCopyRoomGroup = rootReferences.body.items.find(
    (item) => item.type === "group" && item.id === attachmentCopyRoom.body.room.id,
  );
  assert.ok(attachmentCopyRoomGroup);
  assert.equal(attachmentCopyRoomGroup.referenceCount, 1);
  const emptyRoomGroup = rootReferences.body.items.find(
    (item) => item.type === "group" && item.id === emptyRecentRoom.body.room.id,
  );
  assert.ok(emptyRoomGroup);
  assert.equal(emptyRoomGroup.referenceCount, 0);
  assert.ok(rootReferences.body.items.indexOf(roomGroup) < rootReferences.body.items.indexOf(emptyRoomGroup));

  const references = await postJson(server.baseUrl, "/tutti/references/list", {
    parentGroupId: roomGroup.id,
    filterText: "public",
    limit: 5,
    kinds: ["file"],
  });
  assert.equal(references.status, 200);
  assert.equal(references.body.items.length, 1);
  assert.equal(references.body.items[0].type, "reference");
  assert.equal(references.body.items[0].reference.kind, "file");
  assert.equal(references.body.items[0].reference.location.type, "app-data-relative");
  assert.match(references.body.items[0].reference.location.path, /^rooms\/[^/]+\/uploads\/[^/]+\.txt$/);

  const imageReferences = await postJson(server.baseUrl, "/tutti/references/list", {
    parentGroupId: roomGroup.id,
    filterText: "pixel",
    limit: 5,
    kinds: ["file"],
  });
  assert.equal(imageReferences.status, 200);
  assert.equal(imageReferences.body.items.length, 1);
  assert.equal(imageReferences.body.items[0].reference.mimeType, "image/png");
  assert.match(imageReferences.body.items[0].reference.previewUrl, /^\/local-assets\//);

  const copiedRoomReferences = await postJson(server.baseUrl, "/tutti/references/list", {
    parentGroupId: attachmentCopyRoomGroup.id,
    filterText: "public",
    limit: 5,
    kinds: ["file"],
  });
  assert.equal(copiedRoomReferences.status, 200);
  assert.equal(copiedRoomReferences.body.items.length, 1);

  const bodyOnlyMessage = await postJson(server.baseUrl, `/api/conversations/${conversationId}/messages`, {
    content: "body-only-reference-search-token",
    mentions: [],
    visibility: "public",
  });
  assert.equal(bodyOnlyMessage.status, 200);

  const bodyOnlyReferences = await postJson(server.baseUrl, "/tutti/references/list", {
    parentGroupId: roomGroup.id,
    filterText: "body-only-reference-search-token",
    limit: 5,
    kinds: ["file"],
  });
  assert.equal(bodyOnlyReferences.status, 200);
  assert.deepEqual(bodyOnlyReferences.body.items, []);

  const hiddenArtifact = await postJson(server.baseUrl, "/tutti/cli/artifacts/get", {
    input: { "artifact-id": whisperArtifact.body.artifact.id },
    outputMode: "json",
  });
  assert.equal(hiddenArtifact.status, 404);
  assert.equal(hiddenArtifact.body.error.code, "not_found");

  const invalidInput = await postJson(server.baseUrl, "/tutti/cli/conversations/list", {
    input: { limit: "10" },
    outputMode: "json",
  });
  assert.equal(invalidInput.status, 400);
  assert.equal(invalidInput.body.error.code, "invalid_input");

  const oldAlias = await postJson(server.baseUrl, "/nextop/cli/conversations/list", {
    input: {},
    outputMode: "json",
  });
  assert.equal(oldAlias.status, 404);
  assert.equal(oldAlias.body.error, "Not found");
});

async function startServer(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "group-chat-tutti-cli-test-"));
  const port = 8900 + Math.floor(Math.random() * 800);
  const usesProcessGroup = process.platform !== "win32";
  const child = spawn("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", "src/main.ts"], {
    cwd: rootDir,
    env: {
      ...process.env,
      GROUP_CHAT_HOME: home,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: usesProcessGroup,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  t.after(async () => {
    if (child.exitCode === null) {
      signalChildProcess(child, "SIGINT", usesProcessGroup);
      await Promise.race([once(child, "exit"), delay(3000)]);
    }
    signalChildProcess(child, "SIGKILL", usesProcessGroup);
    if (child.exitCode === null) {
      await Promise.race([once(child, "exit"), delay(1000)]);
    }
    await rm(home, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { baseUrl, dbPath: path.join(home, "data", "group-chat.db") };
    } catch {
      // Keep polling until the Fastify listener is ready.
    }
    await delay(100);
  }
  throw new Error(`server did not become healthy\n${output}`);
}

function signalChildProcess(child, signal, usesProcessGroup) {
  try {
    if (usesProcessGroup) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function postJson(baseUrl, pathName, body) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { status: response.status, body: parsed };
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { status: response.status, body: parsed };
}
