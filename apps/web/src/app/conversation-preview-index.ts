import type { Message } from "@group-chat/shared";

export function buildLatestPreviewMessageIndex(messages: Message[]) {
  const latestByConversationId = new Map<string, Message>();
  for (const message of messages) {
    if (shouldUseMessageForPreview(message) && isNewerPreviewMessage(message, latestByConversationId.get(message.conversationId))) {
      latestByConversationId.set(message.conversationId, message);
    }
  }
  return latestByConversationId;
}

export function shouldUseMessageForPreview(message: Message) {
  return !(message.role === "assistant" && message.status === "cancelled" && !message.content.trim());
}

function isNewerPreviewMessage(message: Message, current: Message | undefined) {
  if (!current) return true;
  const messageTime = resolveMessagePreviewTime(message);
  const currentTime = resolveMessagePreviewTime(current);
  if (messageTime !== currentTime) return messageTime > currentTime;
  if (message.updatedAt !== current.updatedAt) return message.updatedAt > current.updatedAt;
  return message.id > current.id;
}

function resolveMessagePreviewTime(message: Message) {
  const createdAt = Date.parse(message.createdAt);
  if (Number.isFinite(createdAt)) return createdAt;
  const updatedAt = Date.parse(message.updatedAt);
  return Number.isFinite(updatedAt) ? updatedAt : 0;
}
