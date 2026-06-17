import type { AppReferenceListResponse, TuttiAtProviderId, TuttiReferenceInsert } from "@group-chat/shared";
import { TUTTI_AT_PROVIDER_IDS } from "@group-chat/shared";
import { listAppReferences } from "../api/client.js";

export type TuttiAtRoomFileMeta = {
  artifactId: string;
  messageId?: string;
  mimeType: string;
  previewUrl: string;
};

export type TuttiAtQueryResult = {
  providerId: TuttiAtProviderId;
  itemId: string;
  label: string;
  subtitle?: string;
  thumbnailUrl?: string | null;
  insert: TuttiReferenceInsert;
  roomFile?: TuttiAtRoomFileMeta;
};

export function tuttiAtMentionKey(providerId: TuttiAtProviderId, itemId: string) {
  return `tutti-at:${providerId}:${itemId}`;
}

export function parseTuttiAtMentionKey(value: string): { providerId: TuttiAtProviderId; itemId: string } | null {
  const match = /^tutti-at:([^:]+):(.+)$/.exec(value);
  if (!match) return null;
  const providerId = match[1] as TuttiAtProviderId;
  if (!TUTTI_AT_PROVIDER_IDS.includes(providerId)) return null;
  return { providerId, itemId: match[2]! };
}

export async function queryTuttiAtMentions(input: {
  keyword: string;
  roomId?: string | null;
  maxResults?: number;
}): Promise<TuttiAtQueryResult[]> {
  const keyword = input.keyword.trim();
  const maxResults = Math.max(1, input.maxResults ?? 20);
  const results: TuttiAtQueryResult[] = [];
  const seen = new Set<string>();

  const push = (item: TuttiAtQueryResult) => {
    const key = tuttiAtMentionKey(item.providerId, item.itemId);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  if (input.roomId) {
    const localFiles = await queryLocalRoomFileReferences(input.roomId, keyword, maxResults);
    for (const item of localFiles) {
      push(item);
      if (results.length >= maxResults) return sortTuttiAtMentionResults(results, keyword).slice(0, maxResults);
    }
  }

  const hostItems = await queryHostAtMentions(keyword, maxResults);
  for (const item of hostItems) {
    push(item);
    if (results.length >= maxResults) return sortTuttiAtMentionResults(results, keyword).slice(0, maxResults);
  }

  return sortTuttiAtMentionResults(results, keyword).slice(0, maxResults);
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

function sortTuttiAtMentionResults(results: TuttiAtQueryResult[], keyword: string) {
  const query = keyword.trim();
  if (!query) return results;
  return [...results].sort((left, right) => scoreTuttiAtMentionMatch(right, query) - scoreTuttiAtMentionMatch(left, query));
}

async function queryHostAtMentions(keyword: string, maxResults: number): Promise<TuttiAtQueryResult[]> {
  const bridge = window.tuttiExternal?.at;
  if (!bridge) return [];
  try {
    const items = await bridge.query({
      keyword,
      maxResults,
      providers: [...TUTTI_AT_PROVIDER_IDS],
    });
    return items
      .filter((item) => TUTTI_AT_PROVIDER_IDS.includes(item.providerId))
      .map(normalizeHostAtItem);
  } catch {
    return [];
  }
}

function normalizeHostAtItem(item: {
  providerId: TuttiAtProviderId;
  itemId: string;
  label: string;
  subtitle?: string;
  thumbnailUrl?: string | null;
  insert: TuttiReferenceInsert;
}): TuttiAtQueryResult {
  return {
    providerId: item.providerId,
    itemId: item.itemId,
    label: item.label,
    subtitle: item.subtitle,
    thumbnailUrl: item.thumbnailUrl,
    insert: item.insert,
  };
}

async function queryLocalRoomFileReferences(
  roomId: string,
  keyword: string,
  maxResults: number,
): Promise<TuttiAtQueryResult[]> {
  try {
    const response = await listAppReferences({
      parentGroupId: roomId,
      filterText: keyword || null,
      limit: maxResults,
      kinds: ["file"],
    });
    if ("error" in response) return [];
    return mapLocalFileReferences(response as AppReferenceListResponse);
  } catch {
    return [];
  }
}

function mapLocalFileReferences(response: AppReferenceListResponse): TuttiAtQueryResult[] {
  const items: TuttiAtQueryResult[] = [];
  for (const item of response.items) {
    if (item.type !== "reference" || item.reference.kind !== "file") continue;
    const path = item.reference.location.path;
    const label = item.reference.displayName?.trim() || path.split("/").pop() || path;
    const mimeType = item.reference.mimeType ?? "";
    const previewUrl = item.reference.previewUrl ?? null;
    const roomFile = item.reference.artifactId
      ? {
          artifactId: item.reference.artifactId,
          ...(item.reference.messageId ? { messageId: item.reference.messageId } : {}),
          mimeType,
          previewUrl: previewUrl ?? "",
        }
      : undefined;
    items.push({
      providerId: "file",
      itemId: path,
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
      referenceScope: item.insert.scope,
    };
  }
  return base;
}
