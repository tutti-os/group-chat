import type { Identity, LocalAgentProviderStatus, Participant, RuntimeProfile } from "@group-chat/shared";
import { defaultIdentityNameForRuntime, listCanonicalRuntimeProfiles, localAgentStatus } from "./runtime.js";

export type LocalAgentMentionOption = {
  kind: "local-agent";
  key: string;
  label: string;
  subtitle: string;
  runtimeProfile: RuntimeProfile;
  participant: Participant | null;
};

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
): LocalAgentMentionOption[] {
  if (query === null) return [];
  const normalizedQuery = query.toLowerCase();
  const results: LocalAgentMentionOption[] = [];

  for (const profile of listCanonicalRuntimeProfiles(runtimeProfiles)) {
    if (profile.kind !== "local-agent") continue;
    const status = localAgentStatus(profile, localAgentProviders);
    if (!status?.available) continue;

    const label = status.displayName?.trim() || defaultIdentityNameForRuntime(profile, localAgentProviders);
    const participant = findParticipantForLocalAgentProfile(participants, identities, runtimeProfiles, profile);
    const subtitle = participant
      ? participant.displayName
      : status.version && status.version !== "not-installed"
        ? status.version
        : profile.provider;

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
