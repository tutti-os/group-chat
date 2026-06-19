import { isAgentLauncherAppId } from "./agent-launcher-mentions.js";
import { queryTuttiAtMentions } from "./tutti-at-mentions.js";

let cachedAvailableAgentLauncherAppIds: Set<string> | null = null;
let availableAgentLauncherAppIdsRequest: Promise<Set<string>> | null = null;

export function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

export function readCachedAvailableAgentLauncherAppIds() {
  return cachedAvailableAgentLauncherAppIds ? new Set(cachedAvailableAgentLauncherAppIds) : new Set<string>();
}

export function fetchAvailableAgentLauncherAppIds(options?: { force?: boolean }) {
  if (!options?.force && cachedAvailableAgentLauncherAppIds) {
    return Promise.resolve(cachedAvailableAgentLauncherAppIds);
  }
  if (!options?.force && availableAgentLauncherAppIdsRequest) {
    return availableAgentLauncherAppIdsRequest;
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
      return ids;
    })
    .finally(() => {
      availableAgentLauncherAppIdsRequest = null;
    });
  return availableAgentLauncherAppIdsRequest;
}
