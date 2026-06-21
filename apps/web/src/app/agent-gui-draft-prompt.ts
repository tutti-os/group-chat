import type { Artifact, Identity, MentionTarget, Message, Participant, PrivateTaskSnapshot } from "@group-chat/shared";
import {
  formatMessageLinkLabel,
  messageSenderLabel,
  parseMessageLinkIds,
  primaryMessageLinkId,
  summaryLinkLabel,
} from "./chat-links.js";
import { isAgentLauncherAppId } from "./agent-launcher-mentions.js";
import {
  contentHasReferenceMentions,
  splitContentByReferenceMentions,
} from "./reference-mentions.js";
import { buildTuttiMentionHref, readCachedTuttiWorkspaceId, resolveArtifactAgentDraftHref } from "./tutti-bridge.js";

const AGENT_LAUNCHER_ENTITY_IDS = new Set(["agent-claude-code", "agent-codex"]);

const MESSAGE_ID_SEGMENT = "[A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*";
const BARE_MESSAGE_LINK_PATTERN = new RegExp(
  `(?<!\\]\\()group-chat://message/(${MESSAGE_ID_SEGMENT})`,
  "g",
);
const MARKDOWN_MESSAGE_LINK_PATTERN = new RegExp(
  `\\[([^\\]]+)\\]\\(group-chat://message/(${MESSAGE_ID_SEGMENT})\\)`,
  "g",
);
const BARE_SUMMARY_LINK_PATTERN = /(?<!\]\()group-chat:\/\/summary\/([A-Za-z0-9_-]+)/g;
const MARKDOWN_SUMMARY_LINK_PATTERN = /\[([^\]]+)\]\(group-chat:\/\/summary\/([A-Za-z0-9_-]+)\)/g;
const GROUP_CHAT_REFERENCE_FILE_PATTERN =
  /(!?)\[([^\]]+)\]\(group-chat:\/\/reference\/(file|agent-generated-file)\/([^)]+)\)/g;

export interface AgentGuiDraftPromptContext {
  artifacts?: Array<Pick<Artifact, "id" | "localPath">>;
  messages?: Message[];
  participants?: Participant[];
  identities?: Array<Pick<Identity, "id" | "name">>;
  userDisplayName?: string | null;
  summaryTasks?: Array<Pick<PrivateTaskSnapshot, "id" | "participantName">>;
  workspaceId?: string | null;
}

const GROUP_CHAT_REFERENCE_OPENABLE_PATTERN =
  /\[([^\]]+)\]\(group-chat:\/\/reference\/(workspace-app|workspace-issue|agent-session)\/([^)]+)\)/g;

export function buildAgentGuiDraftPrompt(
  content: string,
  mentions: MentionTarget[],
  context: AgentGuiDraftPromptContext = {},
): string {
  let result = content.trim();
  result = upgradeGroupChatReferenceFileLinks(result, mentions, context);
  result = upgradeGroupChatOpenableReferenceLinks(result, mentions, context);
  result = upgradeMessageLinks(result, context);
  result = upgradeSummaryLinks(result, context);
  result = stripAgentLauncherMentions(result, mentions);
  return result;
}

