import assert from "node:assert/strict";
import test from "node:test";

test("parseGroupChatDeepLinkFromLocation reads hash navigation params", async () => {
  const { parseGroupChatDeepLinkFromLocation } = await import("../apps/web/src/app/group-chat-deep-link.ts");
  const link = parseGroupChatDeepLinkFromLocation({
    hash: "#nav?messageId=msg-1&conversationId=conv-1",
    search: "",
  });
  assert.deepEqual(link, {
    messageId: "msg-1",
    conversationId: "conv-1",
  });
});

test("resolveGroupChatDeepLinkFromSnapshot focuses visible messages", async () => {
  const { resolveGroupChatDeepLinkFromSnapshot } = await import("../apps/web/src/app/group-chat-deep-link.ts");
  const outcome = resolveGroupChatDeepLinkFromSnapshot(
    { messageId: "msg-1" },
    {
      conversations: [{ id: "conv-1", roomId: "room-1" }],
      rooms: [{ id: "room-1" }],
      messages: [{ id: "msg-1", conversationId: "conv-1", status: "success" }],
    },
  );
  assert.deepEqual(outcome, {
    kind: "focus_message",
    conversationId: "conv-1",
    messageId: "msg-1",
  });
});

test("resolveGroupChatDeepLinkFromSnapshot opens conversation for deleted messages", async () => {
  const { resolveGroupChatDeepLinkFromSnapshot } = await import("../apps/web/src/app/group-chat-deep-link.ts");
  const outcome = resolveGroupChatDeepLinkFromSnapshot(
    { messageId: "msg-1" },
    {
      conversations: [{ id: "conv-1", roomId: "room-1" }],
      rooms: [{ id: "room-1" }],
      messages: [{ id: "msg-1", conversationId: "conv-1", status: "deleted" }],
    },
  );
  assert.deepEqual(outcome, {
    kind: "open_conversation",
    conversationId: "conv-1",
    reason: "message_unavailable",
  });
});

test("resolveGroupChatDeepLinkFromSnapshot reports deleted rooms", async () => {
  const { resolveGroupChatDeepLinkFromSnapshot } = await import("../apps/web/src/app/group-chat-deep-link.ts");
  const outcome = resolveGroupChatDeepLinkFromSnapshot(
    { messageId: "msg-1", conversationId: "conv-1" },
    {
      conversations: [{ id: "conv-1", roomId: "room-1" }],
      rooms: [],
      messages: [],
    },
  );
  assert.deepEqual(outcome, { kind: "room_deleted" });
});
