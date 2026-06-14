import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runFutureContracts = process.env.GROUP_CHAT_RUN_MULTIPLAYER_CONTRACT === "1";
const multiplayerTest = (name, fn) =>
  test(name, { skip: runFutureContracts ? false : "future multiplayer contract; set GROUP_CHAT_RUN_MULTIPLAYER_CONTRACT=1 to run" }, fn);

multiplayerTest("multiplayer API exposes public messages to every joined user and preserves sender id", async (t) => {
  const server = await startServer(t);
  const fixture = await createFixture(server.baseUrl);

  const before = await getSnapshot(server.baseUrl, fixture.users.alice.id);
  const bobWs = await connectWs(server.baseUrl, fixture.users.bob.id, before.lastSeq);
  t.after(() => bobWs.close());

  const result = await postJson(server.baseUrl, fixture.users.alice.id, `/api/conversations/${fixture.conversation.id}/messages`, {
    content: "Alice public hello",
    mentions: [],
    visibility: "public",
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.message.senderParticipantId, fixture.users.alice.id);

  const bobSnapshot = await getSnapshot(server.baseUrl, fixture.users.bob.id);
  const carolSnapshot = await getSnapshot(server.baseUrl, fixture.users.carol.id);
  assertSnapshotHasMessage(bobSnapshot, result.body.message.id, "Alice public hello");
  assertSnapshotHasMessage(carolSnapshot, result.body.message.id, "Alice public hello");

  const event = await bobWs.nextEvent("message.created");
  assert.equal(event.payload.message.id, result.body.message.id);
});

multiplayerTest("multiplayer API separates human mentions from AI response targets", async (t) => {
  const server = await startServer(t);
  const fixture = await createFixture(server.baseUrl);

  const humanMention = await postJson(server.baseUrl, fixture.users.alice.id, `/api/conversations/${fixture.conversation.id}/messages`, {
    content: "@Bob please review this.",
    mentions: [mention(fixture.users.bob.id, "Bob")],
    visibility: "public",
  });

  assert.equal(humanMention.status, 200);
  assert.deepEqual(humanMention.body.targets, []);
  assert.equal(humanMention.body.message.mentions[0].participantId, fixture.users.bob.id);

  const aiMention = await postJson(server.baseUrl, fixture.users.alice.id, `/api/conversations/${fixture.conversation.id}/messages`, {
    content: "@Planner please respond.",
    mentions: [mention(fixture.agents.planner.id, "Planner")],
    visibility: "public",
  });

  assert.equal(aiMention.status, 200);
  assert.deepEqual(aiMention.body.targets.map((target) => target.id), [fixture.agents.planner.id]);
});

multiplayerTest("multiplayer API keeps whisper messages, runs, and artifacts scoped to sender plus mentions", async (t) => {
  const server = await startServer(t);
  const fixture = await createFixture(server.baseUrl);

  const secretArtifact = await postJson(server.baseUrl, fixture.users.alice.id, `/api/conversations/${fixture.conversation.id}/artifacts`, {
    filename: "secret-plan.txt",
    mimeType: "text/plain",
    dataBase64: Buffer.from("secret multiplayer plan", "utf8").toString("base64"),
  });
  assert.equal(secretArtifact.status, 200);

  const whisper = await postJson(server.baseUrl, fixture.users.alice.id, `/api/conversations/${fixture.conversation.id}/messages`, {
    content: "@Bob @Planner private plan",
    artifactIds: [secretArtifact.body.artifact.id],
    mentions: [
      mention(fixture.users.bob.id, "Bob"),
      mention(fixture.agents.planner.id, "Planner"),
    ],
    visibility: "whisper",
  });
  assert.equal(whisper.status, 200);
  assert.deepEqual(whisper.body.targets.map((target) => target.id), [fixture.agents.planner.id]);

  const aliceSnapshot = await getSnapshot(server.baseUrl, fixture.users.alice.id);
  const bobSnapshot = await getSnapshot(server.baseUrl, fixture.users.bob.id);
  const carolSnapshot = await getSnapshot(server.baseUrl, fixture.users.carol.id);

  assertSnapshotHasMessage(aliceSnapshot, whisper.body.message.id, "private plan");
  assertSnapshotHasMessage(bobSnapshot, whisper.body.message.id, "private plan");
  assertSnapshotLacksMessage(carolSnapshot, whisper.body.message.id);
  assert.equal(carolSnapshot.artifacts.some((artifact) => artifact.filename === "secret-plan.txt"), false);

  const cli = await postJson(server.baseUrl, fixture.users.carol.id, "/tutti/cli/conversations/get", {
    input: { "conversation-id": fixture.conversation.id, "recent-message-limit": 20 },
    outputMode: "json",
  });
  assert.equal(cli.status, 200);
  assert.equal(JSON.stringify(cli.body).includes("private plan"), false);
});

multiplayerTest("multiplayer API isolates hidden messages per user", async (t) => {
  const server = await startServer(t);
  const fixture = await createFixture(server.baseUrl);

  const message = await postJson(server.baseUrl, fixture.users.alice.id, `/api/conversations/${fixture.conversation.id}/messages`, {
    content: "Hide only for Bob",
    mentions: [],
    visibility: "public",
  });
  assert.equal(message.status, 200);

  const hidden = await deleteJson(server.baseUrl, fixture.users.bob.id, `/api/messages/${message.body.message.id}`);
  assert.equal(hidden.status, 200);

  assertSnapshotLacksMessage(await getSnapshot(server.baseUrl, fixture.users.bob.id), message.body.message.id);
  assertSnapshotHasMessage(await getSnapshot(server.baseUrl, fixture.users.alice.id), message.body.message.id, "Hide only for Bob");
});

multiplayerTest("multiplayer API replays room, policy, and participant updates to other users", async (t) => {
  const server = await startServer(t);
  const fixture = await createFixture(server.baseUrl);
  const before = await getSnapshot(server.baseUrl, fixture.users.bob.id);
  const bobWs = await connectWs(server.baseUrl, fixture.users.bob.id, before.lastSeq);
  t.after(() => bobWs.close());

  const room = await patchJson(server.baseUrl, fixture.users.alice.id, `/api/rooms/${fixture.room.id}`, {
    title: "Multiplayer updated room",
  });
  assert.equal(room.status, 200);
  assert.equal((await bobWs.nextEvent("room.updated")).payload.room.title, "Multiplayer updated room");

  const policy = await patchJson(server.baseUrl, fixture.users.alice.id, `/api/conversations/${fixture.conversation.id}/policy`, {
    replyPolicy: { mode: "all", order: "parallel", maxRounds: 1, mentionFollowupRounds: 0 },
  });
  assert.equal(policy.status, 200);
  assert.equal((await bobWs.nextEvent("conversation.updated")).payload.conversation.replyPolicy.order, "parallel");

  const removed = await deleteJson(server.baseUrl, fixture.users.alice.id, `/api/participants/${fixture.agents.critic.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await bobWs.nextEvent("participant.updated")).payload.participant.status, "removed");
});

multiplayerTest("multiplayer API coalesces concurrent triggers for the same AI participant", async (t) => {
  const server = await startServer(t);
  const fixture = await createFixture(server.baseUrl);

  const [alice, bob] = await Promise.all([
    postJson(server.baseUrl, fixture.users.alice.id, `/api/conversations/${fixture.conversation.id}/messages`, {
      content: "@Planner from Alice",
      mentions: [mention(fixture.agents.planner.id, "Planner")],
      visibility: "public",
    }),
    postJson(server.baseUrl, fixture.users.bob.id, `/api/conversations/${fixture.conversation.id}/messages`, {
      content: "@Planner from Bob",
      mentions: [mention(fixture.agents.planner.id, "Planner")],
      visibility: "public",
    }),
  ]);

  assert.equal(alice.status, 200);
  assert.equal(bob.status, 200);

  const snapshot = await getSnapshot(server.baseUrl, fixture.users.alice.id);
  const activePlannerRuns = snapshot.activeRuns.filter((run) =>
    run.conversationId === fixture.conversation.id && run.participantId === fixture.agents.planner.id
  );
  assert.ok(activePlannerRuns.length <= 1, "expected at most one active planner run while the queue coalesces triggers");
});

async function createFixture(baseUrl) {
  const roomResult = await postJson(baseUrl, "system", "/api/rooms", {
    title: "Multiplayer Contract Room",
    participants: [
      { displayName: "Alice", kind: "human" },
      { displayName: "Bob", kind: "human" },
      { displayName: "Carol", kind: "human" },
    ],
  });
  assert.equal(roomResult.status, 200);

  const plannerIdentity = await postJson(baseUrl, "system", "/api/identities", {
    name: "Planner",
    icon: "PL",
    systemPrompt: "You are Planner. Keep contract-test replies concise.",
    defaultRuntimeProfileId: "server-demo",
    defaultListenMode: "active",
  });
  assert.equal(plannerIdentity.status, 200);
  const criticIdentity = await postJson(baseUrl, "system", "/api/identities", {
    name: "Critic",
    icon: "CR",
    systemPrompt: "You are Critic. Keep contract-test replies concise.",
    defaultRuntimeProfileId: "server-demo",
    defaultListenMode: "active",
  });
  assert.equal(criticIdentity.status, 200);

  const planner = await postJson(baseUrl, "system", `/api/conversations/${roomResult.body.conversation.id}/participants`, {
    identityId: plannerIdentity.body.identity.id,
    runtimeProfileId: "server-demo",
    listenMode: "active",
  });
  assert.equal(planner.status, 200);
  const critic = await postJson(baseUrl, "system", `/api/conversations/${roomResult.body.conversation.id}/participants`, {
    identityId: criticIdentity.body.identity.id,
    runtimeProfileId: "server-demo",
    listenMode: "active",
  });
  assert.equal(critic.status, 200);

  const participants = (await getSnapshot(baseUrl, "system")).participants.filter(
    (participant) => participant.conversationId === roomResult.body.conversation.id,
  );
  const users = Object.fromEntries(
    participants
      .filter((participant) => participant.kind === "human")
      .map((participant) => [participant.displayName.toLowerCase(), participant]),
  );

  return {
    room: roomResult.body.room,
    conversation: roomResult.body.conversation,
    users,
    agents: {
      planner: planner.body.participant,
      critic: critic.body.participant,
    },
  };
}

function mention(participantId, displayNameSnapshot) {
  return { participantId, displayNameSnapshot, mentionType: "participant" };
}

async function startServer(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "group-chat-multiplayer-contract-"));
  const port = 9100 + Math.floor(Math.random() * 700);
  const child = spawn("pnpm", ["--filter", "@group-chat/server", "exec", "tsx", "src/main.ts"], {
    cwd: rootDir,
    env: {
      ...process.env,
      GROUP_CHAT_HOME: home,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGINT");
      await Promise.race([once(child, "exit"), delay(3000)]);
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
      if (response.ok) return { baseUrl };
    } catch {
      // Keep polling until the Fastify listener is ready.
    }
    await delay(100);
  }
  throw new Error(`server did not become healthy\n${output}`);
}

async function getSnapshot(baseUrl, userId) {
  const response = await fetch(`${baseUrl}/api/bootstrap`, {
    headers: userHeaders(userId),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(baseUrl, userId, pathName, body) {
  return fetchJson(baseUrl, userId, pathName, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function patchJson(baseUrl, userId, pathName, body) {
  return fetchJson(baseUrl, userId, pathName, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function deleteJson(baseUrl, userId, pathName) {
  return fetchJson(baseUrl, userId, pathName, { method: "DELETE" });
}

async function fetchJson(baseUrl, userId, pathName, init) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...userHeaders(userId),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function userHeaders(userId) {
  return { "x-group-chat-user-id": userId };
}

async function connectWs(baseUrl, userId, lastSeq) {
  const url = `${baseUrl.replace(/^http/, "ws")}/api/ws?userId=${encodeURIComponent(userId)}`;
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.send(JSON.stringify({ type: "hello", lastSeq }));
  const queue = [];
  const waiters = [];
  socket.addEventListener("message", (raw) => {
    const parsed = JSON.parse(raw.data);
    const events = parsed.type === "event" && parsed.event
      ? [parsed.event]
      : parsed.type === "replay" && parsed.events
        ? parsed.events
        : [];
    for (const event of events) {
      const waiterIndex = waiters.findIndex((waiter) => waiter.type === event.type);
      if (waiterIndex >= 0) {
        const [waiter] = waiters.splice(waiterIndex, 1);
        waiter.resolve(event);
      } else {
        queue.push(event);
      }
    }
  });

  return {
    close: () => socket.close(),
    nextEvent: (type) => {
      const existingIndex = queue.findIndex((event) => event.type === type);
      if (existingIndex >= 0) {
        const [event] = queue.splice(existingIndex, 1);
        return Promise.resolve(event);
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${type}`));
        }, 5000);
        waiters.push({
          type,
          resolve: (event) => {
            clearTimeout(timeout);
            resolve(event);
          },
        });
      });
    },
  };
}

function assertSnapshotHasMessage(snapshot, messageId, content) {
  const message = snapshot.messages.find((item) => item.id === messageId);
  assert.ok(message, `expected snapshot to include message ${messageId}`);
  assert.match(message.content, new RegExp(escapeRegExp(content)));
}

function assertSnapshotLacksMessage(snapshot, messageId) {
  assert.equal(snapshot.messages.some((item) => item.id === messageId), false, `expected snapshot to hide message ${messageId}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
