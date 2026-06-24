import type { MentionTarget } from "./index.js";
import { sanitizeRichTextMentionScopeForAgentContext } from "@tutti-os/ui-rich-text/core";

type MessageLike = {
  conversationId: string;
  createdAt: string;
  role: string;
  status?: string;
  content?: string;
  mentions: MentionTarget[];
};

const ISSUE_ID_PATTERN = /\b(issue-[a-f0-9]{16,})\b/gi;
const TASK_TITLE_PATTERNS = [
  /任务标题[：:]\s*(?:\*\*)?([^\n*`]+?)(?:\*\*)?(?=\s*$|\s*\n)/m,
  /(?:Task [Tt]itle|Issue [Tt]itle)[：:]\s*(?:\*\*)?([^\n*`]+?)(?:\*\*)?(?=\s*$|\s*\n)/m,
];
const TOPIC_LINE_PATTERN = /Topic[：:]\s*(?:\*\*)?\s*`([^`]+)`/i;

type WorkspaceScope = Readonly<Record<string, string>>;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveReferenceScope(
  mention: Pick<MentionTarget, "referenceScope" | "referenceInsert">,
): WorkspaceScope | undefined {
  if (mention.referenceInsert?.kind === "mention" && mention.referenceInsert.mention.scope) {
    return mention.referenceInsert.mention.scope;
  }
  return mention.referenceScope;
}

function resolveWorkspaceScope(mentions: MentionTarget[]): WorkspaceScope | undefined {
  for (const mention of mentions) {
    if (mention.mentionType !== "reference") continue;
    const scope = resolveReferenceScope(mention);
    if (scope?.workspaceId?.trim()) return scope;
  }
  return undefined;
}

function extractTopicIdFromContent(content: string) {
  const match = content.match(TOPIC_LINE_PATTERN);
  return match?.[1]?.trim() || undefined;
}

function buildMentionHref(
  providerId: "workspace-app" | "workspace-issue" | "agent-session",
  entityId: string,
  scope?: WorkspaceScope,
) {
  const normalizedEntityId = entityId.trim();
  if (!normalizedEntityId) return null;
  const url = new URL(`mention://${providerId}/${encodeURIComponent(normalizedEntityId)}`);
  const workspaceId = scope?.workspaceId?.trim();
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  if (providerId === "workspace-issue") {
    for (const key of ["topicId", "mode", "outputDir", "runId", "taskId"] as const) {
      const value = scope?.[key]?.trim();
      if (value) url.searchParams.set(key, value);
    }
  }
  if (providerId === "agent-session" && scope?.provider?.trim()) {
    url.searchParams.set("provider", scope.provider.trim());
  }
  return url.toString();
}

