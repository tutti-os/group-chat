import type { TuttiAtProviderId } from "@group-chat/shared";

export const MENTION_PANEL_TABS = [
  "members",
  "files",
  "sessions",
  "apps",
  "tasks",
] as const;

export type MentionPanelTab = (typeof MENTION_PANEL_TABS)[number];

export function mentionTabI18nKey(tab: MentionPanelTab) {
  return `composer.atTab.${tab}` as const;
}

export function mentionTabProviders(tab: MentionPanelTab): readonly TuttiAtProviderId[] | null {
  switch (tab) {
    case "files":
      return ["file", "agent-generated-file"];
    case "sessions":
      return ["agent-session"];
    case "apps":
      return ["workspace-app"];
    case "tasks":
      return ["workspace-issue"];
    default:
      return null;
  }
}

export function referenceProviderToMentionTab(providerId: TuttiAtProviderId): MentionPanelTab | null {
  if (providerId === "file" || providerId === "agent-generated-file") return "files";
  if (providerId === "agent-session") return "sessions";
  if (providerId === "workspace-app") return "apps";
  if (providerId === "workspace-issue") return "tasks";
  return null;
}

export function isReferenceMentionTab(tab: MentionPanelTab) {
  return mentionTabProviders(tab) !== null;
}
