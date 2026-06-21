import type { Message } from "@group-chat/shared";

export function buildLatestPreviewMessageIndex(messages: Message[]) {
  const latestByConversationId = new Map<string, Message>();
  for (const message of messages) {
    if (shouldUseMessageForPreview(message)) {
      latestByConversationId.set(message.conversationId, message);
    }
  }
  return latestByConversationId;
}

export function shouldUseMessageForPreview(message: Message) {
  return !(message.role === "assistant" && message.status === "cancelled" && !message.content.trim());
}
