import { existsSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import type {
  AppFileReference,
  AppFileReferenceLocation,
  AppReferenceGroup,
  AppReferenceListRequest,
  AppReferenceListResponse,
  AppReferenceListTimeRange,
  Artifact,
  ChatSnapshot,
  Conversation,
  Message,
  Room,
} from "@group-chat/shared";
import { appPaths } from "../local/paths.js";

interface ReferenceListInput {
  parentGroupId: string | null;
  filterText: string;
  limit: number;
  cursor: number;
  kinds: string[];
  timeRange: ReferenceListTimeRange | null;
}

interface ReferenceListTimeRange {
  fromMs?: number;
  toMs?: number;
}

interface AppFileReferenceEntry {
  artifact: Artifact;
  message: Message | undefined;
  reference: AppFileReference;
}

interface RoomReferenceStats {
  referenceCount: number;
  latestReferenceMs: number | null;
}

interface RoomReferenceGroup {
  group: AppReferenceGroup;
  latestConversationMs: number | null;
  latestReferenceMs: number | null;
}

export interface ReferenceListError {
  error: {
    code: string;
    message: string;
  };
}

const DEFAULT_REFERENCE_LIMIT = 20;
const MAX_REFERENCE_LIMIT = 50;
const GROUP_ID_MAX_RUNES = 2048;
const DISPLAY_NAME_MAX_RUNES = 160;
const DESCRIPTION_MAX_RUNES = 500;
const MIME_TYPE_MAX_RUNES = 128;

export function listAppReferences(
  snapshot: ChatSnapshot,
  body: unknown,
): AppReferenceListResponse | ReferenceListError {
  const input = normalizeReferenceListInput(body);
  if (isReferenceListError(input)) return input;
  if (input.kinds.length > 0 && !input.kinds.includes("file")) {
    return { items: [], nextCursor: null };
  }

  const messagesById = new Map(snapshot.messages.map((message) => [message.id, message]));
  const runsById = new Map(snapshot.agentRuns.map((run) => [run.id, run]));
  const conversationsById = new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation]));
  const roomsById = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const entries = snapshot.artifacts
    .map((artifact) =>
      artifactToFileReferenceEntry(
        artifact,
        messagesById.get(artifact.messageId ?? ""),
        runsById,
        conversationsById.get(artifact.conversationId),
        roomsById.get(artifact.roomId),
      )
    )
    .filter((entry): entry is AppFileReferenceEntry => entry !== null);

  if (!input.parentGroupId) {
    return listRoomGroups(snapshot.rooms, snapshot.conversations, entries, input);
  }

  const room = roomsById.get(input.parentGroupId);
  if (!room) return { items: [], nextCursor: null };

  const matchingEntries = entries
    .filter((entry) => entry.artifact.roomId === room.id)
    .filter((entry) => matchesTimeRange(entry.reference.mtimeMs, input.timeRange))
    .filter((entry) => matchesChatFileFilter(entry.artifact, entry.message, input.filterText))
    .sort((left, right) => right.artifact.createdAt.localeCompare(left.artifact.createdAt));

  const page = matchingEntries.slice(input.cursor, input.cursor + input.limit);
  const nextOffset = input.cursor + page.length;
  return {
    items: page.map((entry) => ({
      type: "reference",
      reference: entry.reference,
    })),
    nextCursor: nextOffset < matchingEntries.length ? String(nextOffset) : null,
  };
}

export function isReferenceListError(output: unknown): output is ReferenceListError {
  return isRecord(output) && "error" in output;
}

function listRoomGroups(
  rooms: Room[],
  conversations: Conversation[],
  entries: AppFileReferenceEntry[],
  input: ReferenceListInput,
): AppReferenceListResponse {
  const referenceStatsByRoomId = buildRoomReferenceStats(entries, input.timeRange);
  const latestConversationMsByRoomId = buildLatestConversationMs(conversations);
  const groups = rooms
    .map((room) => roomToReferenceGroup(room, referenceStatsByRoomId, latestConversationMsByRoomId))
    .filter((item) => matchesGroupFilter(item.group, input.filterText))
    .sort(compareRoomReferenceGroups);
  const page = groups.slice(input.cursor, input.cursor + input.limit);
  const nextOffset = input.cursor + page.length;
  return {
    items: page.map((item) => item.group),
    nextCursor: nextOffset < groups.length ? String(nextOffset) : null,
  };
}

