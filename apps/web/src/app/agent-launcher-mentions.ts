import type { Participant, RuntimeProfile } from "@group-chat/shared";

export type TuttiAgentGuiProvider = string;
export const RUNTIME_PROVIDER_TO_GUI: Record<string, string> = {};

/**
 * Provider-specific AgentGUI launchers are intentionally no longer exposed.
 * Local Agent selection and mentions are driven by exact catalog target ids.
 */
export function localAgentLauncherAppId(_agentTargetId: string): string | null {
  return null;
}

export function isAgentLauncherAppId(_entityId: string | null | undefined): boolean {
  return false;
}

export function resolveAgentGuiProviderFromAppId(
  _entityId: string | null | undefined,
): TuttiAgentGuiProvider | null {
  return null;
}

export function resolveAgentGuiProviderFromRuntimeProvider(
  _provider: string | null | undefined,
): TuttiAgentGuiProvider | null {
  return null;
}

export function resolveAgentLauncherRuntimeProvider(_entityId: string | null | undefined): string | null {
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
  _participant: Participant,
  _runtimeProfiles: RuntimeProfile[] | undefined,
): boolean {
  return false;
}
