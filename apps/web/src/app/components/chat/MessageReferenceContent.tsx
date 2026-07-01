import type { Artifact, MentionTarget, Participant, RuntimeProfile } from "@group-chat/shared";
import type { ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeLocalFileHref } from "../../tutti-bridge.js";
import { contentHasReferenceMentions, findArtifactForFileReference, isFileReferenceProvider, parseReferenceMentionHref, splitContentByReferenceMentions } from "../../reference-mentions.js";
import { ArtifactBlock } from "./MessageTimeline.js";
import { ReferenceMentionLink, createReferenceMentionMarkdownComponents } from "./ReferenceMentionLink.js";

const INLINE_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => <span className="[display:contents]">{children}</span>,
};

function messageReferenceUrlTransform(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("group-chat://") || trimmed.startsWith("mention://")) {
    return value;
  }
  if (trimmed.startsWith("file://") || normalizeLocalFileHref(trimmed)) {
    return value;
  }
  return defaultUrlTransform(value);
}

function renderMarkdownSegment(
  text: string,
  markdownComponents: ReturnType<typeof createReferenceMentionMarkdownComponents> | undefined,
) {
  if (!text) return null;
  const leadingWhitespace = text.match(/^[ \t]+/)?.[0] ?? "";
  const trailingWhitespace = text.match(/[ \t]+$/)?.[0] ?? "";
  const markdownText = text.slice(leadingWhitespace.length, text.length - trailingWhitespace.length);
  if (!markdownText) return text;
  return (
    <>
      {leadingWhitespace}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents ?? INLINE_MARKDOWN_COMPONENTS}
        urlTransform={messageReferenceUrlTransform}
      >
        {markdownText}
      </ReactMarkdown>
      {trailingWhitespace}
    </>
  );
}

export function MessageReferenceContent(props: {
  content: string;
  mentions?: Array<Pick<MentionTarget, "participantId" | "mentionType" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope">>;
  artifacts?: Artifact[];
  participants?: Participant[];
  runtimeProfiles?: RuntimeProfile[];
  onOpenAgentProfile?: (participant: Participant) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
  tightSpacing?: boolean;
}) {
  const markdownComponents = createReferenceMentionMarkdownComponents({
    mentions: props.mentions,
    artifacts: props.artifacts,
    participants: props.participants,
    runtimeProfiles: props.runtimeProfiles,
    onOpenAgentProfile: props.onOpenAgentProfile,
    tightSpacing: props.tightSpacing,
  });

  if (!contentHasReferenceMentions(props.content)) {
    return renderMarkdownSegment(props.content, markdownComponents);
  }

  const segments = splitContentByReferenceMentions(props.content);
  return (
    <span className={props.tightSpacing ? "[display:contents] [line-height:1.35]" : "[display:contents]"}>
      {segments.map((segment, index) => {
        if (segment.kind === "reference") {
          const parsed = segment.href.startsWith("mention://")
            ? null
            : parseReferenceMentionHref(segment.href);
          const mention = props.mentions?.find((item) =>
            item.mentionType === "reference"
            && parsed
            && item.referenceProviderId === parsed.providerId
            && (item.referenceEntityId === parsed.entityId
              || item.participantId === `tutti-at:${parsed.providerId}:${parsed.entityId}`),
          );
          const providerId = mention?.referenceProviderId ?? parsed?.providerId;
          const entityId = mention?.referenceEntityId?.trim() || parsed?.entityId || "";
          if (
            isFileReferenceProvider(providerId)
            && props.artifacts?.length
            && props.onOpenArtifact
          ) {
            const artifact = findArtifactForFileReference(segment.href, entityId, mention, props.artifacts);
            if (artifact) {
              return (
                <ArtifactBlock
                  key={`reference-${index}`}
                  artifact={artifact}
                  onOpen={() => props.onOpenArtifact!(artifact)}
                />
              );
            }
          }
          return (
            <ReferenceMentionLink
              key={`reference-${index}`}
              href={segment.href}
              mentions={props.mentions}
              artifacts={props.artifacts}
              participants={props.participants}
              runtimeProfiles={props.runtimeProfiles}
              onOpenAgentProfile={props.onOpenAgentProfile}
            >
              {segment.label}
            </ReferenceMentionLink>
          );
        }
        return (
          <span key={`text-${index}`} className="[display:contents]">
            {renderMarkdownSegment(segment.text, markdownComponents)}
          </span>
        );
      })}
    </span>
  );
}