function stripAgentLauncherMentions(content: string, mentions: MentionTarget[]) {
  const launcherMentions = mentions.filter((mention) =>
    mention.mentionType === "reference"
    && mention.referenceProviderId === "workspace-app"
    && AGENT_LAUNCHER_ENTITY_IDS.has(mention.referenceEntityId?.trim() ?? ""),
  );
  if (!launcherMentions.length) return content;

  let result = content;
  for (const mention of launcherMentions) {
    result = stripSingleLauncherMention(result, mention);
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

function stripSingleLauncherMention(content: string, mention: MentionTarget) {
  const label = mention.displayNameSnapshot.trim();
  if (!label) return content;

  let result = content;
  if (contentHasReferenceMentions(result)) {
    const segments = splitContentByReferenceMentions(result);
    result = segments
      .map((segment) => {
        if (segment.kind === "text") return segment.text;
        if (shouldStripAgentLauncherSegment(segment, mention)) return "";
        return `[${segment.label}](${segment.href})`;
      })
      .join("");
  }

  return stripPlainLauncherMention(result, label).trim();
}

function shouldStripAgentLauncherSegment(
  segment: { label: string; href: string },
  mention: MentionTarget,
) {
  if (isAgentLauncherReferenceHref(segment.href)) return true;
  const segmentLabel = segment.label.replace(/^@/, "").trim().toLowerCase();
  const agentLabel = mention.displayNameSnapshot.trim().replace(/^@/, "").toLowerCase();
  return segmentLabel === agentLabel;
}

function isAgentLauncherReferenceHref(href: string): boolean {
  const mentionMatch = href.match(/^mention:\/\/workspace-app\/([^/?]+)/);
  if (mentionMatch?.[1]) {
    try {
      return AGENT_LAUNCHER_ENTITY_IDS.has(decodeURIComponent(mentionMatch[1]));
    } catch {
      return false;
    }
  }

  const referencePrefix = "group-chat://reference/workspace-app/";
  if (href.startsWith(referencePrefix)) {
    const encodedEntityId = href.slice(referencePrefix.length).split("/")[0];
    if (encodedEntityId) {
      try {
        return AGENT_LAUNCHER_ENTITY_IDS.has(decodeURIComponent(encodedEntityId));
      } catch {
        return false;
      }
    }
  }

  return false;
}

function stripPlainLauncherMention(content: string, label: string) {
  const normalizedLabel = label.replace(/^@/, "");
  const escaped = normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\[@${escaped}\\]\\([^)]+\\)\\s*`, "i"),
    new RegExp(`\\[${escaped}\\]\\([^)]+\\)\\s*`, "i"),
    new RegExp(`@${escaped}(?=\\s|$|[，。！？,.!?;:：；、])`, "i"),
  ];
  let result = content;
  for (const pattern of patterns) {
    result = result.replace(pattern, "");
  }
  return result;
}

function upgradeGroupChatReferenceFileLinks(
  content: string,
  mentions: MentionTarget[],
  context: AgentGuiDraftPromptContext,
) {
  return content.replace(
    GROUP_CHAT_REFERENCE_FILE_PATTERN,
    (full, imagePrefix, label, provider, encodedEntityId) => {
      let entityId = encodedEntityId;
      try {
        entityId = decodeURIComponent(encodedEntityId);
      } catch {
        // keep raw entity id
      }
      const mention = mentions.find((item) =>
        item.mentionType === "reference"
        && item.referenceProviderId === provider
        && item.referenceEntityId === entityId,
      );
      const fileHref =
        mention?.referenceInsert?.kind === "markdown-link"
          ? mention.referenceInsert.href.trim()
          : entityId;
      const artifact = findDraftPromptArtifact(entityId, fileHref, context.artifacts ?? []);
      const href = resolveArtifactAgentDraftHref(artifact, fileHref);
      if (!href) return full;
      return `[${label}](${href})`;
    },
  );
}

function upgradeGroupChatOpenableReferenceLinks(
  content: string,
  mentions: MentionTarget[],
  context: AgentGuiDraftPromptContext,
) {
  return content.replace(
    GROUP_CHAT_REFERENCE_OPENABLE_PATTERN,
    (full, label, provider, encodedEntityId) => {
      let entityId = encodedEntityId;
      try {
        entityId = decodeURIComponent(encodedEntityId);
      } catch {
        // keep raw entity id
      }
      if (provider === "workspace-app" && isAgentLauncherAppId(entityId)) {
        return label;
      }
      const mention = mentions.find((item) =>
        item.mentionType === "reference"
        && item.referenceProviderId === provider
        && item.referenceEntityId === entityId,
      );
      const href = buildTuttiMentionHref(provider, entityId, {
        referenceInsert: mention?.referenceInsert,
        referenceScope: mention?.referenceScope,
        workspaceId: context.workspaceId,
      });
      if (!href) return full;
      return `[${label}](${href})`;
    },
  );
}

function findDraftPromptArtifact(
  entityId: string,
  fileHref: string,
  artifacts: Array<Pick<Artifact, "id" | "localPath">>,
) {
  const normalizedHref = fileHref.replace(/\\/g, "/");
  return artifacts.find((item) => {
    if (item.id === entityId) return true;
    const localPath = item.localPath?.replace(/\\/g, "/") ?? "";
    return Boolean(
      normalizedHref
      && (localPath === normalizedHref || localPath.endsWith(`/${normalizedHref}`)),
    );
  }) ?? null;
}

function upgradeMessageLinks(content: string, context: AgentGuiDraftPromptContext) {
  let result = content.replace(
    MARKDOWN_MESSAGE_LINK_PATTERN,
    (_, label, idSegment) => buildMessageLinkMarkdown(label, idSegment, context),
  );
  result = result.replace(
    BARE_MESSAGE_LINK_PATTERN,
    (_, idSegment) => buildMessageLinkMarkdown(null, idSegment, context),
  );
  return result;
}

function upgradeSummaryLinks(content: string, context: AgentGuiDraftPromptContext) {
  let result = content.replace(
    MARKDOWN_SUMMARY_LINK_PATTERN,
    (_, label, taskId) => buildSummaryLinkMarkdown(label, taskId, context),
  );
  result = result.replace(
    BARE_SUMMARY_LINK_PATTERN,
    (_, taskId) => buildSummaryLinkMarkdown(null, taskId, context),
  );
  return result;
}

function buildMessageLinkMarkdown(
  label: string | null,
  idSegment: string,
  context: AgentGuiDraftPromptContext,
) {
  const allMessageIds = parseMessageLinkIds(idSegment);
  const linkedMessages = allMessageIds
    .map((id) => context.messages?.find((item) => item.id === id))
    .filter((item): item is Message => Boolean(item));

  let displayLabel: string;
  if (linkedMessages.length > 0) {
    const senderNames: string[] = [];
    const seenSenderKeys = new Set<string>();
    for (const msg of linkedMessages) {
      const key = msg.senderParticipantId ?? msg.senderName ?? msg.id;
      if (seenSenderKeys.has(key)) continue;
      seenSenderKeys.add(key);
      const senderLabel = messageSenderLabel(msg, context.participants ?? [], context.identities ?? [], context.userDisplayName);
      if (senderLabel) senderNames.push(senderLabel);
    }
    const senderSummary = senderNames.length <= 2
      ? senderNames.join("、")
      : `${senderNames[0]}、${senderNames[1]}等${senderNames.length - 2}人`;
    displayLabel = `来自${senderSummary}的${linkedMessages.length}条消息`;
  } else {
    displayLabel = label?.trim()
      || formatMessageLinkLabel(
        idSegment,
        context.messages ?? [],
        context.participants ?? [],
        context.identities ?? [],
        context.userDisplayName,
      );
  }

  const messageId = primaryMessageLinkId(idSegment);
  const message = context.messages?.find((item) => item.id === messageId) ?? null;
  const href = buildGroupChatAppMentionHref(context, {
    messageId,
    conversationId: message?.conversationId,
  });
  return `[${escapeMarkdownLabel(displayLabel)}](${href ?? `group-chat://message/${idSegment}`})`;
}

function buildSummaryLinkMarkdown(
  label: string | null,
  taskId: string,
  context: AgentGuiDraftPromptContext,
) {
  const displayLabel = label?.trim()
    || summaryLinkLabel(context.summaryTasks?.find((task) => task.id === taskId));
  const href = buildGroupChatAppMentionHref(context, { summaryTaskId: taskId });
  return `[${escapeMarkdownLabel(displayLabel)}](${href ?? `group-chat://summary/${taskId}`})`;
}

function buildGroupChatAppMentionHref(
  context: AgentGuiDraftPromptContext,
  params: { messageId?: string; summaryTaskId?: string; conversationId?: string },
) {
  const workspaceId = context.workspaceId?.trim() || readCachedTuttiWorkspaceId() || null;
  if (!workspaceId) return null;
  const url = new URL("mention://workspace-app/group-chat");
  url.searchParams.set("workspaceId", workspaceId);
  if (params.messageId) {
    url.searchParams.set("messageId", params.messageId);
  }
  if (params.summaryTaskId) {
    url.searchParams.set("summaryTaskId", params.summaryTaskId);
  }
  if (params.conversationId) {
    url.searchParams.set("conversationId", params.conversationId);
  }
  return url.toString();
}

function escapeMarkdownLabel(label: string) {
  return label.replace(/\\/g, "\\\\").replace(/\[/g, "\\[");
}
