import { participantWorkspaceRoot } from "../local/paths.js";
import type { RuntimeReplyContext } from "./runtime-provider.js";

export const LOCAL_AGENT_PROTOCOL_VERSION = "group-chat.local-agent.v1";
export const NO_REPLY_MARKER = "[NO_REPLY]";

export interface LocalAgentInput {
  protocolVersion: typeof LOCAL_AGENT_PROTOCOL_VERSION;
  runId: string | undefined;
  workspaceRoot: string;
  conversation: RuntimeReplyContext["conversation"];
  participant: RuntimeReplyContext["participant"];
  identity: RuntimeReplyContext["identity"];
  runtimeProfile: RuntimeReplyContext["runtimeProfile"];
  turn: {
    kind: "message";
    userMessage: RuntimeReplyContext["userMessage"];
    attachments: RuntimeReplyContext["attachments"];
  };
  workspaceFiles: {
    instructions: "AGENTS.md";
    claudeInstructions: "CLAUDE.md";
    bootstrap: "BOOTSTRAP.md";
    identity: "IDENTITY.md";
    soul: "SOUL.md";
    memory: "MEMORY.md";
    distilledContext: "DISTILLED_CONTEXT.md";
    conversationSummaryPattern: "conversations/{conversationId}.summary.md";
  };
  tools: {
    baseUrl: string;
    token: string | undefined;
    expiresAt: string | undefined;
    contextUrl: string;
    artifactUrlTemplate: string;
    sendMessageUrl: string;
    saveArtifactUrl: string;
  };
  replyContract: {
    noReplyMarker: typeof NO_REPLY_MARKER;
    stdout: {
      text: "Plain stdout is treated as assistant text.";
      jsonl: LocalAgentOutputEvent["type"][];
    };
  };
}

export type LocalAgentOutputEvent =
  | { type: "text_delta"; text: string }
  | { type: "final_text"; text: string }
  | { type: "no_reply"; reason?: string }
  | { type: "error"; message: string };

export function buildLocalAgentInput(context: RuntimeReplyContext): LocalAgentInput {
  const workspaceRoot = participantWorkspaceRoot(context.conversation.roomId, context.participant.id);
  const baseUrl = localToolBaseUrl();
  return {
    protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
    runId: context.runId,
    workspaceRoot,
    conversation: context.conversation,
    participant: context.participant,
    identity: context.identity,
    runtimeProfile: context.runtimeProfile,
    turn: {
      kind: "message",
      userMessage: context.userMessage,
      attachments: context.attachments,
    },
    workspaceFiles: {
      instructions: "AGENTS.md",
      claudeInstructions: "CLAUDE.md",
      bootstrap: "BOOTSTRAP.md",
      identity: "IDENTITY.md",
      soul: "SOUL.md",
      memory: "MEMORY.md",
      distilledContext: "DISTILLED_CONTEXT.md",
      conversationSummaryPattern: "conversations/{conversationId}.summary.md",
    },
    tools: {
      baseUrl,
      token: context.toolAccess?.token,
      expiresAt: context.toolAccess?.expiresAt,
      contextUrl: toolUrl(baseUrl, context.participant.id, "context", context.toolAccess?.token),
      artifactUrlTemplate: toolUrl(baseUrl, context.participant.id, "artifacts/{artifactId}", context.toolAccess?.token),
      sendMessageUrl: toolUrl(baseUrl, context.participant.id, "messages", context.toolAccess?.token),
      saveArtifactUrl: toolUrl(baseUrl, context.participant.id, "artifacts", context.toolAccess?.token),
    },
    replyContract: {
      noReplyMarker: NO_REPLY_MARKER,
      stdout: {
        text: "Plain stdout is treated as assistant text.",
        jsonl: ["text_delta", "final_text", "no_reply", "error"],
      },
    },
  };
}

export async function* decodeLocalAgentStdout(stream: AsyncIterable<string | Buffer>) {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += String(chunk);
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      yield* decodeLocalAgentLine(line, true);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  if (buffer) yield* decodeLocalAgentLine(buffer, false);
}

function* decodeLocalAgentLine(line: string, hadNewline: boolean): Generator<string> {
  const event = parseLocalAgentOutputEvent(line);
  if (!event) {
    yield hadNewline ? `${line}\n` : line;
    return;
  }
  if (event.type === "text_delta" || event.type === "final_text") {
    yield event.text;
    return;
  }
  if (event.type === "no_reply") {
    yield NO_REPLY_MARKER;
    return;
  }
  throw new Error(event.message);
}

function parseLocalAgentOutputEvent(line: string): LocalAgentOutputEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<LocalAgentOutputEvent>;
    if (parsed.type === "text_delta" && typeof parsed.text === "string") return parsed as LocalAgentOutputEvent;
    if (parsed.type === "final_text" && typeof parsed.text === "string") return parsed as LocalAgentOutputEvent;
    if (parsed.type === "no_reply") return { type: "no_reply", reason: typeof parsed.reason === "string" ? parsed.reason : undefined };
    if (parsed.type === "error" && typeof parsed.message === "string") return parsed as LocalAgentOutputEvent;
  } catch {
    return null;
  }
  return null;
}

export function localToolBaseUrl() {
  return process.env.GROUP_CHAT_SERVER_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8788}`;
}

function toolUrl(baseUrl: string, participantId: string, route: "context" | "messages" | "artifacts" | "artifacts/{artifactId}", token: string | undefined) {
  const url = `${baseUrl}/api/agent-tools/participants/${participantId}/${route}`;
  return token ? `${url}?toolToken=${encodeURIComponent(token)}` : url;
}
