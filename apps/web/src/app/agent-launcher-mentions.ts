import { isLegacyAgentLauncherAppId } from "@group-chat/shared";

export function isAgentLauncherAppId(
  providerId: string | null | undefined,
  entityId: string | null | undefined,
): boolean {
  return isLegacyAgentLauncherAppId(providerId, entityId);
}

export function formatAgentLauncherMentionLabel(label: string): string {
  const trimmed = label.replace(/^@+/, "").trim();
  return trimmed ? `@${trimmed}` : "@";
}
