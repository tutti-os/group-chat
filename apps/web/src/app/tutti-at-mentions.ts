import type { AppReferenceListResponse, Artifact, TuttiAtProviderId, TuttiReferenceInsert } from "@group-chat/shared";
import { TUTTI_AT_PROVIDER_IDS } from "@group-chat/shared";
import type { TuttiExternalAtQueryResult } from "@tutti-os/workspace-external-core/contracts";
import { queryTuttiExternalAtRichTextTriggerItems } from "@tutti-os/workspace-external-core/rich-text";
import { resolveArtifactPublicUrl } from "./artifact-actions.js";
import { listAppReferences } from "../api/client.js";

export type TuttiAtRoomFileMeta = {
  artifactId: string;
  messageId?: string;
  mimeType: string;
  previewUrl: string;
};

export type TuttiAtQueryResult = TuttiExternalAtQueryResult & {
  roomFile?: TuttiAtRoomFileMeta;
};

export function tuttiAtMentionKey(providerId: TuttiAtProviderId, itemId: string) {
  return `tutti-at:${providerId}:${itemId}`;
}

export function resolveMentionThumbnailUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith("http://")
    || trimmed.startsWith("https://")
    || trimmed.startsWith("tutti-asset://")
    || trimmed.startsWith("data:")
  ) {
    return trimmed;
  }
  return resolveArtifactPublicUrl(trimmed);
}

export function parseTuttiAtMentionKey(value: string): { providerId: TuttiAtProviderId; itemId: string } | null {
  const match = /^tutti-at:([^:]+):(.+)$/.exec(value);
  if (!match) return null;
  const providerId = match[1] as TuttiAtProviderId;
  if (!TUTTI_AT_PROVIDER_IDS.includes(providerId)) return null;
  return { providerId, itemId: match[2]! };
}

export function scoreTuttiAtMentionMatch(item: TuttiAtQueryResult, keyword: string) {
  const query = keyword.trim().toLowerCase();
  if (!query) return 0;

  const label = item.label.toLowerCase();
  if (label === query) return 1000;
  if (label.startsWith(query)) return 900;
  if (label.includes(query)) return 800;

  const itemId = item.itemId.toLowerCase();
  if (itemId.includes(query)) return 700;

  const subtitle = item.subtitle?.toLowerCase() ?? "";
  if (subtitle.includes(query)) return 500;

  const mimeType = item.roomFile?.mimeType.toLowerCase() ?? "";
  if (mimeType.includes(query)) return 100;

  return 0;
}

const STABLE_HOST_PROVIDERS = new Set<TuttiAtProviderId>([
  "workspace-app",
  "agent-session",
  "agent-generated-file",
  "workspace-issue",
]);

const STABLE_HOST_MENTION_CACHE_LIMIT = 50;
const ROOM_FILE_MENTION_CACHE_LIMIT = 200;

const stableHostMentionCache = new Map<string, TuttiAtQueryResult[]>();

type RoomFileMentionCacheEntry = {
  fingerprint: string;
  items: TuttiAtQueryResult[];
};

const roomFileMentionCache = new Map<string, RoomFileMentionCacheEntry>();

export function roomFileMentionCacheFingerprint(
  artifacts: ReadonlyArray<Pick<Artifact, "id" | "roomId">>,
  roomId: string,
) {
  return artifacts
    .filter((artifact) => artifact.roomId === roomId)
    .map((artifact) => artifact.id)
    .sort()
    .join("\0");
}

export function isRoomFileMentionCacheReady(roomId: string, fingerprint: string) {
  const cached = roomFileMentionCache.get(roomId);
  return cached?.fingerprint === fingerprint;
}

function hostProviderCacheKey(providers: readonly TuttiAtProviderId[]) {
  return [...providers].sort().join("\0");
}

function isStableHostProviderQuery(providers: readonly TuttiAtProviderId[]) {
  return providers.length > 0 && providers.every((providerId) => STABLE_HOST_PROVIDERS.has(providerId));
}

export function isTuttiAtMentionCacheReady(
  providers: readonly TuttiAtProviderId[],
  options?: {
    roomId?: string | null;
    roomFileFingerprint?: string;
  },
) {
  const hasFileProvider = providers.includes("file");
  if (hasFileProvider) {
    if (!options?.roomId || options.roomFileFingerprint === undefined) return false;
    if (!isRoomFileMentionCacheReady(options.roomId, options.roomFileFingerprint)) return false;
  }
  const hostProviders = providers.filter((providerId) => providerId !== "file");
  if (hostProviders.length === 0) return hasFileProvider;
  if (!isStableHostProviderQuery(hostProviders)) return false;
  return stableHostMentionCache.has(hostProviderCacheKey(hostProviders));
}

