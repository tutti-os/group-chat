import type { AgentRun, AgentRunEvent, Message, MessageBlock } from "@group-chat/shared";

export type ProcessSection =
  | { kind: "reasoning"; id: string; content: string; streaming: boolean }
  | { kind: "thinking"; id: string; content: string; streaming: boolean }
  | { kind: "event"; id: string; event: AgentRunEvent };

export type DisplayProcessSection =
  | ProcessSection
  | { kind: "tool_summary"; id: string; count: number; status: AgentRunEvent["status"]; stats: ToolSummaryStats; events: ToolSummaryDisplayEvent[] };

export interface ToolSummaryStats {
  successCount: number;
  failedCount: number;
  runningCount: number;
}

export interface ToolSummaryDisplayEvent {
  event: AgentRunEvent;
  displayStatus: AgentRunEvent["status"];
}

export type ThinkingSection = Extract<ProcessSection, { kind: "reasoning" | "thinking" }>;

export function resolveMessageRunId(message: Message, agentRuns: AgentRun[]) {
  if (message.runId) return message.runId;
  return agentRuns.find((run) => run.assistantMessageId === message.id)?.id ?? null;
}

export function canViewMessageProcess(message: Message) {
  return message.role === "assistant" && message.status !== "deleted" && message.status !== "recalled";
}

function mergeReasoningBlocks(blocks: MessageBlock[]) {
  const reasoningBlocks = blocks
    .filter((block) => block.type === "reasoning" && block.content.trim())
    .slice()
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.createdAt.localeCompare(right.createdAt);
    });
  if (reasoningBlocks.length === 0) return null;
  return {
    id: reasoningBlocks.map((block) => block.id).join(":"),
    content: reasoningBlocks.map((block) => block.content.trim()).filter(Boolean).join("\n\n"),
    streaming: reasoningBlocks.some((block) => block.status === "streaming"),
  };
}

export function collectMessageProcess(
  message: Message,
  blocks: MessageBlock[],
  agentRunEvents: AgentRunEvent[],
  agentRuns: AgentRun[],
): ProcessSection[] {
  const sections: ProcessSection[] = [];
  const mergedReasoning = mergeReasoningBlocks(blocks.filter((block) => block.messageId === message.id));
  if (mergedReasoning) {
    sections.push({
      kind: "reasoning",
      id: mergedReasoning.id,
      content: mergedReasoning.content,
      streaming: mergedReasoning.streaming,
    });
  }

  const runId = resolveMessageRunId(message, agentRuns);
  if (!runId) return sections;

  const runEvents = agentRunEvents
    .filter((event) => event.runId === runId)
    .slice()
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.createdAt.localeCompare(right.createdAt);
    });

  let thinkingBuffer = "";
  let thinkingStreaming = false;
  const skipRunThinking = Boolean(mergedReasoning?.content.trim());

  const flushThinking = () => {
    if (skipRunThinking || (!thinkingBuffer && !thinkingStreaming)) return;
    sections.push({
      kind: "thinking",
      id: `thinking-${runId}-${sections.length}`,
      content: thinkingBuffer,
      streaming: thinkingStreaming,
    });
    thinkingBuffer = "";
    thinkingStreaming = false;
  };

  for (const event of runEvents) {
    if (event.type === "thinking_delta") {
      if (!skipRunThinking) {
        thinkingBuffer += event.content;
        thinkingStreaming = event.status === "streaming" || thinkingStreaming;
      }
      continue;
    }
    flushThinking();
    sections.push({ kind: "event", id: event.id, event });
  }
  flushThinking();

  return sections;
}

export function collectMessageThinking(
  message: Message,
  blocks: MessageBlock[],
  agentRunEvents: AgentRunEvent[],
  agentRuns: AgentRun[] = [],
): ThinkingSection[] {
  return collectMessageProcess(message, blocks, agentRunEvents, agentRuns).filter(
    (section): section is ThinkingSection => section.kind === "reasoning" || section.kind === "thinking",
  );
}

export function messageHasThinking(
  message: Message,
  blocks: MessageBlock[],
  agentRunEvents: AgentRunEvent[],
  agentRuns: AgentRun[] = [],
) {
  return canViewMessageProcess(message) && collectMessageProcess(message, blocks, agentRunEvents, agentRuns).length > 0;
}

export function compactToolExecutionSections(sections: ProcessSection[]): DisplayProcessSection[] {
  const compacted: DisplayProcessSection[] = [];
  const pendingTools = new Map<string, AgentRunEvent["status"]>();
  const pendingEvents: AgentRunEvent[] = [];
  let pendingId = "";

  const flushTools = () => {
    if (pendingTools.size === 0) return;
    const stats = summarizeToolStatuses([...pendingTools.values()]);
    compacted.push({
      kind: "tool_summary",
      id: pendingId || `tool-summary-${compacted.length}`,
      count: pendingTools.size,
      status: resolveToolSummaryStatus(stats),
      stats,
      events: pendingEvents.map((event) => ({
        event,
        displayStatus: resolveToolSummaryDisplayStatus(event, pendingTools),
      })),
    });
    pendingTools.clear();
    pendingEvents.length = 0;
    pendingId = "";
  };

  for (const section of sections) {
    if (section.kind !== "event" || !isToolExecutionEvent(section.event)) {
      flushTools();
      compacted.push(section);
      continue;
    }

    pendingId ||= `tool-summary-${section.id}`;
    const key = toolExecutionKey(section.event);
    pendingEvents.push(section.event);
    const currentStatus = pendingTools.get(key);
    if (section.event.type === "tool_result" || section.event.type === "file_write") {
      pendingTools.set(key, section.event.status === "error" ? "error" : "success");
    } else if (!currentStatus || currentStatus === "pending" || currentStatus === "streaming") {
      pendingTools.set(key, section.event.status);
    }
  }

  flushTools();
  return compacted;
}

function summarizeToolStatuses(statuses: AgentRunEvent["status"][]): ToolSummaryStats {
  return statuses.reduce<ToolSummaryStats>(
    (stats, status) => {
      if (status === "error") {
        stats.failedCount += 1;
      } else if (status === "success") {
        stats.successCount += 1;
      } else {
        stats.runningCount += 1;
      }
      return stats;
    },
    { successCount: 0, failedCount: 0, runningCount: 0 },
  );
}

function resolveToolSummaryStatus(stats: ToolSummaryStats): AgentRunEvent["status"] {
  if (stats.runningCount > 0) return "streaming";
  if (stats.failedCount > 0 && stats.successCount === 0) return "error";
  return "success";
}

function isToolExecutionEvent(event: AgentRunEvent) {
  return event.type === "tool_call" || event.type === "tool_result" || event.type === "file_write";
}

function toolExecutionKey(event: AgentRunEvent) {
  if (typeof event.metadata?.toolCallId === "string") return event.metadata.toolCallId;
  return event.id;
}

function resolveToolSummaryDisplayStatus(event: AgentRunEvent, statuses: Map<string, AgentRunEvent["status"]>) {
  if (event.type !== "tool_call") return event.status;
  const finalStatus = statuses.get(toolExecutionKey(event));
  if (finalStatus === "success" || finalStatus === "error") return finalStatus;
  return event.status;
}
