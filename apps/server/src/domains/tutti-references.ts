import { existsSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import type {
  AppFileReference,
  AppReferenceSearchRequest,
  AppReferenceSearchResponse,
  Artifact,
  ChatSnapshot,
  Conversation,
  Message,
  Room,
} from "@group-chat/shared";
import { appPaths } from "../local/paths.js";

interface ReferenceSearchInput {
  query: string;
  limit: number;
  cursor: number;
  kinds: string[];
}

export interface ReferenceSearchError {
  error: {
    code: string;
    message: string;
  };
}

const DEFAULT_REFERENCE_LIMIT = 20;
const MAX_REFERENCE_LIMIT = 50;
const DISPLAY_NAME_MAX_RUNES = 160;
const DESCRIPTION_MAX_RUNES = 500;
const MIME_TYPE_MAX_RUNES = 128;

export function searchAppReferences(
  snapshot: ChatSnapshot,
  body: unknown,
): AppReferenceSearchResponse | ReferenceSearchError {
  const input = normalizeReferenceSearchInput(body);
  if (isReferenceSearchError(input)) return input;
  if (input.kinds.length > 0 && !input.kinds.includes("file")) {
    return { references: [] };
  }

  const messagesById = new Map(snapshot.messages.map((message) => [message.id, message]));
  const runsById = new Map(snapshot.agentRuns.map((run) => [run.id, run]));
  const conversationsById = new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation]));
  const roomsById = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const matchingArtifacts = snapshot.artifacts
    .filter((artifact) => isPublicArtifact(artifact, messagesById, runsById))
    .filter((artifact) => matchesChatFileQuery(artifact, messagesById.get(artifact.messageId ?? ""), input.query))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const page = matchingArtifacts.slice(input.cursor, input.cursor + input.limit);
  const references = page
    .map((artifact) =>
      artifactToFileReference(
        artifact,
        conversationsById.get(artifact.conversationId),
        roomsById.get(artifact.roomId),
      )
    )
    .filter((reference): reference is AppFileReference => reference !== null);
  const nextOffset = input.cursor + page.length;
  return {
    references,
    ...(nextOffset < matchingArtifacts.length ? { nextCursor: String(nextOffset) } : {}),
  };
}

export function isReferenceSearchError(
  output: AppReferenceSearchResponse | ReferenceSearchError | ReferenceSearchInput,
): output is ReferenceSearchError {
  return "error" in output;
}

function normalizeReferenceSearchInput(body: unknown): ReferenceSearchInput | ReferenceSearchError {
  if (!isRecord(body)) {
    return referenceError("invalid_input", "Reference search request body must be an object");
  }
  const typed = body as AppReferenceSearchRequest;
  if (typed.query !== undefined && typeof typed.query !== "string") {
    return referenceError("invalid_input", "query must be a string");
  }
  if (typed.cursor !== undefined && typeof typed.cursor !== "string") {
    return referenceError("invalid_input", "cursor must be a string");
  }
  if (typed.limit !== undefined && (typeof typed.limit !== "number" || !Number.isInteger(typed.limit))) {
    return referenceError("invalid_input", "limit must be an integer");
  }
  if (typed.kinds !== undefined && (!Array.isArray(typed.kinds) || typed.kinds.some((kind) => typeof kind !== "string"))) {
    return referenceError("invalid_input", "kinds must be an array of strings");
  }
  const cursor = typed.cursor?.trim() ? Number(typed.cursor) : 0;
  if (!Number.isInteger(cursor) || cursor < 0) {
    return referenceError("invalid_input", "cursor must be a non-negative integer string");
  }
  return {
    query: (typed.query ?? "").trim().toLocaleLowerCase().slice(0, 200),
    limit: clampLimit(typed.limit ?? DEFAULT_REFERENCE_LIMIT),
    cursor,
    kinds: (typed.kinds ?? []).map((kind) => kind.trim()).filter(Boolean),
  };
}

function artifactToFileReference(
  artifact: Artifact,
  conversation: Conversation | undefined,
  room: Room | undefined,
): AppFileReference | null {
  if (!existsSync(artifact.localPath)) return null;
  const path = appDataRelativePath(artifact.localPath);
  if (!path) return null;
  const stat = statSync(artifact.localPath);
  const description = [
    conversation?.title || room?.title || "Group Chat",
    artifact.kind,
    artifact.textPreview ? truncateRunes(artifact.textPreview, 160) : "",
  ]
    .filter(Boolean)
    .join(" - ");
  return {
    kind: "file",
    displayName: truncateRunes(artifact.filename, DISPLAY_NAME_MAX_RUNES),
    description: truncateRunes(description, DESCRIPTION_MAX_RUNES),
    location: {
      type: "app-data-relative",
      path,
    },
    sizeBytes: artifact.sizeBytes,
    mtimeMs: Math.trunc(stat.mtimeMs),
    mimeType: truncateRunes(artifact.mimeType, MIME_TYPE_MAX_RUNES),
  };
}

function appDataRelativePath(localPath: string) {
  const normalized = relative(appPaths.root, localPath).split(sep).join("/");
  if (!normalized || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) return null;
  if (normalized.includes("\0")) return null;
  return normalized;
}

function matchesChatFileQuery(artifact: Artifact, message: Message | undefined, query: string) {
  if (!query) return true;
  return [
    artifact.id,
    artifact.filename,
    artifact.mimeType,
    artifact.kind,
    artifact.textPreview,
    message ? formatMessageSender(message) : "",
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase()
    .includes(query);
}

function formatMessageSender(message: Message) {
  if (message.role === "user") return "我";
  return message.senderName || message.role;
}

function isPublicArtifact(
  artifact: Artifact,
  messageById: Map<string, Message>,
  runById: Map<string, { visibility: "public" | "whisper" }>,
) {
  if (artifact.messageId) {
    return messageById.get(artifact.messageId)?.visibility === "public";
  }
  if (artifact.sourceRunId) {
    return runById.get(artifact.sourceRunId)?.visibility === "public";
  }
  return false;
}

function referenceError(code: string, message: string): ReferenceSearchError {
  return {
    error: {
      code,
      message,
    },
  };
}

function clampLimit(value: number) {
  return Math.max(1, Math.min(MAX_REFERENCE_LIMIT, Math.trunc(value)));
}

function truncateRunes(value: string, maxRunes: number) {
  const runes = [...value];
  if (runes.length <= maxRunes) return value;
  return runes.slice(0, maxRunes).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
