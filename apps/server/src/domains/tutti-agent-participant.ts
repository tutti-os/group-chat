import {
  DEFAULT_PARTICIPANT_LISTEN_MODE,
  defaultTuttiAgentParticipantName,
  parseTuttiAgentParticipantId,
  tuttiAgentParticipantId,
  type Conversation,
  type Participant,
  type RuntimeProfile,
} from "@group-chat/shared";

export { defaultTuttiAgentParticipantName, parseTuttiAgentParticipantId, tuttiAgentParticipantId };

export function localAgentProviderFromLauncherAppId(appId: string | null | undefined) {
  if (appId?.trim() === "agent-codex") return "codex";
  if (appId?.trim() === "agent-claude-code") return "claude";
  return "";
}

export function normalizeTuttiAgentName(value: string) {
  return value.replace(/^@+/, "").trim().toLowerCase();
}

export function createVirtualTuttiAgentParticipant(
  conversation: Pick<Conversation, "id">,
  runtimeProfile: RuntimeProfile,
  displayName = defaultTuttiAgentParticipantName(runtimeProfile.provider),
): Participant | null {
  if (runtimeProfile.kind !== "local-agent") return null;
  const participantId = tuttiAgentParticipantId(runtimeProfile.provider);
  if (!participantId) return null;
  const now = new Date().toISOString();
  return {
    id: participantId,
    conversationId: conversation.id,
    kind: "ai",
    displayName,
    avatar: null,
    runtimeProfileId: runtimeProfile.id,
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
