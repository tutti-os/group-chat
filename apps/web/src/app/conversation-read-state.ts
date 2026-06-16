import type { Message } from "@group-chat/shared";

const STORAGE_KEY = "group-chat:conversation-read-at";

export type ConversationReadAtMap = Record<string, string>;

export function loadConversationReadAt(): ConversationReadAtMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const next: ConversationReadAtMap = {};
    for (const [conversationId, lastReadAt] of Object.entries(parsed)) {
      if (typeof conversationId === "string" && typeof lastReadAt === "string" && lastReadAt) {
        next[conversationId] = lastReadAt;
      }
    }
    return next;
  } catch {
    return {};
  }
}

export function saveConversationReadAt(map: ConversationReadAtMap): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function shouldCountAsUnread(message: Message) {
  if (message.role === "user" || message.role === "system" || message.role === "tool") return false;
  if (message.status === "deleted" || message.status === "recalled") return false;
  if (message.role === "assistant" && message.status === "cancelled" && !message.content.trim()) return false;
  return true;
}

function resolveLatestSeenMessage(conversationId: string, messages: Message[], lastReadAt: string) {
  let latest: Message | null = null;
  for (const message of messages) {
    if (message.conversationId !== conversationId) continue;
    if (message.status === "deleted" || message.status === "recalled") continue;
    if (message.createdAt > lastReadAt) continue;
    if (!latest || message.createdAt > latest.createdAt) {
      latest = message;
    }
  }
  return latest;
}

/** Single-user: unread only when the last seen message was the user's, i.e. they left before an agent reply. */
function isAwaitingAgentReply(conversationId: string, messages: Message[], lastReadAt: string) {
  return resolveLatestSeenMessage(conversationId, messages, lastReadAt)?.role === "user";
}

export function countUnreadMessages(
  conversationId: string,
  messages: Message[],
  lastReadAt: string | null | undefined,
) {
  if (!lastReadAt) return 0;
  if (!isAwaitingAgentReply(conversationId, messages, lastReadAt)) return 0;

  return messages.filter((message) => {
    if (message.conversationId !== conversationId) return false;
    if (!shouldCountAsUnread(message)) return false;
    return message.createdAt > lastReadAt;
  }).length;
}

export function resolveLatestConversationActivityAt(conversationId: string, messages: Message[]) {
  let latest = "";
  for (const message of messages) {
    if (message.conversationId !== conversationId) continue;
    if (message.status === "deleted") continue;
    if (message.createdAt > latest) latest = message.createdAt;
  }
  return latest || new Date().toISOString();
}

export function formatUnreadCount(count: number) {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}
