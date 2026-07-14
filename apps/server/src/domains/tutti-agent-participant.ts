import {
  DEFAULT_PARTICIPANT_LISTEN_MODE,
  defaultTuttiAgentParticipantName,
  parseLegacyTuttiAgentProviderParticipantId,
  parseTuttiAgentParticipantId,
  tuttiAgentParticipantId,
  type Conversation,
  type Participant,
  type RuntimeProfile,
} from "@group-chat/shared";

export {
  defaultTuttiAgentParticipantName,
  parseLegacyTuttiAgentProviderParticipantId,
  parseTuttiAgentParticipantId,
  tuttiAgentParticipantId,
};

export function localAgentTargetFromLauncherAppId(appId: string | null | undefined) {
  const value = appId?.trim() ?? "";
  return value.startsWith("agent-target:") ? value.slice("agent-target:".length) : "";
}

export function normalizeTuttiAgentName(value: string) {
  return value.replace(/^@+/, "").trim().toLowerCase();
}

export function createVirtualTuttiAgentParticipant(
  conversation: Pick<Conversation, "id">,
  runtimeProfile: RuntimeProfile,
  displayName = defaultTuttiAgentParticipantName(runtimeProfile.displayName),
): Participant | null {
  if (runtimeProfile.kind !== "local-agent" || !runtimeProfile.agentTargetId) return null;
  const participantId = tuttiAgentParticipantId(runtimeProfile.agentTargetId);
  if (!participantId) return null;
  const now = new Date().toISOString();
  return {
    id: participantId,
    conversationId: conversation.id,
    kind: "ai",
    displayName,
    avatar: null,
    runtimeProfileId: runtimeProfile.id,
    agentTargetId: runtimeProfile.agentTargetId,
    identityId: null,
    roomInstructions: "",
    status: "active",
    listenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
    sortOrder: Number.MAX_SAFE_INTEGER,
    reasoningEffort: null,
    speedMode: null,
    createdAt: now,
    updatedAt: now,
  };
}
