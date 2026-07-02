import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BrainCircuit, MessageSquare, Search, X } from "lucide-react";
import type { Artifact, Conversation, Identity, Message, MessageBlock, Participant, Room, RuntimeProfile } from "@group-chat/shared";
import type { BackgroundTask } from "../../background-tasks.js";
import { formatShortDate } from "../../formatting.js";
import { extractMessageLinks, extractSummaryLinks, messageSenderLabel, primaryMessageLinkId, removeEmbeddedLinks } from "../../chat-links.js";
import { attachmentLabel, useTranslation } from "../../i18n/index.js";
import { findArtifactForFileReference, isFileReferenceProvider, parseReferenceMentionHref, splitContentByReferenceMentions } from "../../reference-mentions.js";
import { findSearchTextMatches, normalizeSearchQuery, searchTextIncludes } from "../../search-text.js";
import { resolveSummaryCardPresentation } from "../../summary-link-card.js";
import { ArtifactBlock } from "./MessageTimeline.js";
import { ReferenceMentionLink } from "./ReferenceMentionLink.js";

export function ChatMessageSearch(props: {
  open: boolean;
  messages: Message[];
  allMessages: Message[];
  allBlocks: MessageBlock[];
  artifacts: Artifact[];
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  conversations: Conversation[];
  rooms: Room[];
  summaryTasks: BackgroundTask[];
  userDisplayName?: string;
  onClose: () => void;
  onFocusMessage: (messageId: string) => void;
  onOpenMessageLink: (messageIdSegment: string) => void;
  onOpenSummaryLink: (taskId: string) => void;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  onOpenArtifact?: (artifact: Artifact) => void;
  onOpenAgentProfile?: (participant: Participant) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = normalizeSearchQuery(query);

  useEffect(() => {
    if (!props.open) {
      setQuery("");
      return;
    }
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [props.onClose, props.open]);

  const results = useMemo(() => {
    if (!normalizedQuery) return [];
    return props.messages
      .filter((message) => message.status !== "deleted" && message.status !== "recalled")
      .filter((message) => {
        const sender = messageSenderLabel(message, props.participants, props.identities, props.userDisplayName);
        return [message.content, sender].some((value) => searchTextIncludes(value, normalizedQuery));
      })
      .slice()
      .reverse()
      .slice(0, 50);
  }, [normalizedQuery, props.identities, props.messages, props.participants, props.userDisplayName]);

  if (!props.open) return null;

  return (
    <aside
      className={"[grid-column:2] [grid-row:2_/_4] [display:grid] [min-width:0] [min-height:0] [grid-template-rows:auto_auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border-1)] [background:var(--background-panel)] max-[760px]:[grid-column:1] max-[760px]:[grid-row:2_/_4]"}
    >
      <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:10px] [padding:8px_14px]"}>
        <div className={"[display:flex] [min-width:0] [align-items:baseline] [gap:8px] [&_h3]:[margin:0] [&_h3]:[min-width:0] [&_h3]:[font-size:15px] [&_h3]:[font-weight:720] [&_h3]:[line-height:1.2] [&_span]:[flex:0_0_auto] [&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px] [&_span]:[line-height:1.2]"}>
          <h3>{t("chatHeader.searchMessages")}</h3>
          {normalizedQuery ? <span>{t("messageSearch.resultCount", { count: results.length })}</span> : null}
        </div>
        <button
          className={"dialog-close-button [display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--text-secondary)] [background:transparent] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--transparency-hover)] [&:focus-visible]:[outline:none] [&:focus-visible]:[background:var(--transparency-hover)]"}
          type="button"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={props.onClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className={"[padding:0_12px]"}>
        <label className={"[display:flex] [height:38px] [align-items:center] [gap:8px] [border-radius:8px] [padding:0_12px] [color:var(--text-secondary)] [background:var(--transparency-block)] [&_input]:[width:100%] [&_input]:[min-width:0] [&_input]:[border:0] [&_input]:[color:var(--text-primary)] [&_input]:[background:transparent] [&_input]:[font-size:13px] [&_input]:[outline:none] [&_input::placeholder]:[color:var(--text-placeholder)]"}>
          <Search size={15} className={"[flex:0_0_auto]"} />
          <input
            ref={inputRef}
            value={query}
            aria-label={t("messageSearch.aria")}
            placeholder={t("messageSearch.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className={"[display:inline-grid] [width:24px] [height:24px] [place-items:center] [border:0] [border-radius:999px] [color:var(--text-secondary)] [background:transparent] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--transparency-hover)]"}
              aria-label={t("messageSearch.clear")}
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
      </div>

      <div className={"[min-height:0] [overflow-y:auto] [padding:12px] [display:grid] [align-content:start] [gap:4px]"}>
        {!normalizedQuery ? (
          <div className={"[padding:28px_12px] [color:var(--text-secondary)] [font-size:13px] [line-height:1.5] [text-align:center]"}>{t("messageSearch.hint")}</div>
        ) : results.length === 0 ? (
          <div className={"[padding:28px_12px] [color:var(--text-secondary)] [font-size:13px] [line-height:1.5] [text-align:center]"}>{t("messageSearch.noResults")}</div>
        ) : (
          results.map((message) => (
            <SearchResultRow
              key={message.id}
              message={message}
              query={normalizedQuery}
              allMessages={props.allMessages}
              allBlocks={props.allBlocks}
              artifacts={props.artifacts}
              participants={props.participants}
              identities={props.identities}
              runtimeProfiles={props.runtimeProfiles}
              conversations={props.conversations}
              rooms={props.rooms}
              summaryTasks={props.summaryTasks}
              userDisplayName={props.userDisplayName}
              onFocusMessage={props.onFocusMessage}
              onClose={props.onClose}
              onOpenMessageLink={props.onOpenMessageLink}
              onOpenSummaryLink={props.onOpenSummaryLink}
              onEnsureSummaryTask={props.onEnsureSummaryTask}
              onOpenArtifact={props.onOpenArtifact}
              onOpenAgentProfile={props.onOpenAgentProfile}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function SearchResultRow(props: {
  message: Message;
  query: string;
  allMessages: Message[];
  allBlocks: MessageBlock[];
  artifacts: Artifact[];
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  conversations: Conversation[];
  rooms: Room[];
  summaryTasks: BackgroundTask[];
  userDisplayName?: string;
  onFocusMessage: (messageId: string) => void;
  onClose: () => void;
  onOpenMessageLink: (messageIdSegment: string) => void;
  onOpenSummaryLink: (taskId: string) => void;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  onOpenArtifact?: (artifact: Artifact) => void;
  onOpenAgentProfile?: (participant: Participant) => void;
}) {
  const content = props.message.content.trim() || attachmentLabel();
  const messageLinks = extractMessageLinks(content);
  const summaryLinks = extractSummaryLinks(content);
  const bodyContent = removeSearchEmbeddedLinks(content).trim();
  const focusSource = () => {
    props.onFocusMessage(props.message.id);
    props.onClose();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={"[display:grid] [gap:6px] [width:100%] [border:0] [border-radius:8px] [padding:10px_12px] [text-align:left] [color:var(--text-primary)] [background:transparent] [cursor:pointer] [transition:background-color_0.12s_ease] [&:hover]:[background:var(--transparency-hover)] [&:focus-visible]:[outline:none] [&:focus-visible]:[background:var(--transparency-hover)] [&_.search-result-card]:[width:min(260px,_100%)] [&_.search-result-card]:[padding:6px_8px] [&_.search-result-card]:[border-radius:8px]"}
      onClick={focusSource}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focusSource();
      }}
    >
      <span className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
        <strong className={"[overflow:hidden] [font-size:11px] [font-weight:700] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {highlightText(messageSenderLabel(props.message, props.participants, props.identities, props.userDisplayName), props.query)}
        </strong>
        <span className={"[flex:0_0_auto] [color:var(--text-secondary)] [font-size:11px]"}>{formatShortDate(props.message.createdAt)}</span>
      </span>
      <span
        className={"message-prose [display:block] [max-height:180px] [overflow-y:auto] [overscroll-behavior:contain] [padding-right:4px] [color:var(--text-secondary)] [font-size:11px] [line-height:1.45] [&_.reference-mention-chip]:[max-width:220px]"}
        onClick={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest("a,button,[role='button']")) {
            event.stopPropagation();
          }
        }}
      >
        {messageLinks.map((messageIdSegment) => (
          <CompactMessageLinkCard
            key={`message-${messageIdSegment}`}
            messageIdSegment={messageIdSegment}
            messages={props.allMessages}
            participants={props.participants}
            identities={props.identities}
            userDisplayName={props.userDisplayName}
            query={props.query}
            onOpen={() => {
              props.onOpenMessageLink(messageIdSegment);
              props.onClose();
            }}
          />
        ))}
        {summaryLinks.map((taskId) => (
          <CompactSummaryLinkCard
            key={`summary-${taskId}`}
            taskId={taskId}
            summaryTasks={props.summaryTasks}
            query={props.query}
            onEnsureSummaryTask={props.onEnsureSummaryTask}
            onOpen={() => {
              props.onOpenSummaryLink(taskId);
              props.onClose();
            }}
          />
        ))}
        {bodyContent ? (
          <SearchReferenceContent
            content={bodyContent}
            query={props.query}
            mentions={props.message.mentions}
            artifacts={props.artifacts}
            participants={props.participants}
            runtimeProfiles={props.runtimeProfiles}
            onOpenAgentProfile={props.onOpenAgentProfile}
            onOpenArtifact={(artifact) => {
              props.onOpenArtifact?.(artifact);
              props.onClose();
            }}
          />
        ) : null}
      </span>
    </div>
  );
}

function SearchReferenceContent(props: {
  content: string;
  query: string;
  mentions?: Message["mentions"];
  artifacts: Artifact[];
  participants: Participant[];
  runtimeProfiles: RuntimeProfile[];
  onOpenAgentProfile?: (participant: Participant) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
}) {
  const segments = splitContentByReferenceMentions(props.content);
  return (
    <span className={"[display:contents] [line-height:1.45] [white-space:pre-wrap]"}>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <Fragment key={`text-${index}`}>{renderSearchText(segment.text, props.query)}</Fragment>;
        }

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
        if (isFileReferenceProvider(providerId) && props.onOpenArtifact) {
          const artifact = findArtifactForFileReference(segment.href, entityId, mention, props.artifacts);
          if (artifact) {
            return (
              <ArtifactBlock
                key={`reference-${index}`}
                artifact={artifact}
                onOpen={() => props.onOpenArtifact?.(artifact)}
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
            {highlightText(segment.label, props.query)}
          </ReferenceMentionLink>
        );
      })}
    </span>
  );
}

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g;

function renderSearchText(text: string, query: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(highlightText(text.slice(cursor, index), query));
    const label = match[1] ?? "";
    const href = match[2] ?? "";
    nodes.push(
      <a
        key={`link-${index}-${href}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className={"[color:var(--accent-codex)] [text-decoration:underline]"}
      >
        {highlightText(label, query)}
      </a>,
    );
    cursor = index + match[0].length;
  }
  if (cursor < text.length) nodes.push(highlightText(text.slice(cursor), query));
  return nodes.length ? nodes : highlightText(text, query);
}

function CompactMessageLinkCard(props: {
  messageIdSegment: string;
  messages: Message[];
  participants: Participant[];
  identities: Identity[];
  userDisplayName?: string;
  query: string;
  onOpen: () => void;
}) {
  const messageId = primaryMessageLinkId(props.messageIdSegment);
  const message = props.messages.find((item) => item.id === messageId) ?? null;
  const label = message
    ? messageSenderLabel(message, props.participants, props.identities, props.userDisplayName)
    : "Message";
  return (
    <button
      type="button"
      className={"search-result-card [display:grid] [gap:2px] [margin:2px_0_4px] [border:1px_solid_var(--border-1)] [background:var(--white-stationary)] [color:var(--text-primary)] [text-align:left] [box-shadow:0_1px_2px_color-mix(in_srgb,var(--black-stationary)_4%,transparent)] hover:[background:var(--background-panel)]"}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen();
      }}
    >
      <span className={"[display:flex] [align-items:center] [gap:5px] [overflow:hidden] [color:var(--accent-codex)] [font-size:11px] [font-weight:700]"}>
        <MessageSquare size={12} />
        <span className={"[overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{highlightText(label, props.query)}</span>
      </span>
      {message?.content ? (
        <span className={"[display:-webkit-box] [-webkit-line-clamp:1] [-webkit-box-orient:vertical] [overflow:hidden] [font-size:11px] [line-height:1.35]"}>
          {highlightText(removeSearchEmbeddedLinks(message.content).trim() || message.content, props.query)}
        </span>
      ) : null}
    </button>
  );
}

function removeSearchEmbeddedLinks(content: string) {
  return removeEmbeddedLinks(content)
    .replace(/\[([^\]]+)\]\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function CompactSummaryLinkCard(props: {
  taskId: string;
  summaryTasks: BackgroundTask[];
  query: string;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  onOpen: () => void;
}) {
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "failed">("idle");
  const { t } = useTranslation();
  const task = props.summaryTasks.find((item) => item.id === props.taskId) ?? null;
  const presentation = resolveSummaryCardPresentation(
    task ?? (fetchState === "loading"
      ? { participantName: "", content: "", sourcePreview: "", sourceMessageIds: [], status: "running" }
      : fetchState === "failed"
        ? { participantName: "", content: t("messageActions.summaryMissing"), sourcePreview: "", sourceMessageIds: [], status: "failed" }
      : null),
  );

  useEffect(() => {
    if (task || fetchState !== "idle" || !props.onEnsureSummaryTask) return;
    setFetchState("loading");
    void props.onEnsureSummaryTask(props.taskId)
      .then((result) => setFetchState(result ? "idle" : "failed"))
      .catch(() => setFetchState("failed"));
  }, [task, fetchState, props.onEnsureSummaryTask, props.taskId]);

  return (
    <button
      type="button"
      className={"search-result-card [display:grid] [gap:2px] [margin:2px_0_4px] [border:1px_solid_var(--border-1)] [background:var(--white-stationary)] [color:var(--text-primary)] [text-align:left] [box-shadow:0_1px_2px_color-mix(in_srgb,var(--black-stationary)_4%,transparent)] hover:[background:var(--background-panel)]"}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen();
      }}
    >
      <span className={"[display:flex] [align-items:center] [gap:5px] [overflow:hidden] [color:var(--accent-codex)] [font-size:11px] [font-weight:700]"}>
        <BrainCircuit size={12} />
        <span className={"[overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{highlightText(presentation.title, props.query)}</span>
      </span>
      <span className={"[display:-webkit-box] [-webkit-line-clamp:1] [-webkit-box-orient:vertical] [overflow:hidden] [font-size:11px] [line-height:1.35]"}>
        {highlightText(presentation.body, props.query)}
      </span>
    </button>
  );
}

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;
  const matches = findSearchTextMatches(text, query);
  if (matches.length === 0) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) parts.push(text.slice(cursor, match.start));
    parts.push(
      <mark
        key={`${match.start}-${match.end}`}
        className={"[color:inherit] [background:color-mix(in_srgb,var(--tutti-purple)_30%,transparent)] [padding:0_2px] [border-radius:2px]"}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length ? parts : text;
}
