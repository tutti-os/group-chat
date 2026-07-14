import type { Identity, LocalAgentProviderStatus, Participant, RuntimeProfile } from "@group-chat/shared";
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
  return defaultIdentityNameForRuntime(profile, localAgentProviders) || profile.provider;
}

export function buildLocalAgentLauncherReference(option: LocalAgentMentionOption): TuttiAtQueryResult {
  const localAgentScope: Record<string, string> = {
    groupChatLocalAgentMention: "true",
    groupChatAgentTargetId: option.runtimeProfile.agentTargetId ?? "",
    groupChatRuntimeProfileId: option.runtimeProfile.id,
  };
  if (option.participant) {
    localAgentScope.groupChatParticipantId = option.participant.id;
    localAgentScope.groupChatParticipantLabel = option.label;
  }
  const scope: Record<string, string> = { ...localAgentScope };
  const workspaceId = readCachedTuttiWorkspaceId()?.trim();
  if (workspaceId) scope.workspaceId = workspaceId;

  return {
    providerId: "agent-session",
    itemId: option.runtimeProfile.agentTargetId ?? option.runtimeProfile.id,
    label: option.label,
    subtitle: option.subtitle,
    insert: {
      kind: "mention",
      mention: {
        entityId: option.runtimeProfile.agentTargetId ?? option.runtimeProfile.id,
        label: option.label,
        scope,
      },
    },
  };
}

export function findParticipantForLocalAgentProfile(
  participants: Participant[],
  identities: Identity[],
  runtimeProfiles: RuntimeProfile[],
  profile: RuntimeProfile,
  displayNameCandidates: readonly string[] = [],
): Participant | null {
  const activeAgents = participants.filter((participant) => participant.kind === "ai" && participant.status !== "removed");
  const candidateNames = new Set(displayNameCandidates.map(normalizeLocalAgentDisplayName).filter(Boolean));
  for (const participant of activeAgents) {
    const runtimeProfileId =
      participant.runtimeProfileId
      ?? identities.find((identity) => identity.id === participant.identityId)?.defaultRuntimeProfileId
      ?? null;
    const runtime = runtimeProfileId
      ? runtimeProfiles.find((item) => item.id === runtimeProfileId) ?? null
      : null;
    if (
      runtimeProfileId === runtime?.id
      &&
      runtime?.kind === "local-agent"
      && runtime.agentTargetId === profile.agentTargetId
      && candidateNames.has(normalizeLocalAgentDisplayName(participant.displayName))
    ) {
      return participant;
    }
  }
  return null;
}

function normalizeLocalAgentDisplayName(value: string | null | undefined) {
  return value?.replace(/^@+/, "").trim().toLowerCase() ?? "";
}

export function buildLocalAgentMentionOptions(
  runtimeProfiles: RuntimeProfile[],
  localAgentProviders: LocalAgentProviderStatus[],
  participants: Participant[],
  identities: Identity[],
  query: string | null,
): LocalAgentMentionOption[] {
  if (query === null) return [];
  const normalizedQuery = query.toLowerCase();
  const results: LocalAgentMentionOption[] = [];

  for (const profile of listCanonicalRuntimeProfiles(runtimeProfiles)) {
    if (profile.kind !== "local-agent") continue;
    const status = localAgentStatus(profile, localAgentProviders);
    if (!status?.available) continue;

    const label = defaultIdentityNameForRuntime(profile, localAgentProviders);
    const subtitle = status
      ? localAgentMentionSubtitle(profile, status, localAgentProviders)
      : profile.displayName || profile.provider;
    const participant = findParticipantForLocalAgentProfile(participants, identities, runtimeProfiles, profile, [
      label,
      status?.displayName ?? "",
      defaultIdentityNameForRuntime(profile, localAgentProviders),
      profile.displayName,
    ]);
    const participantProfile = participant?.runtimeProfileId
      ? runtimeProfiles.find((item) => item.id === participant.runtimeProfileId) ?? null
      : null;
    const mentionProfile = participantProfile?.kind === "local-agent"
        && participantProfile.agentTargetId === profile.agentTargetId
      ? participantProfile
      : profile;

    const haystack = [
      label,
      profile.agentTargetId ?? "",
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
      runtimeProfile: mentionProfile,
      participant,
    });
  }

  return results.sort((left, right) => left.label.localeCompare(right.label));
}
