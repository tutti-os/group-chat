import type { AgentRunEvent } from "@group-chat/shared";
import { t } from "./translate.js";

export function formatRunEventStatus(event: Pick<AgentRunEvent, "type" | "status">) {
  if (event.type === "tool_call" && event.status === "streaming") return t("runEvent.running");
  if (event.type === "tool_call" && event.status === "success") return t("runEvent.called");
  if (event.type === "tool_result" && event.status === "success") return t("runEvent.completed");
  if (event.status === "error") return t("runEvent.failed");
  return event.status;
}

export function formatRunEventTypeLabel(event: Pick<AgentRunEvent, "type">, toolName: string | null) {
  if (event.type === "tool_call") return toolName ?? t("thinkingPanel.toolCall");
  if (event.type === "tool_result") return toolName ?? t("thinkingPanel.toolResult");
  if (event.type === "status") return t("thinkingPanel.status");
  if (event.type === "stderr") return t("thinkingPanel.stderr");
  return event.type;
}
