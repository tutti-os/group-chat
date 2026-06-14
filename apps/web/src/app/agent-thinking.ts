import type { AgentRun, AgentRunEvent, Message, MessageBlock } from "@group-chat/shared";

export type ProcessSection =
  | { kind: "reasoning"; id: string; content: string; streaming: boolean }
  | { kind: "thinking"; id: string; content: string; streaming: boolean }
  | { kind: "event"; id: string; event: AgentRunEvent };

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
