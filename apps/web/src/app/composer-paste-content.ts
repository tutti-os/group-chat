import type { Identity, LocalAgentProviderStatus, MentionTarget, Participant, RuntimeProfile, TuttiAtProviderId } from "@group-chat/shared";
import { findEmbeddedLinks } from "./chat-links.js";
import { buildLocalAgentLauncherReference } from "./local-agent-mention-options.js";
import {
  enrichContentWithParticipantMentions,
  enrichContentWithReferenceMentions,
  formatParticipantMentionMarkdown,
  formatReferenceMentionMarkdown,
  isParticipantMentionHref,
  isReferenceMentionHref,
  parseParticipantMentionHref,
  parseReferenceMentionHref,
} from "./reference-mentions.js";
import { defaultIdentityNameForRuntime, listCanonicalRuntimeProfiles, localAgentStatus } from "./runtime.js";
import type { TuttiAtQueryResult } from "./tutti-bridge.js";
import { readCachedTuttiWorkspaceId } from "./tutti-bridge.js";
import { tuttiAtMentionKey } from "./tutti-at-mentions.js";

export type ComposerPasteContext = {
  participants: Participant[];
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
  identities: Identity[];
};

export type ComposerPasteSegment =
  | { kind: "text"; text: string }
  | { kind: "reference"; label: string; href: string }
  | { kind: "participant"; participantId: string; label: string }
  | { kind: "message"; id: string }
  | { kind: "summary"; id: string };

const REFERENCE_MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(((?:group-chat:\/\/reference\/|group-chat:\/\/participant\/|mention:\/\/)[^)]+)\)/g;

export function enrichMessageContentForCopy(
  content: string,
  mentions: Array<Pick<MentionTarget, "mentionType" | "displayNameSnapshot" | "participantId" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope">>,
) {
  if (!mentions.length) return content;
  return enrichContentWithReferenceMentions(
    enrichContentWithParticipantMentions(content, mentions),
    mentions,
  );
}

export function normalizeComposerPasteText(html: string, plain: string) {
  const fromHtml = clipboardHtmlToComposerMarkdown(html);
  if (!fromHtml) return plain.replace(/\r\n?/g, "\n");
  const normalizedPlain = plain.replace(/\r\n?/g, "\n");
  if (!normalizedPlain.trim()) return fromHtml;
  if (fromHtml.includes("](group-chat://") || fromHtml.includes("](mention://")) return fromHtml;
  return normalizedPlain;
}

function clipboardHtmlToComposerMarkdown(html: string) {
  const trimmed = html.trim();
  if (!trimmed) return null;
  try {
    const doc = new DOMParser().parseFromString(trimmed, "text/html");
    const body = doc.body;
    if (!body) return null;
    const serialized = serializeClipboardNode(body).replace(/\u00a0/g, " ");
    return serialized.trim() ? serialized : null;
  } catch {
    return null;
  }
}

function serializeClipboardNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    let text = "";
    node.childNodes.forEach((child) => {
      text += serializeClipboardNode(child);
    });
    return text;
  }
  if (node.tagName === "BR") return "\n";
  if (node.tagName === "A") {
    const href = node.getAttribute("href")?.trim() ?? "";
    const label = serializeClipboardChildren(node);
    if (href && (isReferenceMentionHref(href) || isParticipantMentionHref(href))) {
      return `[${label}](${href})`;
    }
    if (href && (href.includes("group-chat://message/") || href.includes("group-chat://summary/"))) {
      return href;
    }
  }
  const pasteMarkdown = node.getAttribute("data-composer-paste-markdown")?.trim();
  if (pasteMarkdown) return pasteMarkdown;
  if (node.tagName === "DIV" || node.tagName === "P") {
    const inner = serializeClipboardChildren(node);
    return node.nextSibling ? `${inner}\n` : inner;
  }
  return serializeClipboardChildren(node);
}

function serializeClipboardChildren(node: HTMLElement) {
  let text = "";
  node.childNodes.forEach((child) => {
    text += serializeClipboardNode(child);
  });
  return text;
}

export function splitComposerPasteContent(
  value: string,
  context: ComposerPasteContext,
): ComposerPasteSegment[] {
  const normalized = value.replace(/\r\n?/g, "\n");
  const matches: Array<{ index: number; length: number; segment: ComposerPasteSegment }> = [];

  for (const match of normalized.matchAll(REFERENCE_MARKDOWN_LINK_PATTERN)) {
    const href = match[2]!;
    const label = match[1]!;
    const index = match.index ?? 0;
    if (isParticipantMentionHref(href)) {
      const participantId = parseParticipantMentionHref(href)?.participantId;
      if (!participantId) continue;
      matches.push({
        index,
        length: match[0].length,
        segment: {
          kind: "participant",
          participantId,
          label: label.replace(/^@+/, "").trim() || label,
        },
      });
      continue;
    }
    if (isReferenceMentionHref(href)) {
      matches.push({
        index,
        length: match[0].length,
        segment: { kind: "reference", label, href },
      });
    }
  }

  for (const link of findEmbeddedLinks(normalized)) {
    if (matches.some((item) => rangesOverlap(item.index, item.length, link.index, link.length))) continue;
    matches.push({
      index: link.index,
      length: link.length,
      segment: link.kind === "message"
        ? { kind: "message", id: link.id }
        : { kind: "summary", id: link.id },
    });
  }

  matches.sort((left, right) => left.index - right.index || right.length - left.length);

  const segments: ComposerPasteSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    if (match.index > cursor) {
      segments.push(...splitPlainComposerText(normalized.slice(cursor, match.index), context));
    }
    segments.push(match.segment);
    cursor = match.index + match.length;
  }
  if (cursor < normalized.length) {
    segments.push(...splitPlainComposerText(normalized.slice(cursor), context));
  }
  return segments.length ? segments : [{ kind: "text", text: normalized }];
}

