import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeParticipantDisplayName,
  participantDisplayNameUnits,
  resolveMentionSpeakingOrder,
  truncateParticipantDisplayName,
  uniqueParticipantDisplayNameInRoom,
} from "../packages/shared/dist/index.js";

test("resolveMentionSpeakingOrder keeps room order for a single mention", () => {
  assert.equal(
    resolveMentionSpeakingOrder("sequential", [
      { mentionType: "participant", participantId: "agent-1" },
    ]),
    "sequential",
  );
});

test("resolveMentionSpeakingOrder runs multiple mentions in parallel", () => {
  assert.equal(
    resolveMentionSpeakingOrder("sequential", [
      { mentionType: "participant", participantId: "agent-1" },
      { mentionType: "participant", participantId: "agent-2" },
      { mentionType: "participant", participantId: "agent-3" },
      { mentionType: "participant", participantId: "agent-4" },
    ]),
    "parallel",
  );
});

test("resolveMentionSpeakingOrder runs @all in parallel", () => {
  assert.equal(
    resolveMentionSpeakingOrder("sequential", [{ mentionType: "all", participantId: "all" }]),
    "parallel",
  );
});

test("participant display names are limited to 10 Chinese or 20 English units", () => {
  assert.equal(normalizeParticipantDisplayName("一二三四五六七八九十十一"), "一二三四五六七八九十");
  assert.equal(normalizeParticipantDisplayName("abcdefghijklmnopqrstuvw"), "abcdefghijklmnopqrst");
  assert.equal(participantDisplayNameUnits("开发大哥Agent"), 13);
});

test("participant display name input can keep spaces and counts them as units", () => {
  assert.equal(truncateParticipantDisplayName("Agent ", undefined, { trimTrailing: false }), "Agent ");
  assert.equal(participantDisplayNameUnits("Agent "), 6);
  assert.equal(truncateParticipantDisplayName("abcdefghijklmnopqrs t", undefined, { trimTrailing: false }), "abcdefghijklmnopqrs ");
});

test("unique participant display names keep numeric suffix within the limit", () => {
  const duplicate = uniqueParticipantDisplayNameInRoom("abcdefghijklmnopqrst", [
    { id: "agent-1", displayName: "abcdefghijklmnopqrst", kind: "ai", status: "active" },
  ]);
  assert.equal(duplicate, "abcdefghijklmnopqr 2");
  assert.equal(participantDisplayNameUnits(duplicate), 20);
});
