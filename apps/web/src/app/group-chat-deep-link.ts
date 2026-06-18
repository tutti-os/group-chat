export interface GroupChatDeepLink {
  conversationId?: string;
  messageId?: string;
  summaryTaskId?: string;
}

export type GroupChatDeepLinkOutcome =
  | { kind: "focus_message"; conversationId: string; messageId: string }
  | { kind: "open_conversation"; conversationId: string; reason: "message_unavailable" }
  | { kind: "room_deleted" }
  | { kind: "not_found" };

export interface GroupChatDeepLinkSnapshot {
  conversations: ReadonlyArray<{ id: string; roomId: string }>;
  messages: ReadonlyArray<{ id: string; conversationId: string; status: string }>;
  rooms: ReadonlyArray<{ id: string }>;
}

const DEEP_LINK_HASH_PREFIX = "nav?";

export function parseGroupChatDeepLinkFromLocation(location: Pick<Location, "hash" | "search">): GroupChatDeepLink | null {
  const fromHash = parseGroupChatDeepLinkFromSearch(location.hash.replace(/^#/, ""));
  if (fromHash) return fromHash;
  return parseGroupChatDeepLinkFromSearch(location.search.replace(/^\?/, ""));
}

function parseGroupChatDeepLinkFromSearch(raw: string): GroupChatDeepLink | null {
  const query = raw.startsWith(DEEP_LINK_HASH_PREFIX)
    ? raw.slice(DEEP_LINK_HASH_PREFIX.length)
    : raw;
  if (!query.trim()) return null;

  const params = new URLSearchParams(query);
  const messageId = params.get("messageId")?.trim() || undefined;
  const summaryTaskId = params.get("summaryTaskId")?.trim() || undefined;
  const conversationId = params.get("conversationId")?.trim() || undefined;
  if (!messageId && !summaryTaskId) return null;
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(summaryTaskId ? { summaryTaskId } : {}),
  };
}

export function buildGroupChatDeepLinkHash(link: GroupChatDeepLink): string {
  const params = new URLSearchParams();
  if (link.messageId) params.set("messageId", link.messageId);
  if (link.summaryTaskId) params.set("summaryTaskId", link.summaryTaskId);
  if (link.conversationId) params.set("conversationId", link.conversationId);
  const query = params.toString();
  return query ? `${DEEP_LINK_HASH_PREFIX}${query}` : "";
}

export function clearGroupChatDeepLinkFromLocation(location: Location = window.location): void {
  const nextUrl = new URL(location.href);
  nextUrl.hash = "";
  if (nextUrl.searchParams.has("messageId") || nextUrl.searchParams.has("summaryTaskId") || nextUrl.searchParams.has("conversationId")) {
    nextUrl.searchParams.delete("messageId");
    nextUrl.searchParams.delete("summaryTaskId");
    nextUrl.searchParams.delete("conversationId");
  }
  const next = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  window.history.replaceState(window.history.state, "", next);
}

export function subscribeGroupChatDeepLink(listener: (link: GroupChatDeepLink) => void): () => void {
  const notify = () => {
    const link = parseGroupChatDeepLinkFromLocation(window.location);
    if (link) listener(link);
  };
  window.addEventListener("hashchange", notify);
  return () => {
    window.removeEventListener("hashchange", notify);
  };
}

export function resolveGroupChatDeepLinkFromSnapshot(
  link: GroupChatDeepLink,
  snapshot: GroupChatDeepLinkSnapshot,
): GroupChatDeepLinkOutcome | null {
  if (!link.messageId) return null;

  const message = snapshot.messages.find((item) => item.id === link.messageId) ?? null;
  const conversationId = message?.conversationId ?? link.conversationId ?? null;
  if (!conversationId) return null;

  const conversation = snapshot.conversations.find((item) => item.id === conversationId) ?? null;
  if (!conversation || !snapshot.rooms.some((room) => room.id === conversation.roomId)) {
    return { kind: "room_deleted" };
  }

  if (!message || message.status === "deleted" || message.status === "recalled") {
    return { kind: "open_conversation", conversationId, reason: "message_unavailable" };
  }

  return { kind: "focus_message", conversationId, messageId: link.messageId };
}

export function mapMessageDeepLinkResponse(
  response: import("../api/client.js").MessageDeepLinkResponse,
): GroupChatDeepLinkOutcome {
  switch (response.outcome) {
    case "ok":
      return {
        kind: "focus_message",
        conversationId: response.conversationId,
        messageId: response.messageId,
      };
    case "message_unavailable":
      return {
        kind: "open_conversation",
        conversationId: response.conversationId,
        reason: "message_unavailable",
      };
    case "room_deleted":
      return { kind: "room_deleted" };
    default:
      return { kind: "not_found" };
  }
}
