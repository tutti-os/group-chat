const LEGACY_AGENT_LAUNCHER_APP_IDS = new Set(["agent-codex", "agent-claude-code"]);

export function isAgentLauncherAppId(entityId: string | null | undefined): boolean {
  return LEGACY_AGENT_LAUNCHER_APP_IDS.has(entityId?.trim() ?? "");
}

export function formatAgentLauncherMentionLabel(label: string): string {
  const trimmed = label.replace(/^@+/, "").trim();
  return trimmed ? `@${trimmed}` : "@";
}