function rangesOverlap(leftIndex: number, leftLength: number, rightIndex: number, rightLength: number) {
  return leftIndex < rightIndex + rightLength && rightIndex < leftIndex + leftLength;
}

function splitPlainComposerText(
  text: string,
  context: ComposerPasteContext,
): ComposerPasteSegment[] {
  if (!text) return [];
  const candidates = buildPlainAtMentionCandidates(context);
  const segments: ComposerPasteSegment[] = [];
  let cursor = 0;
  let index = text.indexOf("@");
  while (index !== -1) {
    if (index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, index) });
    }
    const resolved = resolvePlainAtMentionAt(text, index, candidates);
    if (resolved) {
      segments.push(resolved.segment);
      cursor = resolved.nextIndex;
      index = text.indexOf("@", cursor);
      continue;
    }
    cursor = index + 1;
    index = text.indexOf("@", cursor);
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments.length ? segments : [{ kind: "text", text }];
}

type PlainAtCandidate =
  | { kind: "participant"; participantId: string; label: string; match: string }
  | { kind: "reference"; label: string; href: string; match: string };

function buildPlainAtMentionCandidates(context: ComposerPasteContext): PlainAtCandidate[] {
  const candidates: PlainAtCandidate[] = [];
  for (const participant of context.participants) {
    if (participant.status === "removed") continue;
    const label = participant.displayName.trim();
    if (!label) continue;
    const match = `@${label.replace(/^@+/, "")}`;
    candidates.push({
      kind: "participant",
      participantId: participant.id,
      label,
      match,
    });
  }
  for (const profile of listCanonicalRuntimeProfiles(context.runtimeProfiles)) {
    if (profile.kind !== "local-agent") continue;
    const status = localAgentStatus(profile, context.localAgentProviders);
    if (!status?.available) continue;
    const label = status.displayName?.trim() || defaultIdentityNameForRuntime(profile, context.localAgentProviders);
    const reference = buildLocalAgentLauncherReference({
      kind: "local-agent",
      key: profile.id,
      label,
      subtitle: "",
      runtimeProfile: profile,
      participant: null,
    });
    const displayLabel = label.replace(/^@+/, "");
    const href = extractMarkdownLinkHref(formatReferenceMentionMarkdown(
      reference.providerId,
      reference.itemId,
      `@${displayLabel}`,
      {
        referenceInsert: reference.insert,
        referenceScope: reference.insert.kind === "mention" ? reference.insert.scope : undefined,
      },
    ));
    if (!href) continue;
    candidates.push({
      kind: "reference",
      label: displayLabel,
      href,
      match: `@${displayLabel}`,
    });
  }
  return candidates.sort((left, right) => right.match.length - left.match.length);
}

function resolvePlainAtMentionAt(text: string, atIndex: number, candidates: PlainAtCandidate[]) {
  for (const candidate of candidates) {
    if (!text.startsWith(candidate.match, atIndex)) continue;
    const nextIndex = atIndex + candidate.match.length;
    if (nextIndex < text.length && !/[\s，。！？,.!?;:：；、]/.test(text[nextIndex]!)) continue;
    if (candidate.kind === "participant") {
      return {
        nextIndex,
        segment: {
          kind: "participant" as const,
          participantId: candidate.participantId,
          label: candidate.label,
        },
      };
    }
    return {
      nextIndex,
      segment: {
        kind: "reference" as const,
        label: candidate.label,
        href: candidate.href,
      },
    };
  }
  return null;
}

export function buildReferencePasteTarget(href: string, label: string): {
  mentionId: string;
  chipLabel: string;
  reference: TuttiAtQueryResult;
} | null {
  const participant = parseParticipantMentionHref(href);
  if (participant) return null;

  const parsedReference = parseReferenceMentionHref(href);
  const parsedMention = parsedReference ? null : parseMentionProtocolHref(href);
  const providerId = (parsedReference?.providerId ?? parsedMention?.providerId) as TuttiAtProviderId | undefined;
  const entityId = parsedReference?.entityId ?? parsedMention?.entityId;
  if (!providerId || !entityId) return null;

  const chipLabel = label.replace(/^@+/, "").trim() || entityId;
  const scope = parsedMention?.scope ?? {};
  const workspaceId = scope.workspaceId?.trim() || readCachedTuttiWorkspaceId()?.trim();
  const insertScope = workspaceId ? { ...scope, workspaceId } : scope;
  const reference: TuttiAtQueryResult = {
    providerId,
    itemId: entityId,
    label: chipLabel,
    insert: {
      kind: "mention",
      entityId,
      label: chipLabel,
      scope: insertScope,
    },
  };
  return {
    mentionId: tuttiAtMentionKey(providerId, entityId),
    chipLabel,
    reference,
  };
}

export function buildParticipantPasteMarkdown(participantId: string, label: string) {
  return formatParticipantMentionMarkdown(participantId, label);
}

function extractMarkdownLinkHref(markdown: string) {
  const match = markdown.match(/\(([^)]+)\)$/);
  return match?.[1]?.trim() ?? null;
}

function parseMentionProtocolHref(href: string) {
  if (!href.startsWith("mention://")) return null;
  try {
    const url = new URL(href);
    const providerId = url.hostname as TuttiAtProviderId;
    const entityId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!providerId || !entityId) return null;
    const scope: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      if (value.trim()) scope[key] = value.trim();
    });
    return { providerId, entityId, scope };
  } catch {
    return null;
  }
}
