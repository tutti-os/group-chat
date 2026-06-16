import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMentionSpeakingOrder } from "../packages/shared/dist/index.js";

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
