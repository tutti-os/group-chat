import {
  DEFAULT_PARTICIPANT_LISTEN_MODE,
  type Conversation,
  type Participant,
  type RuntimeProfile,
} from "@group-chat/shared";

const TUTTI_AGENT_PARTICIPANT_PREFIX = "tutti-agent:";

export function localAgentProviderFromLauncherAppId(appId: string | null | undefined) {
  if (appId?.trim() === "agent-codex") return "codex";
  if (appId?.trim() === "agent-claude-code") return "claude";
  return "";
}

export function tuttiAgentParticipantId(provider: string) {
  const normalized = normalizeTuttiAgentProvider(provider);
  return normalized ? `${TUTTI_AGENT_PARTICIPANT_PREFIX}${normalized}` : "";
}

export function parseTuttiAgentParticipantId(participantId: string | null | undefined) {
  const trimmed = participantId?.trim() ?? "";
  if (!trimmed.startsWith(TUTTI_AGENT_PARTICIPANT_PREFIX)) return "";
  return normalizeTuttiAgentProvider(trimmed.slice(TUTTI_AGENT_PARTICIPANT_PREFIX.length));
}

export function defaultTuttiAgentParticipantName(provider: string) {
  if (provider === "codex") return "Codex CLI";
  if (provider === "claude") return "Claude Code";
  return provider || "Agent";
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

function normalizeTuttiAgentProvider(provider: string | null | undefined) {
  const normalized = provider?.trim().toLowerCase() ?? "";
  if (normalized === "claude-code") return "claude";
  if (normalized === "claude" || normalized === "codex") return normalized;
  return normalized.replace(/[^a-z0-9_.-]/g, "");
}
