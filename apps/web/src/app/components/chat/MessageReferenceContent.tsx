import type { Artifact, MentionTarget } from "@group-chat/shared";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { contentHasReferenceMentions, splitContentByReferenceMentions } from "../../reference-mentions.js";
import { ReferenceMentionLink, createReferenceMentionMarkdownComponents } from "./ReferenceMentionLink.js";

const INLINE_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => <span className="[display:contents]">{children}</span>,
};

function renderMarkdownSegment(
  text: string,
  markdownComponents: ReturnType<typeof createReferenceMentionMarkdownComponents> | undefined,
) {
  if (!text) return null;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents ?? INLINE_MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

export function MessageReferenceContent(props: {
  content: string;
  mentions?: Array<Pick<MentionTarget, "participantId" | "mentionType" | "referenceProviderId" | "referenceEntityId" | "referenceInsert">>;
  artifacts?: Artifact[];
  tightSpacing?: boolean;
}) {
  const markdownComponents = createReferenceMentionMarkdownComponents({
    mentions: props.mentions,
    artifacts: props.artifacts,
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
          return (
            <ReferenceMentionLink
              key={`reference-${index}`}
              href={segment.href}
              mentions={props.mentions}
              artifacts={props.artifacts}
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