export function readCachedTuttiAtMentions(input: {
  keyword: string;
  roomId?: string | null;
  maxResults?: number;
  providers?: readonly TuttiAtProviderId[];
  roomArtifacts?: ReadonlyArray<Pick<Artifact, "id" | "roomId" | "createdAt">>;
}): TuttiAtQueryResult[] | null {
  const keyword = input.keyword.trim();
  const maxResults = Math.max(1, input.maxResults ?? 20);
  const providers = input.providers?.length ? input.providers : [...TUTTI_AT_PROVIDER_IDS];
  const results: TuttiAtQueryResult[] = [];
  const seen = new Set<string>();
  const roomArtifacts = input.roomArtifacts?.filter((artifact) => artifact.roomId === input.roomId) ?? [];

  const push = (item: TuttiAtQueryResult) => {
    const key = tuttiAtMentionKey(item.providerId, item.itemId);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  if (input.roomId && providers.includes("file")) {
    const fingerprint = roomFileMentionCacheFingerprint(roomArtifacts, input.roomId);
    const cached = roomFileMentionCache.get(input.roomId);
    if (!cached || cached.fingerprint !== fingerprint) return null;
    for (const item of finalizeRoomFileMentions(cached.items, keyword, maxResults, roomArtifacts)) {
      push(item);
    }
  }

  const hostProviders = providers.filter((providerId) => providerId !== "file");
  if (hostProviders.length > 0) {
    if (!isStableHostProviderQuery(hostProviders)) return null;
    const cached = stableHostMentionCache.get(hostProviderCacheKey(hostProviders));
    if (!cached) return null;
    for (const item of sortTuttiAtMentionResults(filterTuttiAtMentionsByKeyword(cached, keyword), keyword).slice(0, maxResults)) {
      push(item);
    }
  }

  return sortTuttiAtMentionResults(results, keyword, roomArtifacts).slice(0, maxResults);
}

function filterTuttiAtMentionsByKeyword(items: readonly TuttiAtQueryResult[], keyword: string) {
  const query = keyword.trim();
  if (!query) return [...items];
  return items.filter((item) => scoreTuttiAtMentionMatch(item, query) > 0);
}

async function queryStableHostAtMentions(
  keyword: string,
  maxResults: number,
  providers: readonly TuttiAtProviderId[],
  forceRefresh = false,
): Promise<TuttiAtQueryResult[]> {
  const cacheKey = hostProviderCacheKey(providers);
  let cached = stableHostMentionCache.get(cacheKey);
  if (!cached || forceRefresh) {
    cached = await queryHostAtMentions("", STABLE_HOST_MENTION_CACHE_LIMIT, providers);
    stableHostMentionCache.set(cacheKey, cached);
  }
  return sortTuttiAtMentionResults(filterTuttiAtMentionsByKeyword(cached, keyword), keyword).slice(0, maxResults);
}

export async function queryTuttiAtMentions(input: {
  keyword: string;
  roomId?: string | null;
  maxResults?: number;
  providers?: readonly TuttiAtProviderId[];
  roomArtifacts?: ReadonlyArray<Pick<Artifact, "id" | "roomId" | "createdAt">>;
  forceRefresh?: boolean;
}): Promise<TuttiAtQueryResult[]> {
  const keyword = input.keyword.trim();
  const maxResults = Math.max(1, input.maxResults ?? 20);
  const providers = input.providers?.length ? input.providers : [...TUTTI_AT_PROVIDER_IDS];
  const providerSet = new Set<TuttiAtProviderId>(providers);
  const results: TuttiAtQueryResult[] = [];
  const seen = new Set<string>();
  const roomArtifacts = input.roomArtifacts?.filter((artifact) => artifact.roomId === input.roomId) ?? [];
  const roomFileFingerprint = input.roomId
    ? roomFileMentionCacheFingerprint(roomArtifacts, input.roomId)
    : "";

  const push = (item: TuttiAtQueryResult) => {
    const key = tuttiAtMentionKey(item.providerId, item.itemId);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  if (input.roomId && providerSet.has("file")) {
    const localFiles = await queryLocalRoomFileReferences(
      input.roomId,
      keyword,
      maxResults,
      roomFileFingerprint,
      roomArtifacts,
      input.forceRefresh ?? false,
    );
    for (const item of localFiles) {
      push(item);
    }
  }

  const hostProviders = providers.filter((providerId) => providerId !== "file");
  if (hostProviders.length > 0) {
    const hostItems = isStableHostProviderQuery(hostProviders)
      ? await queryStableHostAtMentions(keyword, maxResults, hostProviders, input.forceRefresh ?? false)
      : await queryHostAtMentions(keyword, maxResults, hostProviders);
    for (const item of hostItems) {
      push(item);
    }
  }

  return sortTuttiAtMentionResults(results, keyword, roomArtifacts).slice(0, maxResults);
}

function sortTuttiAtMentionResults(
  results: TuttiAtQueryResult[],
  keyword: string,
  roomArtifacts: ReadonlyArray<Pick<Artifact, "id" | "createdAt">> = [],
) {
  const query = keyword.trim();
  if (!query) {
    const roomFiles = results.filter((item) => item.providerId === "file");
    const others = results.filter((item) => item.providerId !== "file");
    return [...sortRoomFileMentionsByRecency(roomFiles, roomArtifacts), ...others];
  }
  return [...results].sort((left, right) => scoreTuttiAtMentionMatch(right, query) - scoreTuttiAtMentionMatch(left, query));
}

function parseArtifactCreatedAtMs(createdAt: string) {
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function sortRoomFileMentionsByRecency(
  items: readonly TuttiAtQueryResult[],
  roomArtifacts: ReadonlyArray<Pick<Artifact, "id" | "createdAt">> = [],
) {
  const createdAtByArtifactId = new Map(
    roomArtifacts.map((artifact) => [artifact.id, parseArtifactCreatedAtMs(artifact.createdAt)]),
  );
  return [...items].sort((left, right) => {
    const leftMs = left.roomFile?.artifactId
      ? createdAtByArtifactId.get(left.roomFile.artifactId) ?? 0
      : 0;
    const rightMs = right.roomFile?.artifactId
      ? createdAtByArtifactId.get(right.roomFile.artifactId) ?? 0
      : 0;
    if (rightMs !== leftMs) return rightMs - leftMs;
    return left.label.localeCompare(right.label);
  });
}

function finalizeRoomFileMentions(
  items: TuttiAtQueryResult[],
  keyword: string,
  maxResults: number,
  roomArtifacts: ReadonlyArray<Pick<Artifact, "id" | "createdAt">>,
) {
  const filtered = filterTuttiAtMentionsByKeyword(items, keyword);
  const sorted = keyword.trim()
    ? sortTuttiAtMentionResults(filtered, keyword, roomArtifacts)
    : sortRoomFileMentionsByRecency(filtered, roomArtifacts);
  return sorted.slice(0, maxResults);
}

async function queryHostAtMentions(
  keyword: string,
  maxResults: number,
  providers: readonly TuttiAtProviderId[],
): Promise<TuttiAtQueryResult[]> {
  if (!window.tuttiExternal?.at) return [];
  try {
    const results = await queryTuttiExternalAtRichTextTriggerItems({
      bridge: window.tuttiExternal,
      keyword,
      maxResults,
      providerIds: providers,
    });
    return [...results];
  } catch {
    return [];
  }
}

async function queryLocalRoomFileReferences(
  roomId: string,
  keyword: string,
  maxResults: number,
  fingerprint: string,
  roomArtifacts: ReadonlyArray<Pick<Artifact, "id" | "createdAt">>,
  forceRefresh = false,
): Promise<TuttiAtQueryResult[]> {
  const cached = roomFileMentionCache.get(roomId);
  if (!forceRefresh && cached && cached.fingerprint === fingerprint) {
    return finalizeRoomFileMentions(cached.items, keyword, maxResults, roomArtifacts);
  }

  try {
    const response = await listAppReferences({
      parentGroupId: roomId,
      filterText: null,
      limit: ROOM_FILE_MENTION_CACHE_LIMIT,
      kinds: ["file"],
    });
    if ("error" in response) return [];
    const items = sortRoomFileMentionsByRecency(
      mapLocalFileReferences(response as AppReferenceListResponse),
      roomArtifacts,
    );
    roomFileMentionCache.set(roomId, { fingerprint, items });
    return finalizeRoomFileMentions(items, keyword, maxResults, roomArtifacts);
  } catch {
    return [];
  }
}

function mapLocalFileReferences(response: AppReferenceListResponse): TuttiAtQueryResult[] {
  const items: TuttiAtQueryResult[] = [];
  const seenLocations = new Set<string>();
  for (const item of response.items) {
    if (item.type !== "reference" || item.reference.kind !== "file") continue;
    const path = item.reference.location.path;
    const locationKey = `${item.reference.location.type}\0${path}`;
    if (seenLocations.has(locationKey)) continue;
    seenLocations.add(locationKey);
    const label = item.reference.displayName?.trim() || path.split("/").pop() || path;
    const mimeType = item.reference.mimeType ?? "";
    const previewUrl = item.reference.previewUrl?.trim()
      || (mimeType.startsWith("image/") && item.reference.artifactId
        ? `/local-assets/${encodeURIComponent(item.reference.artifactId)}`
        : null);
    const roomFile = item.reference.artifactId
      ? {
          artifactId: item.reference.artifactId,
          ...(item.reference.messageId ? { messageId: item.reference.messageId } : {}),
          mimeType,
          previewUrl: previewUrl ?? "",
        }
      : undefined;
    const itemId = item.reference.artifactId ?? path;
    items.push({
      providerId: "file",
      itemId,
      label,
      subtitle: item.reference.description ?? path,
      thumbnailUrl: mimeType.startsWith("image/") ? previewUrl : null,
      roomFile,
      insert: {
        kind: "markdown-link",
        label,
        href: path,
      },
    });
  }
  return items;
}

export function tuttiAtResultToMentionTarget(item: TuttiAtQueryResult) {
  const base = {
    participantId: tuttiAtMentionKey(item.providerId, item.itemId),
    displayNameSnapshot: item.label,
    mentionType: "reference" as const,
    referenceProviderId: item.providerId,
    referenceEntityId: item.itemId,
    referenceInsert: item.insert,
  };
  if (item.insert.kind === "mention") {
    return {
      ...base,
      referenceScope: item.insert.mention.scope,
    };
  }
  return base;
}