function roomToReferenceGroup(
  room: Room,
  referenceStatsByRoomId: Map<string, RoomReferenceStats>,
  latestConversationMsByRoomId: Map<string, number>,
): RoomReferenceGroup {
  const referenceStats = referenceStatsByRoomId.get(room.id) ?? {
    referenceCount: 0,
    latestReferenceMs: null,
  };
  const latestConversationMs =
    latestConversationMsByRoomId.get(room.id) ?? parseTimeMs(room.updatedAt) ?? parseTimeMs(room.createdAt);
  return {
    group: {
      type: "group",
      id: truncateRunes(room.id, GROUP_ID_MAX_RUNES),
      displayName: truncateRunes(room.title || "Untitled room", DISPLAY_NAME_MAX_RUNES),
      description: room.description ? truncateRunes(room.description, DESCRIPTION_MAX_RUNES) : null,
      referenceCount: referenceStats.referenceCount,
    },
    latestConversationMs,
    latestReferenceMs: referenceStats.latestReferenceMs,
  };
}

function buildRoomReferenceStats(
  entries: AppFileReferenceEntry[],
  timeRange: ReferenceListTimeRange | null,
): Map<string, RoomReferenceStats> {
  const statsByRoomId = new Map<string, RoomReferenceStats>();
  for (const entry of entries) {
    if (!matchesTimeRange(entry.reference.mtimeMs, timeRange)) continue;
    const stats = statsByRoomId.get(entry.artifact.roomId) ?? {
      referenceCount: 0,
      latestReferenceMs: null,
    };
    const referenceMs = entry.reference.mtimeMs ?? parseTimeMs(entry.artifact.createdAt);
    stats.referenceCount += 1;
    stats.latestReferenceMs = maxTimeMs(stats.latestReferenceMs, referenceMs);
    statsByRoomId.set(entry.artifact.roomId, stats);
  }
  return statsByRoomId;
}

function buildLatestConversationMs(conversations: Conversation[]): Map<string, number> {
  const latestByRoomId = new Map<string, number>();
  for (const conversation of conversations) {
    const conversationMs =
      parseTimeMs(conversation.lastMessageAt) ?? parseTimeMs(conversation.updatedAt) ?? parseTimeMs(conversation.createdAt);
    if (conversationMs === null) continue;
    const latestMs = maxTimeMs(latestByRoomId.get(conversation.roomId) ?? null, conversationMs);
    latestByRoomId.set(conversation.roomId, latestMs ?? conversationMs);
  }
  return latestByRoomId;
}

function compareRoomReferenceGroups(left: RoomReferenceGroup, right: RoomReferenceGroup) {
  const leftHasReferences = left.group.referenceCount > 0;
  const rightHasReferences = right.group.referenceCount > 0;
  if (leftHasReferences !== rightHasReferences) return leftHasReferences ? -1 : 1;

  const referenceTimeOrder = compareNullableTimeDesc(left.latestReferenceMs, right.latestReferenceMs);
  if (referenceTimeOrder !== 0) return referenceTimeOrder;

  const conversationTimeOrder = compareNullableTimeDesc(left.latestConversationMs, right.latestConversationMs);
  if (conversationTimeOrder !== 0) return conversationTimeOrder;

  return 0;
}

function normalizeReferenceListInput(body: unknown): ReferenceListInput | ReferenceListError {
  if (!isRecord(body)) {
    return referenceError("invalid_input", "Reference list request body must be an object");
  }
  const typed = body as AppReferenceListRequest;
  if (typed.parentGroupId !== undefined && typed.parentGroupId !== null && typeof typed.parentGroupId !== "string") {
    return referenceError("invalid_input", "parentGroupId must be a string or null");
  }
  if (typed.filterText !== undefined && typed.filterText !== null && typeof typed.filterText !== "string") {
    return referenceError("invalid_input", "filterText must be a string or null");
  }
  if (typed.cursor !== undefined && typed.cursor !== null && typeof typed.cursor !== "string") {
    return referenceError("invalid_input", "cursor must be a string or null");
  }
  if (typed.limit !== undefined && (typeof typed.limit !== "number" || !Number.isInteger(typed.limit))) {
    return referenceError("invalid_input", "limit must be an integer");
  }
  if (typed.kinds !== undefined && (!Array.isArray(typed.kinds) || typed.kinds.some((kind) => typeof kind !== "string"))) {
    return referenceError("invalid_input", "kinds must be an array of strings");
  }
  const timeRange = normalizeTimeRange(typed.timeRange);
  if (isReferenceListError(timeRange)) return timeRange;
  const cursor = typed.cursor?.trim() ? Number(typed.cursor) : 0;
  if (!Number.isInteger(cursor) || cursor < 0) {
    return referenceError("invalid_input", "cursor must be a non-negative integer string");
  }
  const parentGroupId = typed.parentGroupId?.trim() || null;
  return {
    parentGroupId: parentGroupId ? truncateRunes(parentGroupId, GROUP_ID_MAX_RUNES) : null,
    filterText: (typed.filterText ?? "").trim().toLocaleLowerCase().slice(0, 200),
    limit: clampLimit(typed.limit ?? DEFAULT_REFERENCE_LIMIT),
    cursor,
    kinds: (typed.kinds ?? []).map((kind) => kind.trim()).filter(Boolean),
    timeRange,
  };
}

