import type { Message } from "@group-chat/shared";

export function isTimelineMessageRemoved(message: Pick<Message, "status">) {
  return message.status === "deleted" || message.status === "recalled";
}

export function hasTimelineMessages(messages: Array<Pick<Message, "status">>) {
  return messages.some((message) => !isTimelineMessageRemoved(message));
}
