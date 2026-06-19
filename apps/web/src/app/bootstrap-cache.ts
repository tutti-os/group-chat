import type { ChatSnapshot } from "@group-chat/shared";

const CACHE_KEY = "group-chat:bootstrap-snapshot:v1";
const CACHE_SCHEMA_VERSION = 1;

interface CachedBootstrapSnapshot {
  schemaVersion: number;
  savedAt: string;
  snapshot: ChatSnapshot;
}

export function loadCachedSnapshot(): ChatSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedBootstrapSnapshot>;
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !isChatSnapshot(parsed.snapshot)) {
      return null;
    }
    return parsed.snapshot;
  } catch {
    return null;
  }
}

export function saveCachedSnapshot(snapshot: ChatSnapshot) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedBootstrapSnapshot = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      snapshot,
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Cache failures should never block the live bootstrap path.
  }
}

function isChatSnapshot(value: unknown): value is ChatSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<Record<keyof ChatSnapshot, unknown>>;
  return (
    Array.isArray(snapshot.rooms)
    && Array.isArray(snapshot.conversations)
    && Array.isArray(snapshot.participants)
    && Array.isArray(snapshot.identities)
    && Array.isArray(snapshot.runtimeProfiles)
    && Array.isArray(snapshot.messages)
    && Array.isArray(snapshot.messageBlocks)
    && Array.isArray(snapshot.agentRunEvents)
    && Array.isArray(snapshot.artifacts)
    && Array.isArray(snapshot.agentRuns)
    && Array.isArray(snapshot.activeRuns)
    && typeof snapshot.lastSeq === "number"
  );
}
