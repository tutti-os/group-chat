import type { MentionTarget, TuttiAtProviderId, TuttiReferenceInsert } from "@group-chat/shared";
import { TUTTI_AT_PROVIDER_IDS } from "@group-chat/shared";
import { parseTuttiAtMentionKey } from "./tutti-at-mentions.js";
import { buildTuttiMentionHref, isOpenableTuttiReferenceProvider } from "./tutti-bridge.js";

const REFERENCE_LINK_PREFIX = "group-chat://reference/";
const PARTICIPANT_MENTION_LINK_PREFIX = "group-chat://participant/";
const MENTION_LINK_PREFIX = "mention://";

export function isStyledReferenceProvider(providerId: TuttiAtProviderId | string | undefined): providerId is TuttiAtProviderId {
  return (
    providerId === "file"
    || providerId === "agent-generated-file"
    || providerId === "agent-session"
    || providerId === "workspace-app"
    || providerId === "workspace-issue"
  );
}

export function formatReferenceMentionHref(providerId: TuttiAtProviderId, entityId: string) {
  return `${REFERENCE_LINK_PREFIX}${providerId}/${encodeURIComponent(entityId)}`;
}

export function formatReferenceMentionMarkdown(
  providerId: TuttiAtProviderId,
  entityId: string,
  label: string,
  options?: {
    referenceInsert?: TuttiReferenceInsert;
    referenceScope?: Readonly<Record<string, string>>;
  },
) {
  const href = isOpenableTuttiReferenceProvider(providerId)
    ? buildTuttiMentionHref(providerId, entityId, options) ?? formatReferenceMentionHref(providerId, entityId)
    : formatReferenceMentionHref(providerId, entityId);
  const safeLabel = label.replace(/\\/g, "\\\\").replace(/\[/g, "\\[");
  return `[${safeLabel}](${href})`;
}

export function formatParticipantMentionMarkdown(participantId: string, label: string) {
  const displayLabel = `@${label.replace(/^@/, "")}`;
  const safeLabel = displayLabel.replace(/\\/g, "\\\\").replace(/\[/g, "\\[");
  return `[${safeLabel}](${PARTICIPANT_MENTION_LINK_PREFIX}${encodeURIComponent(participantId)})`;
}

export function parseParticipantMentionHref(href: string): { participantId: string } | null {
  if (!href.startsWith(PARTICIPANT_MENTION_LINK_PREFIX)) return null;
  const encodedParticipantId = href.slice(PARTICIPANT_MENTION_LINK_PREFIX.length);
  if (!encodedParticipantId) return null;
  try {
    return { participantId: decodeURIComponent(encodedParticipantId) };
  } catch {
    return null;
  }
}

export function isParticipantMentionHref(href: string | undefined | null) {
  return Boolean(href?.startsWith(PARTICIPANT_MENTION_LINK_PREFIX));
}

export function parseReferenceMentionHref(href: string): { providerId: TuttiAtProviderId; entityId: string } | null {
  if (!href.startsWith(REFERENCE_LINK_PREFIX)) return null;
  const rest = href.slice(REFERENCE_LINK_PREFIX.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) return null;
  const providerId = rest.slice(0, slashIndex) as TuttiAtProviderId;
  if (!TUTTI_AT_PROVIDER_IDS.includes(providerId)) return null;
  const encodedEntityId = rest.slice(slashIndex + 1);
  if (!encodedEntityId) return null;
  try {
    return { providerId, entityId: decodeURIComponent(encodedEntityId) };
  } catch {
    return null;
  }
}

export function isReferenceMentionHref(href: string | undefined | null) {
  return Boolean(
    href
    && (href.startsWith(REFERENCE_LINK_PREFIX)
      || href.startsWith(MENTION_LINK_PREFIX)
      || href.startsWith(PARTICIPANT_MENTION_LINK_PREFIX)),
  );
}

export function enrichContentWithParticipantMentions(
  content: string,
  mentions: Array<Pick<MentionTarget, "mentionType" | "displayNameSnapshot" | "participantId">>,
) {
  let result = content;
  const participantMentions = mentions
    .filter((mention) => mention.mentionType === "participant" || mention.mentionType === "all")
    .map((mention) => ({
      participantId: mention.participantId?.trim() ?? "",
      name: mention.displayNameSnapshot.trim(),
    }))
    .filter((mention) => mention.participantId && mention.name)
    .sort((left, right) => right.name.length - left.name.length);

  for (const mention of participantMentions) {
    const markdown = formatParticipantMentionMarkdown(mention.participantId, mention.name);
    if (result.includes(markdown)) continue;
    const escapedName = mention.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`@${escapedName}(?=\\s|$|[，。！？,.!?;:：；、])`, "g"), (match, offset) => {
      const before = result.slice(0, offset);
      if (/\[[^\]]*$/.test(before)) return match;
      return markdown;
    });
  }
  return result;
}

