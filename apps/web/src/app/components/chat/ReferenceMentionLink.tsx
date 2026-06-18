import type { Artifact, MentionTarget } from "@group-chat/shared";
import type { ReactNode } from "react";
import { parseTuttiAtMentionKey } from "../../tutti-at-mentions.js";
import { isReferenceMentionHref, parseReferenceMentionHref } from "../../reference-mentions.js";
import { openReferenceMentionTarget } from "../../reference-mention-open.js";
import { buildTuttiMentionHref, isOpenableTuttiReferenceProvider } from "../../tutti-bridge.js";
import { ReferenceMentionChip } from "./reference-mention-chip.js";

function resolveMentionMeta(
  href: string,
  mentions: Array<Pick<MentionTarget, "participantId" | "mentionType" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope">>,
) {
  const parsed = href.startsWith("mention://")
    ? null
    : parseReferenceMentionHref(href);
  return mentions.find((mention) => {
    if (mention.mentionType !== "reference") return false;
    if (parsed && mention.referenceProviderId !== parsed.providerId) return false;
    if (parsed && mention.referenceEntityId === parsed.entityId) return true;
    const key = parseTuttiAtMentionKey(mention.participantId);
    if (parsed) {
      return key?.providerId === parsed.providerId && key.itemId === parsed.entityId;
    }
    if (!href.startsWith("mention://")) return false;
    try {
      const url = new URL(href);
      const entityId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      return mention.referenceProviderId === url.hostname && mention.referenceEntityId === entityId;
    } catch {
      return false;
    }
  }) ?? null;
}

function referenceLabel(children: ReactNode) {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children.map((child) => (typeof child === "string" ? child : "")).join("");
  }
  return "";
}

export function ReferenceMentionLink(props: {
  href?: string;
  children?: ReactNode;
  mentions?: Array<Pick<MentionTarget, "participantId" | "mentionType" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope">>;
  artifacts?: Artifact[];
}) {
  const href = props.href ?? "";
  if (!isReferenceMentionHref(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="[color:#2563eb] [text-decoration:underline]">
        {props.children}
      </a>
    );
  }

  const mention = resolveMentionMeta(href, props.mentions ?? []);
  const label = referenceLabel(props.children) || String(props.children ?? "");
  const parsed = href.startsWith("mention://")
    ? (() => {
        try {
          const url = new URL(href);
          return {
            providerId: url.hostname,
            entityId: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
          };
        } catch {
          return null;
        }
      })()
    : parseReferenceMentionHref(href);
  const providerId = (mention?.referenceProviderId ?? parsed?.providerId) as MentionTarget["referenceProviderId"] | undefined;
  if (!providerId) {
    return <span>{props.children}</span>;
  }

  const mentionHref = href.startsWith("mention://")
    ? href
    : isOpenableTuttiReferenceProvider(providerId)
      ? buildTuttiMentionHref(providerId, mention?.referenceEntityId?.trim() || parsed?.entityId || "", {
          referenceInsert: mention?.referenceInsert,
          referenceScope: mention?.referenceScope,
        }) ?? href
      : href;

  const handleOpen = () => {
    openReferenceMentionTarget(mentionHref, label, mention, props.artifacts ?? []);
  };

  return (
    <ReferenceMentionChip
      providerId={providerId}
      label={props.children}
      onClick={handleOpen}
    />
  );
}

export function createReferenceMentionMarkdownComponents(options?: {
  mentions?: Array<Pick<MentionTarget, "participantId" | "mentionType" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope">>;
  artifacts?: Artifact[];
  tightSpacing?: boolean;
}) {
  return {
    ...(options?.tightSpacing
      ? {
          p: ({ children }: { children?: ReactNode }) => (
            <span data-slot="whisper-body" className="[display:block] [margin:0] [line-height:1.35] [white-space:pre-wrap]">{children}</span>
          ),
        }
      : {}),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <ReferenceMentionLink href={href} mentions={options?.mentions} artifacts={options?.artifacts}>
        {children}
      </ReferenceMentionLink>
    ),
  };
}