function normalizeTimeRange(value: AppReferenceListTimeRange | null | undefined): ReferenceListTimeRange | null | ReferenceListError {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    return referenceError("invalid_input", "timeRange must be an object or null");
  }
  const out: ReferenceListTimeRange = {};
  if (value.fromMs !== undefined) {
    if (typeof value.fromMs !== "number" || !Number.isInteger(value.fromMs) || value.fromMs < 0) {
      return referenceError("invalid_input", "timeRange.fromMs must be a non-negative integer");
    }
    out.fromMs = value.fromMs;
  }
  if (value.toMs !== undefined) {
    if (typeof value.toMs !== "number" || !Number.isInteger(value.toMs) || value.toMs < 0) {
      return referenceError("invalid_input", "timeRange.toMs must be a non-negative integer");
    }
    out.toMs = value.toMs;
  }
  if (out.fromMs !== undefined && out.toMs !== undefined && out.fromMs > out.toMs) {
    return referenceError("invalid_input", "timeRange.fromMs must be less than or equal to timeRange.toMs");
  }
  return out;
}

function artifactToFileReferenceEntry(
  artifact: Artifact,
  message: Message | undefined,
  runsById: Map<string, { visibility: "public" | "whisper" }>,
  conversation: Conversation | undefined,
  room: Room | undefined,
): AppFileReferenceEntry | null {
  if (!isPublicArtifact(artifact, message, runsById)) return null;
  if (!existsSync(artifact.localPath)) return null;
  const location = appDataRelativeLocation(artifact.localPath);
  if (!location) return null;
  let stat;
  try {
    stat = statSync(artifact.localPath);
  } catch {
    return null;
  }
  const description = [
    conversation?.title || room?.title || "Group Chat",
    artifact.kind,
    artifact.textPreview ? truncateRunes(artifact.textPreview, 160) : "",
  ]
    .filter(Boolean)
    .join(" - ");
  return {
    artifact,
    message,
    reference: {
      kind: "file",
      displayName: truncateRunes(artifact.filename, DISPLAY_NAME_MAX_RUNES),
      description: truncateRunes(description, DESCRIPTION_MAX_RUNES),
      location,
      sizeBytes: artifact.sizeBytes,
      mtimeMs: Math.trunc(stat.mtimeMs),
      mimeType: truncateRunes(artifact.mimeType, MIME_TYPE_MAX_RUNES),
    },
  };
}

function appDataRelativeLocation(localPath: string): AppFileReferenceLocation | null {
  const normalized = relative(appPaths.root, localPath).split(sep).join("/");
  if (!normalized || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) return null;
  if (normalized.includes("\0")) return null;
  return {
    type: "app-data-relative",
    path: normalized,
  };
}

function matchesGroupFilter(group: AppReferenceGroup, filterText: string) {
  if (!filterText) return true;
  return [group.id, group.displayName, group.description ?? ""]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase()
    .includes(filterText);
}

function matchesChatFileFilter(artifact: Artifact, message: Message | undefined, filterText: string) {
  if (!filterText) return true;
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
    .includes(filterText);
}

function matchesTimeRange(mtimeMs: number | undefined, timeRange: ReferenceListTimeRange | null) {
  if (!timeRange) return true;
  if (mtimeMs === undefined) return false;
  if (timeRange.fromMs !== undefined && mtimeMs < timeRange.fromMs) return false;
  if (timeRange.toMs !== undefined && mtimeMs > timeRange.toMs) return false;
  return true;
}

function compareNullableTimeDesc(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function maxTimeMs(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function parseTimeMs(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function formatMessageSender(message: Message) {
  if (message.role === "user") return "我";
  return message.senderName || message.role;
}

function isPublicArtifact(
  artifact: Artifact,
  message: Message | undefined,
  runById: Map<string, { visibility: "public" | "whisper" }>,
) {
  if (artifact.messageId) {
    return message?.visibility === "public";
  }
  if (artifact.sourceRunId) {
    return runById.get(artifact.sourceRunId)?.visibility === "public";
  }
  return false;
}

function referenceError(code: string, message: string): ReferenceListError {
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