export function enrichContentWithReferenceMentions(
  content: string,
  mentions: Array<Pick<MentionTarget, "mentionType" | "displayNameSnapshot" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope">>,
) {
  let result = content;
  for (const mention of mentions) {
    if (mention.mentionType !== "reference") continue;
    if (!isStyledReferenceProvider(mention.referenceProviderId)) continue;
    const entityId = mention.referenceEntityId?.trim();
    const label = mention.displayNameSnapshot.trim();
    if (!entityId || !label) continue;
    const markdown = formatReferenceMentionMarkdown(mention.referenceProviderId, entityId, label, {
      referenceInsert: mention.referenceInsert,
      referenceScope: mention.referenceScope,
    });
    if (result.includes(markdown) || result.includes(`](${MENTION_LINK_PREFIX}`) && result.includes(entityId)) continue;
    const index = result.indexOf(label);
    if (index === -1) continue;
    const before = result.slice(0, index);
    if (/\[[^\]]*$/.test(before)) continue;
    result = `${result.slice(0, index)}${markdown}${result.slice(index + label.length)}`;
  }
  return result;
}

export function serializeReferenceMentionChip(element: HTMLElement) {
  const providerId = element.dataset.mentionReferenceProvider;
  const mentionId = element.dataset.mentionId ?? "";
  const label = element.dataset.mentionLabel?.trim() || element.textContent?.trim() || "";
  if (!isStyledReferenceProvider(providerId)) return label;

  const parsed = parseTuttiAtMentionKey(mentionId);
  const entityId = element.dataset.mentionReferenceEntityId?.trim() || parsed?.itemId || "";
  if (!entityId) return label;

  let referenceInsert: MentionTarget["referenceInsert"];
  let referenceScope: MentionTarget["referenceScope"];
  if (element.dataset.mentionReferenceInsert) {
    try {
      referenceInsert = JSON.parse(element.dataset.mentionReferenceInsert) as MentionTarget["referenceInsert"];
      if (referenceInsert?.kind === "mention") {
        referenceScope = referenceInsert.scope;
      }
    } catch {
      referenceInsert = undefined;
    }
  }

  return formatReferenceMentionMarkdown(providerId, entityId, label, {
    referenceInsert,
    referenceScope,
  });
}

export type ReferenceMentionContentSegment =
  | { kind: "text"; text: string }
  | { kind: "reference"; label: string; href: string };

const REFERENCE_MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(((?:group-chat:\/\/reference\/|group-chat:\/\/participant\/|mention:\/\/)[^)]+)\)/g;

export function contentHasReferenceMentions(content: string) {
  return content.includes(REFERENCE_LINK_PREFIX)
    || content.includes(MENTION_LINK_PREFIX)
    || content.includes(PARTICIPANT_MENTION_LINK_PREFIX);
}

export function splitContentByReferenceMentions(content: string): ReferenceMentionContentSegment[] {
  const segments: ReferenceMentionContentSegment[] = [];
  let lastIndex = 0;
  let matched = false;

  for (const match of content.matchAll(REFERENCE_MARKDOWN_LINK_PATTERN)) {
    matched = true;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", text: content.slice(lastIndex, index) });
    }
    segments.push({ kind: "reference", label: match[1]!, href: match[2]! });
    lastIndex = index + match[0].length;
  }

  if (!matched) {
    return [{ kind: "text", text: content }];
  }

  if (lastIndex < content.length) {
    segments.push({ kind: "text", text: content.slice(lastIndex) });
  }

  return segments;
}