function formatMentionMarkdown(label: string, href: string) {
  const safeLabel = label.replace(/\\/g, "\\\\").replace(/\[/g, "\\[");
  return `[${safeLabel}](${href})`;
}

function isResourceAlreadyLinked(content: string, providerId: string, entityId: string) {
  const encodedEntityId = encodeURIComponent(entityId);
  const patterns = [
    new RegExp(`\\]\\(mention://${escapeRegExp(providerId)}/[^)]*${escapeRegExp(entityId)}`, "i"),
    new RegExp(`\\]\\(mention://${escapeRegExp(providerId)}/${escapeRegExp(encodedEntityId)}`, "i"),
    new RegExp(`\\]\\(group-chat://reference/${escapeRegExp(providerId)}/${escapeRegExp(encodedEntityId)}`, "i"),
    new RegExp(`\\]\\(group-chat://reference/${escapeRegExp(providerId)}/${escapeRegExp(entityId)}`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(content));
}

function extractTaskTitle(content: string) {
  for (const pattern of TASK_TITLE_PATTERNS) {
    const match = content.match(pattern);
    const title = match?.[1]?.trim();
    if (title) return title;
  }
  return undefined;
}

function buildIssueMentionTarget(
  issueId: string,
  title: string,
  scope?: WorkspaceScope,
): MentionTarget {
  return {
    participantId: issueId,
    displayNameSnapshot: title,
    mentionType: "reference",
    referenceProviderId: "workspace-issue",
    referenceEntityId: issueId,
    referenceScope: scope,
    referenceInsert: scope
      ? {
          kind: "mention",
          mention: {
            entityId: issueId,
            label: title,
            scope,
          },
        }
      : undefined,
  };
}

function injectIssueLinks(
  content: string,
  issueIds: string[],
  scope?: WorkspaceScope,
): { content: string; mentions: MentionTarget[] } {
  let result = content;
  const mentions: MentionTarget[] = [];

  for (const issueId of issueIds) {
    const title = extractTaskTitle(result) ?? issueId;
    const href = buildMentionHref("workspace-issue", issueId, scope);
    if (!href) continue;
    const markdown = formatMentionMarkdown(title, href);
    const alreadyLinked = isResourceAlreadyLinked(result, "workspace-issue", issueId);

    if (!alreadyLinked) {
      for (const pattern of TASK_TITLE_PATTERNS) {
        const titleMatch = result.match(pattern);
        const plainTitle = titleMatch?.[1]?.trim();
        if (!plainTitle) continue;
        const bulletTitleLinePattern = new RegExp(
          `^([-*•]?\\s*\\*{0,2}任务标题[：:](?:\\*\\*)?\\s*)(?:\\*\\*)?${escapeRegExp(plainTitle)}(?:\\*\\*)?\\s*$`,
          "m",
        );
        if (bulletTitleLinePattern.test(result)) {
          result = result.replace(bulletTitleLinePattern, `$1${markdown}`);
          break;
        }
        const englishBulletTitleLinePattern = new RegExp(
          `^([-*•]?\\s*\\*{0,2}(?:Task [Tt]itle|Issue [Tt]itle)[：:](?:\\*\\*)?\\s*)(?:\\*\\*)?${escapeRegExp(plainTitle)}(?:\\*\\*)?\\s*$`,
          "m",
        );
        if (englishBulletTitleLinePattern.test(result)) {
          result = result.replace(englishBulletTitleLinePattern, `$1${markdown}`);
          break;
        }
      }

      const issueIdLinePatterns = [
        new RegExp(
          `^[-*•]?\\s*\\*{0,2}Issue ID\\*{0,2}[：:]\\s*(?:\\*\\*)?\\s*\`?${escapeRegExp(issueId)}\`?\\s*(?:\\*\\*)?\\s*$\\n?`,
          "gim",
        ),
        new RegExp(
          `^[-*•]?\\s*\\*{0,2}Issue ID[：:](?:\\*\\*)?\\s*\`?${escapeRegExp(issueId)}\`?\\s*$\\n?`,
          "gim",
        ),
      ];
      for (const pattern of issueIdLinePatterns) {
        result = result.replace(pattern, () => `- **任务：** ${markdown}\n`);
      }

      if (!isResourceAlreadyLinked(result, "workspace-issue", issueId)) {
        result = `${result.trimEnd()}\n\n${markdown}`;
      }
    }

    mentions.push(buildIssueMentionTarget(issueId, title, scope));
  }

  return { content: result, mentions };
}

function injectAppLink(
  content: string,
  appMention: MentionTarget,
  scope?: WorkspaceScope,
): { content: string; mention: MentionTarget | null } {
  const appId = appMention.referenceEntityId?.trim();
  const appLabel = appMention.displayNameSnapshot.trim();
  if (!appId || !appLabel) return { content, mention: null };
  if (isResourceAlreadyLinked(content, "workspace-app", appId)) {
    return { content, mention: null };
  }

  const appScope = resolveReferenceScope(appMention) ?? scope;
  const href = buildMentionHref("workspace-app", appId, appScope);
  if (!href) return { content, mention: null };

  const appMarkdown = formatMentionMarkdown(appLabel, href);
  const intro = `已在 ${appMarkdown} 中处理：`;
  if (content.includes(intro) || content.includes(appMarkdown)) {
    return { content, mention: null };
  }

  return {
    content: `${intro}\n\n${content}`,
    mention: {
      participantId: appId,
      displayNameSnapshot: appLabel,
      mentionType: "reference",
      referenceProviderId: "workspace-app",
      referenceEntityId: appId,
      referenceScope: appScope,
      referenceInsert: appMention.referenceInsert,
    },
  };
}

export function enrichAssistantContentWithWorkspaceResourceLinks(
  content: string,
  userMentions: MentionTarget[],
): { content: string; mentions: MentionTarget[] } {
  const trimmed = content.trim();
  if (!trimmed) return { content, mentions: [] };

  const baseScope = resolveWorkspaceScope(userMentions);
  const topicId = extractTopicIdFromContent(trimmed);
  const scope = topicId && baseScope
    ? { ...baseScope, topicId }
    : topicId
      ? { topicId }
      : baseScope;

  const issueIds = Array.from(
    new Set(
      Array.from(trimmed.matchAll(ISSUE_ID_PATTERN))
        .map((match) => match[1]!.toLowerCase()),
    ),
  );
  if (!issueIds.length) return { content, mentions: [] };

  const issueResult = injectIssueLinks(trimmed, issueIds, scope);
  const appMention = userMentions.find(
    (mention) => mention.mentionType === "reference" && mention.referenceProviderId === "workspace-app",
  );
  if (!appMention) {
    return issueResult;
  }

  const appResult = injectAppLink(issueResult.content, appMention, scope);
  return {
    content: appResult.content,
    mentions: appResult.mention
      ? [...issueResult.mentions, appResult.mention]
      : issueResult.mentions,
  };
}

const REFERENCE_MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(((?:group-chat:\/\/reference\/|mention:\/\/)[^)]+)\)/g;

function parseReferenceMentionsFromContent(content: string): MentionTarget[] {
  const mentions: MentionTarget[] = [];
  for (const match of content.matchAll(REFERENCE_MARKDOWN_LINK_PATTERN)) {
    const label = match[1]?.trim();
    const href = match[2]?.trim();
    if (!label || !href) continue;
    if (href.startsWith("mention://")) {
      try {
        const url = new URL(href);
        const providerId = url.hostname;
        const entityId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        if (providerId !== "workspace-app" && providerId !== "workspace-issue" && providerId !== "agent-session") {
          continue;
        }
        const scope = sanitizeRichTextMentionScopeForAgentContext(Object.fromEntries(url.searchParams.entries()));
        mentions.push({
          participantId: entityId,
          displayNameSnapshot: label,
          mentionType: "reference",
          referenceProviderId: providerId,
          referenceEntityId: entityId,
          referenceScope: scope,
          referenceInsert: scope
            ? {
                kind: "mention",
                mention: {
                  entityId,
                  label,
                  scope,
                },
              }
            : undefined,
        });
      } catch {
        continue;
      }
      continue;
    }
    const rest = href.slice("group-chat://reference/".length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex <= 0) continue;
    const providerId = rest.slice(0, slashIndex);
    const entityId = decodeURIComponent(rest.slice(slashIndex + 1));
    if (providerId !== "workspace-app" && providerId !== "workspace-issue" && providerId !== "agent-session") {
      continue;
    }
    mentions.push({
      participantId: entityId,
      displayNameSnapshot: label,
      mentionType: "reference",
      referenceProviderId: providerId,
      referenceEntityId: entityId,
    });
  }
  return mentions;
}

export function resolveTriggerUserMentions(
  message: Pick<MessageLike, "conversationId" | "createdAt" | "role">,
  allMessages: Array<Pick<MessageLike, "conversationId" | "createdAt" | "role" | "status" | "mentions" | "content">>,
) {
  if (message.role !== "assistant") return [];
  for (let index = allMessages.length - 1; index >= 0; index -= 1) {
    const item = allMessages[index]!;
    if (item.conversationId !== message.conversationId) continue;
    if (item.createdAt >= message.createdAt) continue;
    if (item.role === "user" && item.status === "success") {
      const parsedFromContent = parseReferenceMentionsFromContent(item.content ?? "");
      return [...item.mentions, ...parsedFromContent];
    }
  }
  return [];
}
