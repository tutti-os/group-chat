import type { Artifact, MentionTarget, Participant, RuntimeProfile } from "@group-chat/shared";
import { isValidElement, type ReactNode } from "react";
import { openLocalFileInSystem } from "../../../api/client.js";
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
import { revealArtifactInTuttiFileManager } from "../../artifact-actions.js";
import {
  buildTuttiMentionHref,
  buildTuttiOpenFileRequestForHref,
  isOpenableTuttiReferenceProvider,
  localFileHrefToBrowserHref,
  normalizeLocalFileHref,
  tryOpenFileInTutti,
} from "../../tutti-bridge.js";
import { AgentLauncherMentionChip, PARTICIPANT_MENTION_CLASS, ReferenceMentionChip } from "./reference-mention-chip.js";

const PLAIN_LINK_CLASS = "[color:#2563eb] [text-decoration:underline]";
const INLINE_CODE_LINK_CLASS = "[border:1px_solid_rgb(226_232_240)] [border-radius:5px] [padding:1px_4px] [color:#1d4ed8] [background:#f1f5f9] [font-family:ui-monospace,_SFMono-Regular,_Menlo,_Monaco,_Consolas,_monospace] [font-size:0.95em] [text-decoration:none] hover:[text-decoration:underline]";

function joinClassName(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ");
}

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

function referenceLabel(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) {
    return children.map((child) => referenceLabel(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return referenceLabel(children.props.children);
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

function normalizeFileLinkCandidate(value: string | undefined) {
  return value?.replace(/\\/g, "/").trim().replace(/[?#].*$/, "") ?? "";
}

function findArtifactForLocalFileLink(
  href: string,
  label: string,
  artifacts: Artifact[] | undefined,
) {
  const normalizedHref = normalizeFileLinkCandidate(normalizeLocalFileHref(href) ?? href);
  const normalizedLabel = normalizeFileLinkCandidate(label);
  if (!normalizedHref && !normalizedLabel) return null;
  return artifacts?.find((artifact) => {
    const localPath = normalizeFileLinkCandidate(artifact.localPath);
    const publicUrl = normalizeFileLinkCandidate(artifact.publicUrl);
    const filename = normalizeFileLinkCandidate(artifact.filename);
    return [normalizedHref, normalizedLabel].some((candidate) =>
      Boolean(
        candidate
        && (candidate === artifact.id
          || candidate === filename
          || localPath === candidate
          || localPath.endsWith(`/${candidate}`)
          || publicUrl === candidate
          || publicUrl.endsWith(`/${candidate}`)),
      )
    );
  }) ?? null;
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
  className?: string;
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
    const label = referenceLabel(props.children);
    const linkedArtifact = findArtifactForLocalFileLink(href, label, props.artifacts);
    const localFileRequest = buildTuttiOpenFileRequestForHref(href, label || undefined, "reveal");
    const linkHref = linkedArtifact || localFileRequest ? localFileHrefToBrowserHref(href) : href;
    const openLocalFile = linkedArtifact || localFileRequest
      ? (event: React.MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          event.stopPropagation();
          if (linkedArtifact) {
            revealArtifactInTuttiFileManager(linkedArtifact);
            return;
          }
          void (async () => {
            if (!localFileRequest) return;
            if (await tryOpenFileInTutti(localFileRequest)) return;
            try {
              await openLocalFileInSystem(localFileRequest.path);
            } catch {
              // The browser's file:// fallback is intentionally suppressed in Tutti WebViews.
            }
          })();
        }
      : undefined;
    return (
      <a
        href={linkHref}
        target="_blank"
        rel="noreferrer"
        className={joinClassName(props.className ?? PLAIN_LINK_CLASS)}
        onClick={openLocalFile}
      >
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

  const entityId = mention?.referenceEntityId?.trim() || parsed?.entityId || "";
  const guiProvider = providerId === "workspace-app" ? resolveAgentGuiProviderFromAppId(entityId) : null;
  const launcherRuntimeProvider = resolveAgentLauncherRuntimeProvider(entityId);
  const mentionHref = href.startsWith("mention://")
    ? href
    : isOpenableTuttiReferenceProvider(providerId)
      ? buildTuttiMentionHref(providerId, entityId, {
          referenceInsert: mention?.referenceInsert,
          referenceScope: mention?.referenceScope,
        }) ?? href
      : href;
  const pasteMarkdown = `[${label}](${mentionHref})`;

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
    p: ({ children }: { children?: ReactNode }) => (
      <span
        data-slot={options?.tightSpacing ? "whisper-body" : undefined}
        className={`${options?.tightSpacing ? "[line-height:1.35]" : "[line-height:1.45]"} [display:inline] [margin:0] [white-space:pre-wrap]`}
      >
        {children}
      </span>
    ),
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
    code: ({ children, className }: { children?: ReactNode; className?: string }) => {
      const label = referenceLabel(children);
      const isBlock = Boolean(className) || label.includes("\n");
      if (!isBlock && (normalizeLocalFileHref(label) || /^https?:\/\//i.test(label.trim()))) {
        return (
          <ReferenceMentionLink href={label} className={INLINE_CODE_LINK_CLASS}>
            {children}
          </ReferenceMentionLink>
        );
      }
      return <code className={className}>{children}</code>;
    },
  };
}
