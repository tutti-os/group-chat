import { isAgentLauncherAppId } from "./agent-launcher-mentions.js";
import { queryTuttiAtMentions } from "./tutti-at-mentions.js";

let cachedAvailableAgentLauncherAppIds: Set<string> | null = null;
let availableAgentLauncherAppIdsRequest: Promise<Set<string>> | null = null;
const AVAILABLE_AGENT_LAUNCHER_APP_IDS_STORAGE_KEY = "group-chat:available-agent-launcher-app-ids";

function readPersistedAvailableAgentLauncherAppIds() {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(AVAILABLE_AGENT_LAUNCHER_APP_IDS_STORAGE_KEY) ?? "null");
    if (!Array.isArray(value)) return null;
    return new Set(value.filter((item): item is string => typeof item === "string" && isAgentLauncherAppId(item)));
  } catch {
    return null;
  }
}

function persistAvailableAgentLauncherAppIds(ids: ReadonlySet<string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(AVAILABLE_AGENT_LAUNCHER_APP_IDS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage can be disabled in embedded or private browsing contexts.
  }
}

export function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

export function isAgentLauncherAvailable(
  launcherAppId: string,
  dockAppIds: ReadonlySet<string>,
  localProviderAvailable: boolean,
  agentGuiBridgeAvailable = false,
) {
  return dockAppIds.has(launcherAppId) || localProviderAvailable || agentGuiBridgeAvailable;
}

export function readCachedAvailableAgentLauncherAppIds() {
  if (!cachedAvailableAgentLauncherAppIds) {
    cachedAvailableAgentLauncherAppIds = readPersistedAvailableAgentLauncherAppIds();
  }
  return cachedAvailableAgentLauncherAppIds ? new Set(cachedAvailableAgentLauncherAppIds) : new Set<string>();
}

export function fetchAvailableAgentLauncherAppIds(options?: { force?: boolean }) {
  if (!options?.force && cachedAvailableAgentLauncherAppIds) {
    return Promise.resolve(cachedAvailableAgentLauncherAppIds);
  }
  if (!options?.force && availableAgentLauncherAppIdsRequest) {
    return availableAgentLauncherAppIdsRequest;
  }
  if (typeof window !== "undefined" && !window.tuttiExternal?.at) {
    return Promise.resolve(readCachedAvailableAgentLauncherAppIds());
  }
  availableAgentLauncherAppIdsRequest = queryTuttiAtMentions({
    keyword: "",
    maxResults: 50,
    providers: ["workspace-app"],
    forceRefresh: options?.force ?? false,
  })
    .then((items) => {
      const ids = new Set(
        items
          .map((item) => item.itemId)
          .filter((itemId) => isAgentLauncherAppId(itemId)),
      );
      cachedAvailableAgentLauncherAppIds = ids;
      persistAvailableAgentLauncherAppIds(ids);
      return ids;
    })
    .finally(() => {
      availableAgentLauncherAppIdsRequest = null;
    });
  return availableAgentLauncherAppIdsRequest;
}
