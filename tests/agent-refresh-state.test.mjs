import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadModule() {
  const output = "/tmp/agent-refresh-state.test.mjs";
  await execFileAsync("pnpm", [
    "--filter",
    "@group-chat/web",
    "exec",
    "esbuild",
    "src/app/agent-refresh-state.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

test("Agent refresh never rolls back newer WS state or replaces timeline data", async () => {
  const { mergeAgentCatalogSnapshot } = await loadModule();
  const current = {
    lastSeq: 12,
    messages: [{ id: "message-new" }],
    messageBlocks: [{ id: "block-new" }],
    runtimeProfiles: [{ id: "profile-shared", updatedAt: "2026-07-15T12:00:00.000Z", model: "ws-new" }],
    participants: [{ id: "participant-shared", updatedAt: "2026-07-15T12:00:00.000Z", status: "inactive" }],
    identities: [{ id: "identity-shared", updatedAt: "2026-07-15T12:00:00.000Z", name: "WS new" }],
  };
  const stale = {
    lastSeq: 11,
    runtimeProfiles: [
      { id: "profile-shared", updatedAt: "2026-07-15T11:00:00.000Z", model: "stale" },
      { id: "profile-catalog", updatedAt: "2026-07-15T13:00:00.000Z", model: "new catalog target" },
    ],
    participants: [
      { id: "participant-shared", updatedAt: "2026-07-15T11:00:00.000Z", status: "active" },
      { id: "participant-deleted-by-ws", updatedAt: "2026-07-15T11:00:00.000Z", status: "active" },
    ],
    identities: [
      { id: "identity-shared", updatedAt: "2026-07-15T11:00:00.000Z", name: "stale" },
      { id: "identity-deleted-by-ws", updatedAt: "2026-07-15T11:00:00.000Z", name: "deleted" },
    ],
  };
  const staleMerged = mergeAgentCatalogSnapshot(current, stale);
  assert.equal(staleMerged.runtimeProfiles.find((item) => item.id === "profile-shared")?.model, "ws-new");
  assert.equal(staleMerged.runtimeProfiles.find((item) => item.id === "profile-catalog")?.model, "new catalog target");
  assert.equal(staleMerged.participants[0]?.status, "inactive");
  assert.equal(staleMerged.identities[0]?.name, "WS new");
  assert.equal(staleMerged.participants.some((item) => item.id === "participant-deleted-by-ws"), false);
  assert.equal(staleMerged.identities.some((item) => item.id === "identity-deleted-by-ws"), false);
  assert.deepEqual(staleMerged.messages, current.messages);
  assert.deepEqual(staleMerged.messageBlocks, current.messageBlocks);
  assert.equal(staleMerged.lastSeq, current.lastSeq);

  const sameSequence = {
    lastSeq: 12,
    runtimeProfiles: [{ id: "profile-shared", updatedAt: "2026-07-15T13:00:00.000Z", model: "catalog-new" }],
    participants: [{ id: "participant-shared", updatedAt: "2026-07-15T13:00:00.000Z", status: "active" }],
    identities: [{ id: "identity-shared", updatedAt: "2026-07-15T13:00:00.000Z", name: "Catalog new" }],
  };
  const merged = mergeAgentCatalogSnapshot(current, sameSequence);
  assert.equal(merged.runtimeProfiles[0]?.model, "catalog-new");
  assert.equal(merged.participants[0]?.status, "active");
  assert.equal(merged.identities[0]?.name, "Catalog new");
  assert.deepEqual(merged.messages, current.messages);
  assert.deepEqual(merged.messageBlocks, current.messageBlocks);
  assert.equal(merged.lastSeq, current.lastSeq);

  const authoritative = mergeAgentCatalogSnapshot({
    ...current,
    participants: [...current.participants, { id: "participant-removed", updatedAt: "2026-07-15T10:00:00.000Z" }],
    identities: [...current.identities, { id: "identity-removed", updatedAt: "2026-07-15T10:00:00.000Z" }],
    runtimeProfiles: [...current.runtimeProfiles, { id: "profile-removed", updatedAt: "2026-07-15T10:00:00.000Z" }],
  }, {
    ...sameSequence,
    lastSeq: 13,
  });
  assert.equal(authoritative.participants.some((item) => item.id === "participant-removed"), false);
  assert.equal(authoritative.identities.some((item) => item.id === "identity-removed"), false);
  assert.equal(authoritative.runtimeProfiles.some((item) => item.id === "profile-removed"), false);
});
