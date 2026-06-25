import { participantWorkspaceRoot } from "../local/paths.js";
import {
  resolveMentionTargetReferenceLabel,
  resolveMentionTargetReferenceScope,
  sanitizeMentionTargetForAgentContext,
} from "@group-chat/shared";
import type { RuntimeReplyContext } from "./runtime-provider.js";

export const LOCAL_AGENT_PROTOCOL_VERSION = "group-chat.local-agent.v1";
export const NO_REPLY_MARKER = "[NO_REPLY]";

type WorkspaceAppIntent = {
  addressedAgent: {
    participantId: string;
    displayName: string;
  };
  requestText: string;
  workspaceApps: Array<{
    appId: string;
    label: string;
    scope?: Readonly<Record<string, string>>;
  }>;
  instruction: string;
};

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
    intent?: WorkspaceAppIntent;
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
  const userMessage = {
    ...context.userMessage,
    content: stripGeneratedReplyQuoteMarkers(context.userMessage.content),
  };
  const intent = resolveWorkspaceAppIntent(context, userMessage.content);
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
      userMessage,
      attachments: context.attachments,
      ...(intent ? { intent } : {}),
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

export function resolveWorkspaceAppIntent(
  context: RuntimeReplyContext,
  content = context.userMessage.content,
): WorkspaceAppIntent | null {
  const workspaceApps = context.userMessage.mentions
    .filter((mention) =>
      mention.mentionType === "reference"
      && mention.referenceProviderId === "workspace-app"
      && mention.referenceEntityId?.trim()
    )
    .map((mention) => {
      const sanitizedMention = sanitizeMentionTargetForAgentContext(mention);
      return {
        appId: sanitizedMention.referenceEntityId!.trim(),
        label: resolveMentionTargetReferenceLabel(sanitizedMention) || sanitizedMention.referenceEntityId!.trim(),
        scope: resolveMentionTargetReferenceScope(sanitizedMention),
      };
    });
  if (!workspaceApps.length) return null;

  const addressed = context.userMessage.mentions.some((mention) =>
    mention.mentionType === "participant" && mention.participantId === context.participant.id,
  );
  if (!addressed && !context.userMessage.mentions.some((mention) => mention.mentionType === "all")) return null;

  const requestText = stripLeadingIntentMentions(stripGeneratedReplyQuoteMarkers(content), context);
  const appLabels = workspaceApps.map((app) => `${app.label} (${app.appId})`).join(", ");
  return {
    addressedAgent: {
      participantId: context.participant.id,
      displayName: context.participant.displayName,
    },
    requestText,
    workspaceApps,
    instruction: [
      `The user addressed ${context.participant.displayName} and referenced workspace app(s): ${appLabels}.`,
      `Interpret the remaining request as: ${requestText || "(empty request)"}.`,
      "The Group Chat host invokes directly supported workspace app(s) when possible. Do not start a duplicate app run only because the app was mentioned; use visible app status/result if present, and reply with concise process and result context for the user.",
      "Do not treat the app label as a generic design keyword, Figma document, shell command, or MCP server name.",
      workspaceApps.some((app) => app.appId === "vibe-design")
        ? "For vibe-design, the intended execution path is the Tutti Prototype Design workspace app workflow for creating or editing a prototype/site/app."
        : "",
    ].filter(Boolean).join(" "),
  };
}

export function stripGeneratedReplyQuoteMarkers(content: string) {
  return content.replace(/^[ \t]*>\s?(?=(?:回复|Reply)\s+[^:：]+[:：])/gim, "");
}

function stripLeadingIntentMentions(content: string, context: RuntimeReplyContext) {
  let result = content.trim();
  const mentionLabels = context.userMessage.mentions
    .filter((mention) => mention.mentionType === "participant" || mention.referenceProviderId === "workspace-app")
    .map((mention) => mention.displayNameSnapshot.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  let changed = true;
  while (changed) {
    changed = false;
    const before = result;
    result = result
      .replace(/^\s*\[[^\]]+\]\((?:mention:\/\/workspace-app\/|group-chat:\/\/reference\/workspace-app\/)[^)]+\)\s*/i, "")
      .replace(/^\s*@[^\s@]+\s*/u, "")
      .trim();
    for (const label of mentionLabels) {
      result = stripLeadingPlainLabel(result, label);
    }
    changed = result !== before;
  }
  return result.trim();
}

function stripLeadingPlainLabel(value: string, label: string) {
  const normalized = value.trimStart();
  const escaped = escapeRegExp(label);
  return normalized
    .replace(new RegExp(`^@?${escaped}\\s*`, "u"), "")
    .trimStart();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
