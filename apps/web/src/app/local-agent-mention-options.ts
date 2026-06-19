import type { Identity, LocalAgentProviderStatus, Participant, RuntimeProfile } from "@group-chat/shared";
import { localAgentLauncherAppId } from "./agent-launcher-mentions.js";
import { defaultIdentityNameForRuntime, listCanonicalRuntimeProfiles, localAgentStatus } from "./runtime.js";
import type { TuttiAtQueryResult } from "./tutti-bridge.js";
import { readCachedTuttiWorkspaceId } from "./tutti-bridge.js";

export type LocalAgentMentionOption = {
  kind: "local-agent";
  key: string;
  label: string;
  subtitle: string;
  runtimeProfile: RuntimeProfile;
  participant: Participant | null;
};

export function localAgentMentionSubtitle(
  profile: RuntimeProfile,
  status: LocalAgentProviderStatus,
  localAgentProviders: LocalAgentProviderStatus[],
): string {
  const version = status.version?.trim();
  if (version && version !== "not-installed") return version;
  return status.displayName?.trim() || defaultIdentityNameForRuntime(profile, localAgentProviders) || profile.provider;
}

export function buildLocalAgentLauncherReference(option: LocalAgentMentionOption): TuttiAtQueryResult {
  const appId = localAgentLauncherAppId(option.runtimeProfile.provider);
  if (appId) {
    const scope: Record<string, string> = {};
    const workspaceId = readCachedTuttiWorkspaceId()?.trim();
    if (workspaceId) scope.workspaceId = workspaceId;
    return {
      providerId: "workspace-app",
      itemId: appId,
      label: option.label,
      subtitle: option.subtitle,
      insert: {
        kind: "mention",
        entityId: appId,
        label: option.label,
        scope,
      },
    };
  }

  return {
    providerId: "agent-session",
    itemId: option.runtimeProfile.id,
    label: option.label,
    subtitle: option.subtitle,
    insert: {
      kind: "mention",
      entityId: option.runtimeProfile.id,
      label: option.label,
      scope: { provider: option.runtimeProfile.provider },
    },
  };
}

export function findParticipantForLocalAgentProfile(
  participants: Participant[],
  identities: Identity[],
  runtimeProfiles: RuntimeProfile[],
  profile: RuntimeProfile,
): Participant | null {
  const activeAgents = participants.filter((participant) => participant.kind === "ai" && participant.status !== "removed");
  for (const participant of activeAgents) {
    const runtimeProfileId =
      participant.runtimeProfileId
      ?? identities.find((identity) => identity.id === participant.identityId)?.defaultRuntimeProfileId
      ?? null;
    const runtime = runtimeProfileId
      ? runtimeProfiles.find((item) => item.id === runtimeProfileId) ?? null
      : null;
    if (runtime?.kind === "local-agent" && runtime.provider === profile.provider) {
      return participant;
    }
  }
  return null;
}

export function buildLocalAgentMentionOptions(
  runtimeProfiles: RuntimeProfile[],
  localAgentProviders: LocalAgentProviderStatus[],
  participants: Participant[],
  identities: Identity[],
  query: string | null,
  availableLauncherAppIds: ReadonlySet<string> = new Set(),
): LocalAgentMentionOption[] {
  if (query === null) return [];
  const normalizedQuery = query.toLowerCase();
  const results: LocalAgentMentionOption[] = [];

  for (const profile of listCanonicalRuntimeProfiles(runtimeProfiles)) {
    if (profile.kind !== "local-agent") continue;
    const status = localAgentStatus(profile, localAgentProviders);
    const launcherAppId = localAgentLauncherAppId(profile.provider);
    if (launcherAppId && !availableLauncherAppIds.has(launcherAppId)) continue;
    if (!launcherAppId && !status?.available) continue;

    const label = status?.displayName?.trim() || defaultIdentityNameForRuntime(profile, localAgentProviders);
    const participant = findParticipantForLocalAgentProfile(participants, identities, runtimeProfiles, profile);
    const subtitle = status
      ? localAgentMentionSubtitle(profile, status, localAgentProviders)
      : profile.displayName || profile.provider;

    const haystack = [
      label,
      profile.provider,
      profile.id,
      profile.displayName,
      participant?.displayName ?? "",
      subtitle,
    ]
      .join("\n")
      .toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) continue;

    results.push({
      kind: "local-agent",
      key: profile.id,
      label,
      subtitle,
      runtimeProfile: profile,
      participant,
    });
  }

  return results.sort((left, right) => left.label.localeCompare(right.label));
}
