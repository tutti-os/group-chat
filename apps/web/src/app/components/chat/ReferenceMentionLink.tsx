import type { Artifact, MentionTarget, Participant, RuntimeProfile } from "@group-chat/shared";
import type { ReactNode } from "react";
import { openAgentGuiProvider } from "../../agent-gui-dispatch.js";
import {
  resolveAgentGuiProviderFromAppId,
  resolveAgentLauncherRuntimeProvider,
} from "../../agent-launcher-mentions.js";
import { parseTuttiAtMentionKey } from "../../tutti-at-mentions.js";
import {
  formatParticipantMentionMarkdown,
  isParticipantMentionHref,
  isReferenceMentionHref,
  parseParticipantMentionHref,
  parseReferenceMentionHref,
} from "../../reference-mentions.js";
import { openReferenceMentionTarget } from "../../reference-mention-open.js";
import { buildTuttiMentionHref, isOpenableTuttiReferenceProvider } from "../../tutti-bridge.js";
import { AgentLauncherMentionChip, PARTICIPANT_MENTION_CLASS, ReferenceMentionChip } from "./reference-mention-chip.js";

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

function resolveParticipantMentionTarget(
  href: string,
  participants: Participant[] | undefined,
): Participant | null {
  const participantId = parseParticipantMentionHref(href)?.participantId;
  if (!participantId) return null;
  return participants?.find((item) => item.id === participantId) ?? null;
}

function ParticipantMentionLink(props: {
  children?: ReactNode;
  participant: Participant;
  pasteMarkdown?: string;
  onOpenAgentProfile: (participant: Participant) => void;
}) {
  const openProfile = () => {
    props.onOpenAgentProfile(props.participant);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      data-composer-paste-markdown={props.pasteMarkdown}
      className={`${PARTICIPANT_MENTION_CLASS} [cursor:pointer] hover:[opacity:0.85]`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openProfile();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        openProfile();
      }}
    >
      {props.children}
    </span>
  );
}

export function ReferenceMentionLink(props: {
  href?: string;
  children?: ReactNode;
  mentions?: Array<Pick<MentionTarget, "participantId" | "mentionType" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope">>;
  artifacts?: Artifact[];
  participants?: Participant[];
  runtimeProfiles?: RuntimeProfile[];
  onOpenAgentProfile?: (participant: Participant) => void;
}) {
  const href = props.href ?? "";
  if (isParticipantMentionHref(href)) {
    const participant = resolveParticipantMentionTarget(href, props.participants);
    const label = referenceLabel(props.children) || participant?.displayName || "";
    const participantId = parseParticipantMentionHref(href)?.participantId ?? participant?.id;
    const pasteMarkdown = participantId
      ? formatParticipantMentionMarkdown(participantId, label || participant?.displayName || "")
      : undefined;
    if (participant && props.onOpenAgentProfile) {
      return (
        <ParticipantMentionLink
          participant={participant}
          pasteMarkdown={pasteMarkdown}
          onOpenAgentProfile={props.onOpenAgentProfile}
        >
          {props.children}
        </ParticipantMentionLink>
      );
    }
    return (
      <span className={PARTICIPANT_MENTION_CLASS} data-composer-paste-markdown={pasteMarkdown}>
        {props.children}
      </span>
    );
  }
  if (!isReferenceMentionHref(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="[color:#2563eb] [text-decoration:underline]">
        {props.children}
      </a>
    );
  }

  const mention = resolveMentionMeta(href, props.mentions ?? []);
  const label = referenceLabel(props.children) || String(props.children ?? "");
  const pasteMarkdown = `[${label}](${href})`;
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

  const entityId = mention?.referenceEntityId?.trim() || parsed?.entityId || "";
  const guiProvider = providerId === "workspace-app" ? resolveAgentGuiProviderFromAppId(entityId) : null;
  const launcherRuntimeProvider = resolveAgentLauncherRuntimeProvider(entityId);

  if (guiProvider && launcherRuntimeProvider) {
    return (
      <AgentLauncherMentionChip
        label={label || props.children}
        runtimeProvider={launcherRuntimeProvider}
        pasteMarkdown={pasteMarkdown}
        onClick={() => {
          void openAgentGuiProvider(guiProvider);
        }}
      />
    );
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
      entityId={entityId}
      iconUrl={mention?.referenceScope?.iconUrl}
      pasteMarkdown={pasteMarkdown}
      onClick={handleOpen}
    />
  );
}

export function createReferenceMentionMarkdownComponents(options?: {
  mentions?: Array<Pick<MentionTarget, "participantId" | "mentionType" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope">>;
  artifacts?: Artifact[];
  participants?: Participant[];
  runtimeProfiles?: RuntimeProfile[];
  onOpenAgentProfile?: (participant: Participant) => void;
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
      <ReferenceMentionLink
        href={href}
        mentions={options?.mentions}
        artifacts={options?.artifacts}
        participants={options?.participants}
        runtimeProfiles={options?.runtimeProfiles}
        onOpenAgentProfile={options?.onOpenAgentProfile}
      >
        {children}
      </ReferenceMentionLink>
    ),
  };
}
