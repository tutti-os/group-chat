import type { Participant, RuntimeProfile } from "@group-chat/shared";
import type { TuttiAgentGuiProvider } from "./agent-gui-dispatch.js";

export const AGENT_LAUNCHER_APP_IDS = {
  codex: "agent-codex",
  claude: "agent-claude-code",
} as const;

export const AGENT_LAUNCHER_APP_ID_TO_GUI: Record<string, TuttiAgentGuiProvider> = {
  "agent-claude-code": "claude-code",
  "agent-codex": "codex",
};

export const RUNTIME_PROVIDER_TO_GUI: Record<string, TuttiAgentGuiProvider> = {
  claude: "claude-code",
  codex: "codex",
};

export function localAgentLauncherAppId(provider: string): string | null {
  return AGENT_LAUNCHER_APP_IDS[provider.trim().toLowerCase() as keyof typeof AGENT_LAUNCHER_APP_IDS] ?? null;
}

export function isAgentLauncherAppId(entityId: string | null | undefined): boolean {
  return Boolean(entityId?.trim() && entityId.trim() in AGENT_LAUNCHER_APP_ID_TO_GUI);
}

export function resolveAgentGuiProviderFromAppId(entityId: string | null | undefined): TuttiAgentGuiProvider | null {
  if (!entityId?.trim()) return null;
  return AGENT_LAUNCHER_APP_ID_TO_GUI[entityId.trim()] ?? null;
}

export function resolveAgentGuiProviderFromRuntimeProvider(
  provider: string | null | undefined,
): TuttiAgentGuiProvider | null {
  if (!provider?.trim()) return null;
  return RUNTIME_PROVIDER_TO_GUI[provider.trim().toLowerCase()] ?? null;
}

export function resolveAgentLauncherRuntimeProvider(entityId: string | null | undefined): string | null {
  if (entityId?.trim() === AGENT_LAUNCHER_APP_IDS.codex) return "codex";
  if (entityId?.trim() === AGENT_LAUNCHER_APP_IDS.claude) return "claude";
  return null;
}

export function formatAgentLauncherMentionLabel(label: string): string {
  const trimmed = label.replace(/^@+/, "").trim();
  return trimmed ? `@${trimmed}` : "@";
}

export function resolveParticipantRuntimeProvider(
  participant: Participant,
  runtimeProfiles: RuntimeProfile[] | undefined,
): string | null {
  const profile = participant.runtimeProfileId
    ? runtimeProfiles?.find((item) => item.id === participant.runtimeProfileId) ?? null
    : null;
  return profile?.kind === "local-agent" ? profile.provider : null;
}

export function isAgentLauncherParticipant(
  participant: Participant,
  runtimeProfiles: RuntimeProfile[] | undefined,
): boolean {
  return Boolean(resolveAgentGuiProviderFromRuntimeProvider(resolveParticipantRuntimeProvider(participant, runtimeProfiles)));
}
