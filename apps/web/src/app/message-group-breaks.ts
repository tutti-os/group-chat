export const MESSAGE_GROUP_IDLE_MS = 30 * 1000;

const STORAGE_KEY = "message-group-breaks";

function readBreakIds(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

const breakIds = readBreakIds();

export function markMessageGroupBreak(messageId: string) {
  breakIds.add(messageId);
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...breakIds]));
}

export function isMessageGroupBreak(messageId: string) {
  return breakIds.has(messageId);
}
