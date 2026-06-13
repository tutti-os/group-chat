import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Braces, BrainCircuit, CheckSquare, ChevronsDown, Copy, Edit3, FileText, MoreHorizontal, Reply, RotateCcw, SendToBack, Terminal, Trash2, Wrench, X } from "lucide-react";
import type { Artifact, Conversation, Identity, Message, MessageBlock, Participant, Room, RuntimeProfile } from "@group-chat/shared";
import { openArtifactInSystem } from "../../../api/client.js";
import { formatBytes, formatMessageStatus } from "../../formatting.js";
import type { LocalUserProfile } from "../../user-profile.js";
import { UserAvatar, type UserAvatarSize } from "../ui/UserAvatar.js";
import { resolveAgentAvatarFromContext } from "../../identity-avatar.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";
import { AttachmentPreviewDialog, canPreviewInApp, isTextAttachment, type AttachmentPreview } from "./AttachmentPreviewDialog.js";
import type { BackgroundTask } from "../../background-tasks.js";
import {
  collectSummaryTaskIds,
  copySummaryToClipboard,
  extractMessageLinks,
  extractSummaryLinks,
  formatMessageLink,
  removeEmbeddedLinks,
  readStashedSummaryLink,
  resolveSourceMessages,
  resolveMessageAgentParticipant,
  resolveMessageSenderLabel,
  messageSenderLabel,
  summaryLinkLabel,
} from "../../chat-links.js";

const COLLAPSED_MESSAGE_CHAR_LIMIT = 300;
const COPY_TIP_OFFSET_PX = 8;

type CopyTipPosition = { x: number; y: number };

const MESSAGE_MENU_ACTIVE_ATTR = "data-menu-active";

function clearActiveMessageMenuAnchor() {
  document.querySelectorAll(`[data-slot="message-actions"][${MESSAGE_MENU_ACTIVE_ATTR}="true"]`).forEach((element) => {
    element.removeAttribute(MESSAGE_MENU_ACTIVE_ATTR);
  });
}

function setActiveMessageMenuAnchor(anchor: HTMLElement) {
  clearActiveMessageMenuAnchor();
  anchor.setAttribute(MESSAGE_MENU_ACTIVE_ATTR, "true");
}

function findActiveMessageMenuAnchor(messageId: string) {
  const messageEl = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!(messageEl instanceof HTMLElement)) return null;
  const active = messageEl.querySelector(`[data-slot="message-actions"][${MESSAGE_MENU_ACTIVE_ATTR}="true"]`);
  return active instanceof HTMLElement ? active : null;
}

export function MessageTimeline(props: {
  messages: Message[];
  allMessages: Message[];
  blocks: MessageBlock[];
  artifacts: Artifact[];
  participants: Participant[];
  allParticipants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  conversations: Conversation[];
  rooms: Room[];
  participantsCount: number;
  focusMessageRequest: { messageId: string; seq: number } | null;
  bulkToolbarHost?: HTMLElement | null;
  onSelectionModeChange?: (active: boolean) => void;
  onOpenMembers: (options?: { startAdding?: boolean }) => void;
  onOpenAgentProfile: (participant: Participant) => void;
  onMentionParticipant: (participant: Participant) => void;
  onOpenMessageLink: (messageId: string) => void;
  onOpenSummaryLink: (taskId: string) => void;
  onEnsureSummaryTask: (taskId: string) => Promise<BackgroundTask | null>;
  summaryTasks: BackgroundTask[];
  onQuoteMessages: (messages: Message[], mode?: "quote" | "summary" | "send-to-app" | "send-to-agent") => void;
  onStartSummary: (messages: Message[], participant: Participant) => void | Promise<void>;
  openBackgroundTask: BackgroundTask | null;
  onCloseBackgroundTaskPanel: () => void;
  onFocusMessage: (messageId: string) => void;
  onEditMessage: (message: Message) => void;
  onDeleteMessage: (message: Message) => Promise<unknown>;
  onRecallMessage: (message: Message) => Promise<unknown>;
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const copyTipTimerRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [detailReplyMessageId, setDetailReplyMessageId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [openMessageMenu, setOpenMessageMenu] = useState<{ messageId: string } | null>(null);

  const closeOpenMessageMenu = useCallback(() => {
    clearActiveMessageMenuAnchor();
    setOpenMessageMenu(null);
  }, []);
  const [copyTipPosition, setCopyTipPosition] = useState<CopyTipPosition | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [summaryAgentPickerMessages, setSummaryAgentPickerMessages] = useState<Message[] | null>(null);
  const visibleMessages = props.messages.filter(shouldShowMessage);
  const selectedMessages = visibleMessages.filter((message) => selectedMessageIds.has(message.id));
  const detailReplyMessage = detailReplyMessageId ? props.messages.find((message) => message.id === detailReplyMessageId) ?? null : null;
  const detailMessages = detailReplyMessage
    ? buildReferencedThread(detailReplyMessage, props.messages, props.allParticipants, props.identities)
    : [];

  const mentionParticipantKeepingScroll = useCallback((participant: Participant) => {
    const container = scrollRef.current;
    if (!container) {
      props.onMentionParticipant(participant);
      return;
    }
    const scrollTop = container.scrollTop;
    props.onMentionParticipant(participant);
    restoreTimelineScroll(container, scrollTop);
  }, [props.onMentionParticipant]);

  useEffect(() => {
    const taskIds = collectSummaryTaskIds(props.messages, props.blocks);
    for (const taskId of taskIds) {
      if (props.summaryTasks.some((task) => task.id === taskId)) continue;
      void props.onEnsureSummaryTask(taskId);
    }
  }, [props.messages, props.blocks, props.summaryTasks, props.onEnsureSummaryTask]);
  const summaryImages = props.openBackgroundTask?.sourceMessageIds.length
    ? props.openBackgroundTask.sourceMessageIds.flatMap((messageId) => imageArtifactsForMessage(messageId, props.blocks, props.artifacts))
    : props.openBackgroundTask?.sourceMessageId
      ? imageArtifactsForMessage(props.openBackgroundTask.sourceMessageId, props.blocks, props.artifacts)
      : [];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [props.messages, props.blocks]);

  useEffect(() => {
    updateJumpToBottomVisibility();
  }, [props.messages, props.blocks]);

  useEffect(() => {
    if (!props.focusMessageRequest) return;
    window.requestAnimationFrame(() => scrollToMessage(props.focusMessageRequest!.messageId));
  }, [props.focusMessageRequest]);

  useEffect(() => {
    if (!selectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (summaryAgentPickerMessages?.length || props.openBackgroundTask || detailReplyMessageId) return;
      event.preventDefault();
      if (openMessageMenu) {
        closeOpenMessageMenu();
        return;
      }
      exitSelectionMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMode, openMessageMenu, closeOpenMessageMenu, summaryAgentPickerMessages, props.openBackgroundTask, detailReplyMessageId]);

  const openArtifact = async (artifact: Artifact) => {
    if (artifact.mimeType.startsWith("image/")) {
      setPreview({ title: artifact.filename, mimeType: artifact.mimeType, url: artifact.publicUrl });
      return;
    }
    if (isTextAttachment(artifact.mimeType, artifact.filename)) {
      setPreview({ title: artifact.filename, mimeType: artifact.mimeType, loading: true });
      try {
        const response = await fetch(artifact.publicUrl);
        const text = response.ok ? await response.text() : artifact.textPreview;
        setPreview({ title: artifact.filename, mimeType: artifact.mimeType, text: text ?? "" });
      } catch {
        setPreview({ title: artifact.filename, mimeType: artifact.mimeType, text: artifact.textPreview ?? "" });
      }
      return;
    }
    try {
      await openArtifactInSystem(artifact.id);
    } catch {
      window.open(artifact.publicUrl, "_blank", "noopener,noreferrer");
    }
  };

  const toggleSelectedMessage = (messageId: string) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const enterSelectionMode = (message: Message) => {
    setSelectionMode(true);
    setSelectedMessageIds(new Set([message.id]));
    closeOpenMessageMenu();
    props.onSelectionModeChange?.(true);
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
    props.onSelectionModeChange?.(false);
  };

  const copyMessages = async (messages: Message[], position: CopyTipPosition) => {
    const text = messages
      .filter((message) => message.status !== "deleted" && message.status !== "recalled")
      .map((message) => `${messageSenderLabel(message, props.allParticipants, props.identities)}: ${message.content.trim() || "[附件]"}`)
      .join("\n");
    await copyTextToClipboard(text);
    showCopyTip(position);
  };

  const copyMessageLink = async (messageId: string, position: CopyTipPosition) => {
    await copyTextToClipboard(formatMessageLink(messageId));
    showCopyTip(position);
  };

  const showCopyTip = (position: CopyTipPosition) => {
    setCopyTipPosition(position);
    if (copyTipTimerRef.current) window.clearTimeout(copyTipTimerRef.current);
    copyTipTimerRef.current = window.setTimeout(() => {
      setCopyTipPosition(null);
      copyTipTimerRef.current = null;
    }, 1400);
  };

  const deleteSelectedMessages = async () => {
    await Promise.all(selectedMessages.map((message) => props.onDeleteMessage(message)));
    exitSelectionMode();
  };

  const startSummary = (messages: Message[], participant: Participant) => {
    closeOpenMessageMenu();
    setSummaryAgentPickerMessages(null);
    void props.onStartSummary(messages, participant);
  };

  const resolveSummaryAgent = (messages: Message[]) => {
    const agents = messages
      .map((message) => resolveMessageAgentParticipant(message, props.participants, props.allParticipants))
      .filter((participant): participant is Participant => participant?.kind === "ai" && participant.status === "active");
    const uniqueAgentIds = new Set(agents.map((participant) => participant.id));
    if (uniqueAgentIds.size === 1 && agents.length === messages.length) {
      return agents[0] ?? null;
    }
    return null;
  };

  const requestSummary = (messages: Message[]) => {
    const agent = resolveSummaryAgent(messages);
    if (agent) {
      startSummary(messages, agent);
      return;
    }
    closeOpenMessageMenu();
    setSummaryAgentPickerMessages(messages);
  };

  const updateJumpToBottomVisibility = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setShowJumpToBottom(distanceFromBottom > element.clientHeight);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ block: "end" });
    setShowJumpToBottom(false);
  };

  const scrollToMessage = (messageId: string) => {
    const container = scrollRef.current;
    const target = container?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!(container instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextScrollTop =
      container.scrollTop +
      (targetRect.top - containerRect.top) -
      (container.clientHeight - targetRect.height) / 2;
    container.scrollTop = Math.max(0, nextScrollTop);
    target.dataset.flash = "true";
    window.setTimeout(() => {
      delete target.dataset.flash;
    }, 1400);
  };

  useEffect(() => {
    if (!openMessageMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-slot="message-actions"], [data-slot="message-more-menu"]')) return;
      closeOpenMessageMenu();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openMessageMenu, closeOpenMessageMenu]);

  useEffect(() => {
    return () => {
      if (copyTipTimerRef.current) window.clearTimeout(copyTipTimerRef.current);
    };
  }, []);

  return (
    <section
      ref={scrollRef}
      className={"[position:relative] [min-height:0] [overflow-y:auto] [padding:26px_clamp(14px,_2.25vw,_32px)_18px] [background:var(--panel)] max-[1080px]:[padding-inline:16px] max-[760px]:[padding:18px_12px]"}
      onScroll={updateJumpToBottomVisibility}
    >
      {visibleMessages.length === 0 ? (
        <EmptyTimelineState
          participantsCount={props.participantsCount}
          onOpenMembers={props.onOpenMembers}
        />
      ) : null}
      {visibleMessages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          quotedMessage={resolveReferencedMessage(message, props.messages, props.allParticipants, props.identities)}
          blocks={props.blocks.filter((block) => block.messageId === message.id)}
          artifacts={props.artifacts}
          allMessages={props.allMessages}
          allParticipants={props.allParticipants}
          conversations={props.conversations}
          rooms={props.rooms}
          participant={resolveMessageAgentParticipant(message, props.participants, props.allParticipants)}
          identities={props.identities}
          runtimeProfiles={props.runtimeProfiles}
          userProfile={props.userProfile}
          onOpenAgentProfile={props.onOpenAgentProfile}
          onMentionParticipant={mentionParticipantKeepingScroll}
          onOpenArtifact={openArtifact}
          onOpenMessageLink={props.onOpenMessageLink}
          onOpenSummaryLink={props.onOpenSummaryLink}
          onEnsureSummaryTask={props.onEnsureSummaryTask}
          summaryTasks={props.summaryTasks}
          onOpenReferencedMessage={(_referencedMessage, replyMessage) => setDetailReplyMessageId(replyMessage.id)}
          selectionMode={selectionMode}
          selected={selectedMessageIds.has(message.id)}
          menuOpen={openMessageMenu?.messageId === message.id}
          onToggleSelected={() => toggleSelectedMessage(message.id)}
          onOpenMenu={(anchor) => {
            if (openMessageMenu?.messageId === message.id) {
              closeOpenMessageMenu();
              return;
            }
            setActiveMessageMenuAnchor(anchor);
            setOpenMessageMenu({ messageId: message.id });
          }}
          onCloseMenu={closeOpenMessageMenu}
          onQuoteMessage={() => props.onQuoteMessages([message], "quote")}
          onSummarizeMessage={() => requestSummary([message])}
          onSendToApp={() => props.onQuoteMessages([message], "send-to-app")}
          onSendToAgent={() => props.onQuoteMessages([message], "send-to-agent")}
          onCopyMessage={(position) => void copyMessages([message], position)}
          onCopyMessageLink={(position) => void copyMessageLink(message.id, position)}
          onEditMessage={() => props.onEditMessage(message)}
          onDeleteMessage={() => props.onDeleteMessage(message)}
          onRecallMessage={() => props.onRecallMessage(message)}
          onSelectMessage={() => enterSelectionMode(message)}
        />
      ))}
      {selectionMode && props.bulkToolbarHost
        ? createPortal(
            <BulkMessageToolbar
              count={selectedMessages.length}
              onCopy={(position) => {
                void copyMessages(selectedMessages, position);
                exitSelectionMode();
              }}
              onQuote={() => {
                props.onQuoteMessages(selectedMessages, "quote");
                exitSelectionMode();
              }}
              onSummarize={() => {
                requestSummary(selectedMessages);
                exitSelectionMode();
              }}
              onSendToApp={() => {
                props.onQuoteMessages(selectedMessages, "send-to-app");
                exitSelectionMode();
              }}
              onSendToAgent={() => {
                props.onQuoteMessages(selectedMessages, "send-to-agent");
                exitSelectionMode();
              }}
              onDelete={() => void deleteSelectedMessages()}
              onClose={exitSelectionMode}
            />,
            props.bulkToolbarHost,
          )
        : null}
      <div ref={bottomRef} />
      {showJumpToBottom ? (
        <button
          type="button"
          className={"[position:fixed] [z-index:40] [right:28px] [bottom:112px] [display:grid] [width:52px] [height:52px] [place-items:center] [border:1px_solid_var(--border)] [border-radius:999px] [color:var(--text)] [background:#fffffff2] [box-shadow:0_12px_34px_rgb(0_0_0_/_14%)] [backdrop-filter:blur(10px)] [cursor:pointer] hover:[background:#ffffff] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px] max-[760px]:[right:18px] max-[760px]:[bottom:96px]"}
          aria-label="回到最新消息"
          title="回到最新消息"
          onClick={scrollToBottom}
        >
          <ChevronsDown size={22} />
        </button>
      ) : null}
      {detailMessages.length ? (
        <ReferencedMessagePanel
          messages={detailMessages}
          blocks={props.blocks}
          participants={props.participants}
          artifacts={props.artifacts}
          userProfile={props.userProfile}
          allParticipants={props.allParticipants}
          identities={props.identities}
          runtimeProfiles={props.runtimeProfiles}
          onClose={() => setDetailReplyMessageId(null)}
          onBackToMessage={(messageId) => {
            scrollToMessage(messageId);
            setDetailReplyMessageId(null);
          }}
          onOpenArtifact={openArtifact}
        />
      ) : null}
      {summaryAgentPickerMessages?.length ? (
        <SummaryAgentPicker
          messages={summaryAgentPickerMessages}
          participants={props.participants}
          identities={props.identities}
          runtimeProfiles={props.runtimeProfiles}
          onSelect={(participant) => startSummary(summaryAgentPickerMessages, participant)}
          onClose={() => setSummaryAgentPickerMessages(null)}
        />
      ) : null}
      {props.openBackgroundTask ? (
        <SummaryPanel
          task={props.openBackgroundTask}
          images={summaryImages}
          allParticipants={props.allParticipants}
          identities={props.identities}
          onCopy={(position) => {
            const task = props.openBackgroundTask!;
            const sourceMessages = resolveSourceMessages(task, props.allMessages);
            void copySummaryToClipboard({
              task,
              sourceMessages,
              participants: props.allParticipants,
              images: summaryImages,
            })
              .then(() => showCopyTip(position))
              .catch(() => window.alert("复制失败，请检查浏览器剪贴板权限"));
          }}
          onBackToSource={() => {
            const messageId = props.openBackgroundTask?.sourceMessageId;
            if (messageId) {
              scrollToMessage(messageId);
              props.onFocusMessage(messageId);
            }
          }}
          onClose={props.onCloseBackgroundTaskPanel}
        />
      ) : null}
      {copyTipPosition ? (
        <div
          className={"[position:fixed] [z-index:80] [border-radius:999px] [padding:7px_12px] [color:#ffffff] [background:rgb(17_24_39_/_88%)] [box-shadow:0_10px_30px_rgb(0_0_0_/_18%)] [font-size:12px] [font-weight:650] [pointer-events:none]"}
          style={{
            left: copyTipPosition.x,
            top: copyTipPosition.y - COPY_TIP_OFFSET_PX,
            transform: "translate(-50%, -100%)",
          }}
        >
          已复制
        </div>
      ) : null}
      <AttachmentPreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </section>
  );
}

function EmptyTimelineState(props: { participantsCount: number; onOpenMembers: (options?: { startAdding?: boolean }) => void }) {
  const noAgents = props.participantsCount === 0;
  return (
    <div className={"[display:grid] [min-height:100%] [place-items:center] [padding:28px] [text-align:center]"}>
      <div className={"[display:grid] [max-width:460px] [gap:14px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:28px] [background:#ffffff99] [&_h3]:[margin:0] [&_h3]:[color:var(--text)] [&_h3]:[font-size:18px] [&_h3]:[font-weight:700] [&_p]:[margin:0] [&_p]:[color:var(--muted)] [&_p]:[font-size:13px] [&_p]:[line-height:1.6]"}>
        <h3>{noAgents ? "当前房间还没有 Agent" : "开始第一轮协作"}</h3>
        <p>
          {noAgents
            ? "添加 Agent 后，他们才能根据你的消息自动回复。"
            : "可以直接输入需求，也可以 @ 某个 Agent 指定回复者。"}
        </p>
        <div className={"[display:flex] [flex-wrap:wrap] [justify-content:center] [gap:8px] [&_span]:[border:1px_solid_var(--border)] [&_span]:[border-radius:999px] [&_span]:[padding:5px_10px] [&_span]:[color:var(--tag-agent-text)] [&_span]:[background:#ffffff] [&_span]:[font-size:12px]"}>
          <span>帮我分析这个需求</span>
          <span>给我一版产品方案</span>
          <span>@所有人 一起讨论</span>
        </div>
        <button
          type="button"
          className={"[justify-self:center] [height:36px] [border:0] [border-radius:6px] [padding:0_14px] [color:#ffffff] [background:var(--primary)] [font-size:13px] [font-weight:650] [&:hover]:[background:var(--accent)]"}
          onClick={() => props.onOpenMembers(noAgents ? { startAdding: true } : undefined)}
        >
          {noAgents ? "添加 Agent" : "管理 Agent"}
        </button>
      </div>
    </div>
  );
}

function shouldShowMessage(message: Message) {
  return !(message.role === "assistant" && !message.content.trim() && (message.status === "cancelled" || message.status === "streaming"));
}

function resolveReferencedMessage(
  message: Message,
  messages: Message[],
  participants: Participant[],
  identities: Identity[],
) {
  if (message.parentMessageId) {
    return messages.find((item) => item.id === message.parentMessageId) ?? null;
  }
  const legacyQuote = extractLeadingReplyQuote(normalizeMarkdownContent(message.content));
  if (!legacyQuote) return null;
  const messageIndex = messages.findIndex((item) => item.id === message.id);
  const candidates = (messageIndex === -1 ? messages : messages.slice(0, messageIndex)).filter(
    (candidate) => candidate.status !== "deleted" && candidate.status !== "recalled",
  );
  const quoteText = compactComparableText(legacyQuote.content);
  return [...candidates].reverse().find((candidate) => {
    const senderMatches = messageSenderLabel(candidate, participants, identities) === legacyQuote.sender || candidate.senderName === legacyQuote.sender;
    const candidateText = compactComparableText(candidate.content || "[附件]");
    return senderMatches && (candidateText.includes(quoteText) || quoteText.includes(candidateText.slice(0, 40)));
  }) ?? null;
}

function buildReferencedThread(
  replyMessage: Message,
  messages: Message[],
  participants: Participant[],
  identities: Identity[],
) {
  const chain: Message[] = [];
  const seen = new Set<string>();
  let current: Message | null = replyMessage;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = resolveReferencedMessage(current, messages, participants, identities);
  }
  return chain;
}

function MessageRow(props: {
  message: Message;
  quotedMessage: Message | null;
  blocks: MessageBlock[];
  artifacts: Artifact[];
  allMessages: Message[];
  allParticipants: Participant[];
  conversations: Conversation[];
  rooms: Room[];
  participant: Participant | null;
  onOpenAgentProfile: (participant: Participant) => void;
  onMentionParticipant: (participant: Participant) => void;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenMessageLink: (messageId: string) => void;
  onOpenSummaryLink: (taskId: string) => void;
  onEnsureSummaryTask: (taskId: string) => Promise<BackgroundTask | null>;
  summaryTasks: BackgroundTask[];
  onOpenReferencedMessage: (referencedMessage: Message, replyMessage: Message) => void;
  selectionMode: boolean;
  selected: boolean;
  menuOpen: boolean;
  onToggleSelected: () => void;
  onOpenMenu: (anchor: HTMLElement) => void;
  onCloseMenu: () => void;
  onQuoteMessage: () => void;
  onSummarizeMessage: () => void;
  onSendToApp: () => void;
  onSendToAgent: () => void;
  onCopyMessage: (position: CopyTipPosition) => void;
  onCopyMessageLink: (position: CopyTipPosition) => void;
  onEditMessage: () => void;
  onDeleteMessage: () => Promise<unknown>;
  onRecallMessage: () => Promise<unknown>;
  onSelectMessage: () => void;
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">;
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
}) {
  const statusLabel = formatMessageStatus(props.message.status);
  const sortedBlocks = [...props.blocks].sort(compareMessageBlocks);
  const runtimeEventBlocks = sortedBlocks.filter(isRuntimeEventBlock);
  const conversationBlocks = sortedBlocks.filter((block) => !isRuntimeEventBlock(block));
  const isUserMessage = props.message.role === "user";
  const isRemoved = props.message.status === "deleted" || props.message.status === "recalled";
  const participantIdentity = props.participant?.identityId
    ? props.identities.find((identity) => identity.id === props.participant?.identityId) ?? null
    : null;
  const senderLabel = resolveMessageSenderLabel(props.message, props.participant, participantIdentity);
  return (
    <article
      data-message-id={props.message.id}
      data-role={props.message.role}
      data-selected={props.selected || undefined}
      className={`group/message [position:relative] [display:grid] [grid-template-columns:34px_minmax(0,_1fr)] [gap:8px] [margin-bottom:12px] [align-items:start] [border-radius:18px] [transition:background-color_0.2s_ease,_box-shadow_0.2s_ease] [&[data-selected=true]]:[background:#eaf2ff66] [&[data-flash=true]]:[background:#fef3c7] [&[data-flash=true]]:[box-shadow:0_0_0_2px_#facc15] ${props.selectionMode ? "[padding-left:30px]" : ""} [&[data-role=user]]:[grid-template-columns:minmax(0,_1fr)_34px] [&[data-role=user]_[data-slot=message-avatar]]:[grid-column:2] [&[data-role=user]_[data-slot=message-avatar]]:[grid-row:1] [&[data-role=user]_[data-slot=message-body]]:[grid-column:1] [&[data-role=user]_[data-slot=message-body]]:[grid-row:1] [&[data-role=user]_[data-slot=message-body]]:[width:fit-content] [&[data-role=user]_[data-slot=message-body]]:[justify-self:end] [&[data-role=user]_[data-slot=message-meta]]:[justify-content:flex-end] [&[data-role=user]_[data-slot=message-block]]:[margin-left:auto] [&[data-role=user]_[data-slot=message-block]:not([data-link-only])]:[border-color:transparent] [&[data-role=user]_[data-slot=message-block]:not([data-link-only])]:[background:#d6e9ff] [&[data-role=user]_[data-slot=message-block][data-link-only]]:[background:transparent] [&[data-role=user]_[data-slot=message-block][data-link-only]]:[justify-items:end] [&[data-role=user]_[data-slot=message-block-shell]]:[margin-left:auto] [&[data-role=user]_[data-slot=event-block]]:[margin-left:auto] [&[data-role=user]_[data-slot=artifact-block]]:[margin-left:auto]`}
    >
      {props.selectionMode ? (
        <label className={"[position:absolute] [left:2px] [top:8px] [display:grid] [width:22px] [height:22px] [place-items:center] [cursor:pointer]"}>
          <input className={"[width:16px] [height:16px] [accent-color:var(--primary)]"} type="checkbox" checked={props.selected} onChange={props.onToggleSelected} aria-label="选择消息" />
        </label>
      ) : null}
      {props.participant ? (
        <button
          data-slot="message-avatar"
          type="button"
          className={"[position:relative] [display:inline-flex] [flex:0_0_auto] [align-items:center] [justify-content:center] [width:34px] [height:34px] [border:0] [padding:0] [background:transparent] [cursor:pointer] [transition:transform_0.12s_ease] [&:hover]:[transform:translateY(-1px)] [&:focus-visible]:[outline:2px_solid_var(--accent)] [&:focus-visible]:[outline-offset:2px]"}
          title={`查看 ${props.participant.displayName}`}
          aria-label={`查看 ${props.participant.displayName} 的 Agent 信息`}
          onClick={() => props.onOpenAgentProfile(props.participant!)}
        >
          <MessageSenderAvatar
            message={props.message}
            participant={props.participant}
            identity={participantIdentity}
            runtimeProfiles={props.runtimeProfiles}
            userProfile={props.userProfile}
          />
        </button>
      ) : (
        <div
          data-slot="message-avatar"
          className={isUserMessage
            ? "[display:inline-grid] [flex:0_0_auto] [width:34px] [height:34px] [overflow:hidden] [border-radius:999px]"
            : "[display:inline-flex] [flex:0_0_auto] [width:34px] [height:34px] [align-items:center] [justify-content:center]"}
        >
          <MessageSenderAvatar
            message={props.message}
            participant={props.participant}
            identity={participantIdentity}
            runtimeProfiles={props.runtimeProfiles}
            userProfile={props.userProfile}
          />
        </div>
      )}
      <div data-slot="message-body" className={"[position:relative] [min-width:0] [max-width:min(760px,_70%)] max-[1080px]:[max-width:min(720px,_86%)] max-[760px]:[max-width:88%]"}>
        {props.menuOpen ? (
          <MessageMoreMenu
            messageId={props.message.id}
            message={props.message}
            hasParticipant={Boolean(props.participant && props.participant.status !== "removed")}
            onClose={props.onCloseMenu}
            onMention={props.participant && props.participant.status !== "removed" ? () => props.onMentionParticipant(props.participant!) : null}
            onContinue={() => {
              if (props.participant && props.participant.status !== "removed") props.onMentionParticipant(props.participant);
              props.onQuoteMessage();
            }}
            onSummarize={props.onSummarizeMessage}
            onSendToApp={props.onSendToApp}
            onSendToAgent={props.onSendToAgent}
            onCopyLink={props.onCopyMessageLink}
            onEdit={props.onEditMessage}
            onDelete={props.onDeleteMessage}
            onRecall={props.onRecallMessage}
            onSelect={props.onSelectMessage}
          />
        ) : null}
        {!isUserMessage || statusLabel ? (
          <div data-slot="message-meta" className={`[&_span]:[color:var(--muted)] [&_span]:[font-size:12px] [display:flex] [align-items:center] [gap:7px] [min-height:20px] [margin-bottom:4px] [&_strong]:[color:var(--muted)] [&_strong]:[font-size:12px] [&_strong]:[font-weight:550] ${isUserMessage ? "[justify-content:flex-end]" : ""}`}>
            {!isUserMessage ? (
              props.participant && props.participant.status !== "removed" ? (
                <button
                  type="button"
                  className={"group [display:inline-flex] [align-items:center] [border:0] [padding:0] [color:var(--muted)] [background:transparent] [font-size:12px] [font-weight:550] [line-height:20px] [cursor:pointer] [transition:color_0.12s_ease] hover:![color:#2563eb] focus-visible:![color:#2563eb] focus-visible:[outline:none]"}
                  title={`@${props.participant.displayName}`}
                  aria-label={`在输入框中 @${props.participant.displayName}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => props.onMentionParticipant(props.participant!)}
                >
                  <span className={"[display:inline-block] [max-width:0] [overflow:hidden] [opacity:0] [transition:max-width_0.12s_ease,_opacity_0.12s_ease] group-hover:[max-width:14px] group-hover:[opacity:1] group-focus-visible:[max-width:14px] group-focus-visible:[opacity:1]"}>
                    @
                  </span>
                  <span>{senderLabel}</span>
                </button>
              ) : (
                <strong>{senderLabel}</strong>
              )
            ) : null}
            {statusLabel ? <span>{statusLabel}</span> : null}
          </div>
        ) : null}
        {isRemoved ? (
          <DeletedMessageBubble status={props.message.status} />
        ) : (
          <>
            {conversationBlocks.map((block, index) => (
              <MessageBlockRenderer
                key={block.id}
                block={block}
                artifacts={props.artifacts}
                allMessages={props.allMessages}
                allParticipants={props.allParticipants}
                identities={props.identities}
                conversations={props.conversations}
                rooms={props.rooms}
                messageRole={props.message.role}
                selectionMode={props.selectionMode}
                menuOpen={props.menuOpen}
                onReply={props.onQuoteMessage}
                onCopy={props.onCopyMessage}
                onOpenMenu={props.onOpenMenu}
                onOpenArtifact={props.onOpenArtifact}
                onOpenMessageLink={props.onOpenMessageLink}
                onOpenSummaryLink={props.onOpenSummaryLink}
                onEnsureSummaryTask={props.onEnsureSummaryTask}
                summaryTasks={props.summaryTasks}
                quotedMessage={index === 0 ? props.quotedMessage : null}
                onOpenReferencedMessage={(referencedMessage) => props.onOpenReferencedMessage(referencedMessage, props.message)}
              />
            ))}
            {runtimeEventBlocks.length ? <RuntimeEventGroup blocks={runtimeEventBlocks} artifacts={props.artifacts} onOpenArtifact={props.onOpenArtifact} /> : null}
          </>
        )}
      </div>
    </article>
  );
}

function isRuntimeEventBlock(block: MessageBlock) {
  return block.type === "tool_call" || block.type === "tool_result" || block.type === "artifact" || block.type === "error";
}

const MESSAGE_ACTION_BAR_Z_INDEX = 2147483000;
const MESSAGE_MORE_MENU_Z_INDEX = MESSAGE_ACTION_BAR_Z_INDEX + 1;
const MESSAGE_MORE_MENU_BOTTOM_RESERVE_PX = 96;

function MessageActionBar(props: {
  role: Message["role"];
  visible: boolean;
  menuOpen: boolean;
  onReply: () => void;
  onCopy: (position: CopyTipPosition) => void;
  onOpenMenu: (anchor: HTMLElement) => void;
}) {
  const isUser = props.role === "user";
  return (
    <div
      data-slot="message-actions"
      className={`[position:absolute] [z-index:30] [display:flex] [align-items:center] [gap:2px] [overflow:visible] [border:1px_solid_var(--border)] [border-radius:999px] [padding:3px] [background:#fffffff2] [box-shadow:0_8px_24px_rgb(0_0_0_/_10%)] [transition:opacity_0.12s_ease,_transform_0.12s_ease] [top:8px] ${props.visible ? "[opacity:1] [pointer-events:auto]" : "[opacity:0] [pointer-events:none]"} ${isUser ? "[left:0] [transform:translate(calc(-100%_-_6px),_0)]" : "[right:0] [transform:translate(calc(100%_+_6px),_0)]"} ${props.menuOpen ? "![opacity:1] ![pointer-events:auto]" : ""}`}
      style={props.menuOpen ? { zIndex: MESSAGE_ACTION_BAR_Z_INDEX } : undefined}
      aria-label="消息操作"
      onMouseEnter={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconAction title="回复" onClick={props.onReply}><Reply size={14} /></IconAction>
      <IconAction title="复制" onClick={(event) => props.onCopy({ x: event.clientX, y: event.clientY })}><Copy size={14} /></IconAction>
      <IconAction
        title="更多"
        onClick={(event) => {
          const anchor = event.currentTarget.closest('[data-slot="message-actions"]');
          if (anchor instanceof HTMLElement) props.onOpenMenu(anchor);
        }}
      >
        <MoreHorizontal size={14} />
      </IconAction>
    </div>
  );
}

function MessageMoreMenu(props: {
  messageId: string;
  message: Message;
  hasParticipant: boolean;
  onClose: () => void;
  onMention: (() => void) | null;
  onContinue: () => void;
  onSummarize: () => void;
  onSendToApp: () => void;
  onSendToAgent: () => void;
  onCopyLink: (position: CopyTipPosition) => void;
  onEdit: () => void;
  onDelete: () => Promise<unknown>;
  onRecall: () => Promise<unknown>;
  onSelect: () => void;
}) {
  const isUser = props.message.role === "user";
  const isAssistant = props.message.role === "assistant";
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: "hidden" });

  const run = async (action: () => void | Promise<unknown>) => {
    await action();
    props.onClose();
  };

  const updateMenuPosition = useCallback(() => {
    const anchor = findActiveMessageMenuAnchor(props.messageId);
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.width === 0 && anchorRect.height === 0) return;

    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width || menu.offsetWidth || 178;
    const menuHeight = menuRect.height || menu.offsetHeight || 280;
    const viewportPadding = 12;
    const maxBottom = window.innerHeight - MESSAGE_MORE_MENU_BOTTOM_RESERVE_PX;
    const maxMenuHeight = Math.max(160, maxBottom - viewportPadding);

    let top = anchorRect.top;
    if (top + menuHeight > maxBottom) {
      top = Math.max(viewportPadding, maxBottom - menuHeight);
    }

    let left: number;
    let transform: string | undefined;

    if (isUser) {
      left = anchorRect.left;
      transform = "translateX(-100%)";
      if (left - menuWidth < viewportPadding) {
        left = anchorRect.right;
        transform = undefined;
      }
    } else {
      left = anchorRect.right;
      transform = undefined;
      if (left + menuWidth > window.innerWidth - viewportPadding) {
        left = anchorRect.left;
        transform = "translateX(-100%)";
      }
    }

    setMenuStyle({
      position: "fixed",
      top,
      left,
      transform,
      zIndex: MESSAGE_MORE_MENU_Z_INDEX,
      maxHeight: maxMenuHeight,
      overflowY: "auto",
      visibility: "visible",
    });
  }, [props.messageId, isUser]);

  useLayoutEffect(() => {
    updateMenuPosition();
    const frame = window.requestAnimationFrame(() => updateMenuPosition());
    return () => window.cancelAnimationFrame(frame);
  }, [updateMenuPosition, props.message.id, props.hasParticipant, isAssistant, isUser]);

  useEffect(() => {
    const handleReposition = () => updateMenuPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [updateMenuPosition]);

  return createPortal(
    <div
      ref={menuRef}
      data-slot="message-more-menu"
      className={"[display:grid] [min-width:178px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:6px] [background:#ffffff] [box-shadow:0_18px_46px_rgb(0_0_0_/_14%)]"}
      style={menuStyle}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuButton icon={<CheckSquare size={14} />} label="多选" onClick={() => void run(props.onSelect)} />
      {props.onMention ? <MenuButton icon={<SendToBack size={14} />} label="@ 这个 Agent" onClick={() => void run(props.onMention!)} /> : null}
      {isAssistant ? <MenuButton icon={<RotateCcw size={14} />} label="继续追问" onClick={() => void run(props.onContinue)} /> : null}
      <MenuButton icon={<BrainCircuit size={14} />} label="总结" onClick={() => void run(props.onSummarize)} />
      <MenuButton icon={<SendToBack size={14} />} label="发送给应用" onClick={() => void run(props.onSendToApp)} />
      <MenuButton icon={<SendToBack size={14} />} label="发送给 Agent" onClick={() => void run(props.onSendToAgent)} />
      <MenuButton icon={<Copy size={14} />} label="复制消息链接" onClick={(event) => void run(() => props.onCopyLink({ x: event.clientX, y: event.clientY }))} />
      {isUser ? <MenuButton icon={<Edit3 size={14} />} label="编辑并重新回复" onClick={() => void run(props.onEdit)} /> : null}
      {isUser ? <MenuButton icon={<RotateCcw size={14} />} label="撤回" danger onClick={() => void run(props.onRecall)} /> : null}
      <MenuButton icon={<Trash2 size={14} />} label="删除" danger onClick={() => void run(props.onDelete)} />
    </div>,
    document.body,
  );
}

function BulkMessageToolbar(props: {
  count: number;
  onCopy: (position: CopyTipPosition) => void;
  onQuote: () => void;
  onSummarize: () => void;
  onSendToApp: () => void;
  onSendToAgent: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={"[position:absolute] [inset:0] [z-index:20] [display:flex] [align-items:center] [gap:8px] [overflow-x:auto] [border-top:1px_solid_var(--border)] [padding:8px_16px] [background:var(--panel)] [box-shadow:0_-8px_24px_rgb(0_0_0_/_6%)] max-[760px]:[padding-inline:12px]"}
      role="toolbar"
      aria-label="多选操作"
    >
      <span className={"[flex-shrink:0] [padding:0_4px] [color:var(--muted)] [font-size:13px] [font-weight:700]"}>已选 {props.count} 条</span>
      <ToolbarButton label="复制" onClick={(event) => props.onCopy({ x: event.clientX, y: event.clientY })} />
      <ToolbarButton label="引用" onClick={props.onQuote} />
      <ToolbarButton label="总结" onClick={props.onSummarize} />
      <ToolbarButton label="发给应用" onClick={props.onSendToApp} />
      <ToolbarButton label="发给 Agent" onClick={props.onSendToAgent} />
      <ToolbarButton label="删除" danger onClick={props.onDelete} />
      <div className={"[flex:1_1_auto]"} />
      <IconAction title="退出多选" onClick={() => props.onClose()}><X size={14} /></IconAction>
    </div>
  );
}

function SummaryAgentPicker(props: {
  messages: Message[];
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  onSelect: (participant: Participant) => void;
  onClose: () => void;
}) {
  const agents = props.participants.filter((participant) => participant.kind === "ai" && participant.status === "active");
  const preview = props.messages.length > 1
    ? `引用 ${props.messages.length} 条消息 · ${compactInline(props.messages[0]?.content || "[附件]")}`
    : compactInline(props.messages[0]?.content || "[附件]");
  return (
    <div className={"[position:fixed] [inset:0] [z-index:90] [display:grid] [place-items:center] [padding:24px] [background:rgb(15_23_42_/_34%)]"} role="dialog" aria-modal="true" aria-label="选择总结 Agent">
      <div className={"[display:grid] [width:min(420px,_calc(100vw_-_40px))] [gap:12px] [border:1px_solid_var(--border)] [border-radius:18px] [padding:16px] [background:var(--panel)] [box-shadow:0_24px_70px_rgb(0_0_0_/_22%)]"}>
        <header className={"[display:grid] [grid-template-columns:minmax(0,_1fr)_30px] [align-items:center] [gap:10px]"}>
          <span className={"[display:grid] [gap:3px]"}>
            <strong className={"[font-size:15px] [font-weight:750] [color:var(--text)]"}>选择一个 Agent 来总结</strong>
            <small className={"[color:var(--muted)] [font-size:12px]"}>{preview}</small>
          </span>
          <button type="button" className={"[display:grid] [width:30px] [height:30px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#00000008]"} aria-label="关闭" onClick={props.onClose}>
            <X size={15} />
          </button>
        </header>
        <div className={"[display:grid] [gap:8px]"}>
          {agents.length ? agents.map((participant) => {
            const identity = props.identities.find((item) => item.id === participant.identityId) ?? null;
            const resolvedAvatar = resolveAgentAvatarFromContext({
              avatar: participant.avatar,
              icon: identity?.icon,
              runtimeProfileId: participant.runtimeProfileId,
              identity,
              runtimeProfiles: props.runtimeProfiles,
            });
            return (
            <button
              key={participant.id}
              type="button"
              className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:10px] [border:1px_solid_var(--border)] [border-radius:12px] [padding:9px] [color:var(--text)] [background:#ffffff] [text-align:left] hover:[background:#f8fafc]"}
              onClick={() => props.onSelect(participant)}
            >
              <AgentAvatar title={participant.displayName} avatar={resolvedAvatar.avatar} provider={resolvedAvatar.provider} size={32} />
              <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap] [font-size:13px] [font-weight:650]"}>{participant.displayName}</span>
            </button>
            );
          }) : (
            <p className={"[margin:0] [color:var(--muted)] [font-size:13px]"}>当前房间没有可用 Agent。</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryPanel(props: {
  task: BackgroundTask;
  images: Artifact[];
  allParticipants: Participant[];
  identities: Identity[];
  onCopy: (position: CopyTipPosition) => void;
  onBackToSource: () => void;
  onClose: () => void;
}) {
  const summaryContent = props.task.content.trim();
  const loading = props.task.status === "running";
  const sourceMessage = props.task.sourceMessage;
  const isMultiSource = props.task.sourceMessageIds.length > 1;
  const sourcePreview = isMultiSource
    ? props.task.sourcePreview
    : sourceMessage?.content || props.task.sourcePreview || "[附件]";
  return (
    <aside className={"[position:fixed] [top:56px] [right:0] [bottom:0] [z-index:70] [display:grid] [width:min(420px,_calc(100vw_-_28px))] [grid-template-rows:auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:var(--panel)] [box-shadow:-18px_0_50px_rgb(0_0_0_/_14%)]"} aria-label="总结侧边栏">
      <header className={"[display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [align-items:center] [gap:8px] [border-bottom:1px_solid_var(--border)] [padding:14px] [background:#ffffff]"}>
        <span className={"[display:grid] [gap:2px] [min-width:0]"}>
          <strong className={"[color:var(--text)] [font-size:15px] [font-weight:750]"}>消息总结</strong>
          <small className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap] [color:var(--muted)] [font-size:12px]"}>
            {props.task.participantName} 总结 {isMultiSource ? `${props.task.sourceMessageIds.length} 条消息` : sourceMessage ? messageSenderLabel(sourceMessage, props.allParticipants, props.identities) : "消息"}
          </small>
        </span>
        <button type="button" className={"[display:grid] [width:30px] [height:30px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#00000008]"} aria-label="关闭总结" onClick={props.onClose}>
          <X size={15} />
        </button>
      </header>
      <div className={"[min-height:0] [overflow:auto] [padding:14px] [display:grid] [align-content:start] [gap:12px]"}>
        <section className={"[display:grid] [gap:8px] [border:1px_solid_var(--border)] [border-radius:12px] [padding:10px] [background:#f8fafc]"}>
          <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
            <strong className={"[font-size:12px] [font-weight:750] [color:var(--muted)]"}>{isMultiSource ? "原消息" : "原消息"}</strong>
            {props.task.sourceMessageId ? (
              <button
                type="button"
                className={"[height:28px] [border:0] [border-radius:8px] [padding:0_10px] [color:#ffffff] [background:#111827] [font-size:12px] [font-weight:700] [white-space:nowrap]"}
                onClick={props.onBackToSource}
              >
                回到原文
              </button>
            ) : null}
          </div>
          <p className={"[margin:0] [color:var(--text)] [font-size:13px] [line-height:1.55]"}>{compactInline(sourcePreview)}</p>
          {props.images.length ? (
            <div className={"[display:flex] [gap:8px] [overflow-x:auto] [padding-top:2px]"}>
              {props.images.map((artifact) => (
                <img key={artifact.id} className={"[width:96px] [height:72px] [border:1px_solid_var(--border)] [border-radius:10px] [object-fit:cover] [background:#00000008]"} src={artifact.publicUrl} alt={artifact.filename} />
              ))}
            </div>
          ) : null}
        </section>
        <section className={"[display:grid] [gap:8px]"}>
          <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
            <strong className={"[font-size:12px] [font-weight:750] [color:var(--muted)]"}>{loading ? "正在总结..." : "总结结果"}</strong>
            {!loading && summaryContent ? (
              <button
                type="button"
                className={"[height:28px] [border:0] [border-radius:8px] [padding:0_10px] [color:var(--text)] [background:#00000008] [font-size:12px] [font-weight:650]"}
                onClick={(event) => props.onCopy({ x: event.clientX, y: event.clientY })}
              >
                复制
              </button>
            ) : null}
          </div>
          <div className={"message-prose [min-height:160px] [border:1px_solid_var(--border)] [border-radius:12px] [padding:12px] [background:#ffffff] [color:var(--text)] [font-size:13px] [line-height:1.65]"}>
            {props.task.status === "failed" ? (
              <p className={"[margin:0] [color:var(--danger)]"}>{props.task.error || "总结失败"}</p>
            ) : summaryContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryContent}</ReactMarkdown>
            ) : (
              <p className={"[margin:0] [color:var(--muted)]"}>等待 Agent 返回总结...</p>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function DeletedMessageBubble(props: { status: Message["status"] }) {
  return (
    <div data-slot="message-block" className={"[width:fit-content] [max-width:100%] [border:1px_dashed_var(--border)] [border-radius:16px] [padding:9px_12px] [color:var(--muted)] [background:#00000004] [font-size:13px] [font-style:italic]"}>
      {props.status === "recalled" ? "这条消息已撤回" : "这条消息已删除"}
    </div>
  );
}

function ReferencedMessagePreview(props: {
  message: Message;
  participants: Participant[];
  identities: Identity[];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={"[display:block] [width:fit-content] [max-width:100%] [margin-bottom:6px] [border:0] [border-left:3px_solid_#c6d1e3] [border-radius:4px] [padding:3px_8px] [color:#7b8494] [background:#00000006] [font-size:13px] [line-height:20px] [text-align:left] [cursor:pointer] hover:[background:#0000000a]"}
      title="查看被引用的原文"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onOpen();
      }}
    >
      <span className={"[display:block] [max-width:min(460px,_100%)] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
        回复 {messageSenderLabel(props.message, props.participants, props.identities)}: {compactInline(props.message.content || "[附件]")}
      </span>
    </button>
  );
}

function ReferencedMessagePanel(props: {
  messages: Message[];
  blocks: MessageBlock[];
  participants: Participant[];
  allParticipants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  artifacts: Artifact[];
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">;
  onClose: () => void;
  onBackToMessage: (messageId: string) => void;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  return (
    <div className={"[position:fixed] [inset:0] [z-index:80] [background:rgb(15_23_42_/_18%)]"} onMouseDown={props.onClose}>
      <aside
        className={"[position:absolute] [inset:0_0_0_auto] [display:grid] [width:min(430px,_calc(100vw_-_36px))] [grid-template-rows:auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:#f8fafc] [box-shadow:-18px_0_42px_rgb(0_0_0_/_14%)]"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:10px] [border-bottom:1px_solid_var(--border)] [padding:16px_18px] [background:#ffffff]"}>
          <strong className={"[font-size:15px] [font-weight:760] [color:var(--text)]"}>详情页</strong>
          <button type="button" className={"[display:grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] hover:[color:var(--text)]"} aria-label="关闭详情页" onClick={props.onClose}>
            <X size={15} />
          </button>
        </header>
        <div className={"[min-height:0] [overflow-y:auto] [padding:18px] [display:grid] [align-content:start] [gap:18px]"}>
          {props.messages.map((message) => (
            <DetailMessageCard
              key={message.id}
              message={message}
              blocks={props.blocks.filter((block) => block.messageId === message.id)}
              artifacts={props.artifacts}
              participant={resolveMessageAgentParticipant(message, props.participants, props.allParticipants)}
              identities={props.identities}
              runtimeProfiles={props.runtimeProfiles}
              userProfile={props.userProfile}
              onBackToMessage={() => props.onBackToMessage(message.id)}
              onOpenArtifact={props.onOpenArtifact}
            />
          ))}
        </div>
      </aside>
    </div>
  );
}

function DetailMessageCard(props: {
  message: Message;
  blocks: MessageBlock[];
  artifacts: Artifact[];
  participant: Participant | null;
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">;
  onBackToMessage: () => void;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const sortedBlocks = [...props.blocks].sort(compareMessageBlocks);
  const isRemoved = props.message.status === "deleted" || props.message.status === "recalled";
  const isUserMessage = props.message.role === "user";
  const participantIdentity = props.participant?.identityId
    ? props.identities.find((identity) => identity.id === props.participant?.identityId) ?? null
    : null;
  const senderLabel = resolveMessageSenderLabel(props.message, props.participant, participantIdentity);
  return (
    <article className={"[display:grid] [gap:10px] [border-radius:16px] [padding:16px] [background:#eef0f3]"}>
      <div className={"[display:grid] [grid-template-columns:38px_minmax(0,_1fr)_auto] [gap:10px] [align-items:center]"}>
        <span className={isUserMessage
          ? "[display:grid] [width:38px] [height:38px] [overflow:hidden] [border-radius:999px]"
          : "[display:inline-flex] [width:38px] [height:38px] [align-items:center] [justify-content:center]"}>
          <MessageSenderAvatar
            message={props.message}
            participant={props.participant}
            identity={participantIdentity}
            runtimeProfiles={props.runtimeProfiles}
            userProfile={props.userProfile}
            size={40}
          />
        </span>
        <span className={"[display:grid] [min-width:0]"}>
          <strong className={"[font-size:13px] [font-weight:750] [color:var(--text)]"}>{senderLabel}</strong>
          <small className={"[color:var(--muted)] [font-size:12px]"}>{formatMessageTime(props.message.createdAt)}</small>
        </span>
        <button
          type="button"
          className={"[height:30px] [border:0] [border-radius:9px] [padding:0_10px] [color:#ffffff] [background:#111827] [font-size:12px] [font-weight:700] [white-space:nowrap]"}
          onClick={props.onBackToMessage}
        >
          回到原文
        </button>
      </div>
      {isRemoved ? (
        <DeletedMessageBubble status={props.message.status} />
      ) : (
        sortedBlocks.filter((block) => !isRuntimeEventBlock(block)).map((block) => (
          <MessageBlockRenderer key={block.id} block={block} artifacts={props.artifacts} onOpenArtifact={props.onOpenArtifact} />
        ))
      )}
    </article>
  );
}

function IconAction(props: { title: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={"group/icon [position:relative] [display:inline-grid] [width:28px] [height:28px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000008]"}
      aria-label={props.title}
      onClick={props.onClick}
    >
      {props.children}
      <span
        role="tooltip"
        className={"[position:absolute] [left:50%] [bottom:calc(100%+6px)] [z-index:30] [transform:translateX(-50%)] [border-radius:6px] [padding:4px_8px] [color:#ffffff] [background:#1f2329] [font-size:12px] [font-weight:500] [line-height:18px] [white-space:nowrap] [pointer-events:none] [opacity:0] [transition:opacity_0.12s_ease] group-hover/icon:[opacity:1] group-focus-visible/icon:[opacity:1]"}
      >
        {props.title}
        <span
          aria-hidden
          className={"[position:absolute] [left:50%] [top:100%] [transform:translateX(-50%)] [width:0] [height:0] [border-left:5px_solid_transparent] [border-right:5px_solid_transparent] [border-top:5px_solid_#1f2329]"}
        />
      </span>
    </button>
  );
}

function MenuButton(props: { icon: ReactNode; label: string; danger?: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className={`[display:flex] [height:34px] [align-items:center] [gap:8px] [border:0] [border-radius:10px] [padding:0_9px] [background:transparent] [font-size:12px] [font-weight:650] [text-align:left] [&:hover]:[background:#00000008] ${props.danger ? "[color:var(--danger)]" : "[color:var(--text)]"}`} role="menuitem" onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function ToolbarButton(props: { label: string; danger?: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className={`[height:30px] [border:0] [border-radius:999px] [padding:0_10px] [font-size:12px] [font-weight:750] [&:hover]:[background:#00000010] ${props.danger ? "[color:var(--danger)] [background:#dc262612]" : "[color:var(--text)] [background:#00000008]"}`} onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function MessageSenderAvatar(props: {
  message: Message;
  participant: Participant | null;
  identity?: Pick<Identity, "name" | "icon" | "defaultRuntimeProfileId"> | null;
  runtimeProfiles: RuntimeProfile[];
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">;
  size?: UserAvatarSize;
}) {
  const size = props.size ?? 34;
  if (props.message.role === "user") {
    return (
      <UserAvatar
        size={size}
        preset={props.userProfile.avatarPreset}
        customAvatarUrl={props.userProfile.customAvatarUrl}
      />
    );
  }
  const label = props.participant?.displayName
    || props.identity?.name
    || props.message.senderName
    || "Agent";
  const resolvedAvatar = resolveAgentAvatarFromContext({
    avatar: props.participant?.avatar,
    icon: props.identity?.icon,
    runtimeProfileId: props.participant?.runtimeProfileId,
    identity: props.identity,
    runtimeProfiles: props.runtimeProfiles,
  });
  const avatarSize = size <= 34 ? 34 : size <= 40 ? 40 : 56;
  return (
    <AgentAvatar title={label} avatar={resolvedAvatar.avatar} provider={resolvedAvatar.provider} size={avatarSize} />
  );
}

function compactInline(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 120);
}

function compactComparableText(content: string) {
  return compactInline(content).replace(/^>\s*回复\s+[^:：]+[:：]\s*/, "").toLowerCase();
}

function restoreTimelineScroll(container: HTMLElement, scrollTop: number) {
  const apply = () => {
    container.scrollTop = scrollTop;
  };
  apply();
  requestAnimationFrame(apply);
  window.setTimeout(apply, 0);
  window.setTimeout(apply, 48);
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function copyTextToClipboard(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

function compareMessageBlocks(left: MessageBlock, right: MessageBlock) {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  return left.createdAt.localeCompare(right.createdAt);
}

function RuntimeEventGroup(props: { blocks: MessageBlock[]; artifacts: Artifact[]; onOpenArtifact: (artifact: Artifact) => void }) {
  const failedCount = props.blocks.filter((block) => block.status === "error").length;
  const label = failedCount
    ? `${props.blocks.length} 条运行细节 · ${failedCount} 条失败`
    : `${props.blocks.length} 条运行细节`;
  return (
    <details className={"[width:fit-content] [max-width:100%] [margin-top:6px] [color:var(--muted)] [&_summary]:[display:inline-flex] [&_summary]:[height:28px] [&_summary]:[align-items:center] [&_summary]:[gap:7px] [&_summary]:[border-radius:999px] [&_summary]:[padding:0_10px] [&_summary]:[background:#00000008] [&_summary]:[cursor:pointer] [&_summary]:[list-style:none] [&_summary]:[font-size:12px] [&_summary]:[font-weight:650] [&_summary::-webkit-details-marker]:[display:none] [&[open]_summary]:[margin-bottom:6px]"}>
      <summary>
        <Terminal size={14} />
        <span>{label}</span>
      </summary>
      <div className={"[display:grid] [max-height:320px] [gap:6px] [overflow:auto] [padding-right:4px]"}>
        {props.blocks.map((block) => (
          <MessageBlockRenderer key={block.id} block={block} artifacts={props.artifacts} onOpenArtifact={props.onOpenArtifact} />
        ))}
      </div>
    </details>
  );
}

const MESSAGE_ACTION_BAR_BRIDGE_PX = 96;

function MessageBlockShell(props: {
  role: Message["role"];
  selectionMode: boolean;
  menuOpen: boolean;
  onReply: () => void;
  onCopy: (position: CopyTipPosition) => void;
  onOpenMenu: (anchor: HTMLElement) => void;
  children: ReactNode;
}) {
  const [actionsVisible, setActionsVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const isUser = props.role === "user";

  const showActions = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setActionsVisible(true);
  };

  const hideActions = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setActionsVisible(false);
      hideTimerRef.current = null;
    }, 140);
  };

  useEffect(() => () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => {
    if (props.menuOpen) showActions();
  }, [props.menuOpen]);

  return (
    <div
      data-slot="message-block-shell"
      className={`group/block [position:relative] [width:fit-content] [max-width:100%] ${isUser ? "before:[content:''] before:[position:absolute] before:[top:0] before:[left:calc(-1_*_var(--message-action-bridge))] before:[height:100%] before:[width:var(--message-action-bridge)]" : "after:[content:''] after:[position:absolute] after:[top:0] after:[right:calc(-1_*_var(--message-action-bridge))] after:[height:100%] after:[width:var(--message-action-bridge)]"}`}
      style={{ ["--message-action-bridge" as string]: `${MESSAGE_ACTION_BAR_BRIDGE_PX}px` }}
      onMouseEnter={showActions}
      onMouseLeave={hideActions}
      onFocusCapture={showActions}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        hideActions();
      }}
    >
      {!props.selectionMode ? (
        <MessageActionBar
          role={props.role}
          visible={actionsVisible || props.menuOpen}
          menuOpen={props.menuOpen}
          onReply={props.onReply}
          onCopy={props.onCopy}
          onOpenMenu={props.onOpenMenu}
        />
      ) : null}
      {props.children}
    </div>
  );
}

function MessageBlockRenderer(props: {
  block: MessageBlock;
  artifacts: Artifact[];
  allMessages?: Message[];
  allParticipants?: Participant[];
  identities?: Identity[];
  conversations?: Conversation[];
  rooms?: Room[];
  summaryTasks?: BackgroundTask[];
  messageRole?: Message["role"];
  selectionMode?: boolean;
  menuOpen?: boolean;
  onReply?: () => void;
  onCopy?: (position: CopyTipPosition) => void;
  onOpenMenu?: (anchor: HTMLElement) => void;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenMessageLink?: (messageId: string) => void;
  onOpenSummaryLink?: (taskId: string) => void;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  quotedMessage?: Message | null;
  onOpenReferencedMessage?: (message: Message) => void;
}) {
  const blockShell = (content: ReactNode) => {
    if (props.messageRole && props.onReply && props.onCopy && props.onOpenMenu) {
      return (
        <MessageBlockShell
          role={props.messageRole}
          selectionMode={props.selectionMode ?? false}
          menuOpen={props.menuOpen ?? false}
          onReply={props.onReply}
          onCopy={props.onCopy}
          onOpenMenu={props.onOpenMenu}
        >
          {content}
        </MessageBlockShell>
      );
    }
    return content;
  };

  if (props.block.type === "image" || props.block.type === "file") {
    const artifactId = props.block.metadata?.artifactId;
    const artifact = props.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return null;
    return blockShell(<ArtifactBlock artifact={artifact} onOpen={() => props.onOpenArtifact(artifact)} />);
  }
  if (props.block.type === "reasoning") {
    return (
      <details data-slot="event-block" className={`[&_pre]:[overflow-x:auto] [&_pre]:[border-radius:10px] [&_pre]:[padding:10px] [&_pre]:[white-space:pre-wrap] [width:fit-content] [max-width:100%] [margin-top:6px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:8px_10px] [color:var(--muted)] [background:var(--panel-2)] [font-size:12px] [&_summary]:[display:flex] [&_summary]:[align-items:center] [&_summary]:[gap:6px] [&_summary]:[cursor:pointer] [&_summary]:[font-weight:650] [&_summary_span]:[color:inherit] [&_pre]:[max-width:100%] [&_pre]:[max-height:180px] [&_pre]:[margin:8px_0_0] [&_pre]:[overflow:auto] [&_pre]:[color:#404040] [&_pre]:[background:#ffffff] [&_p]:[margin:8px_0_0] [background:#f8fafc] ${props.block.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""}`} open={props.block.status === "streaming"}>
        <summary>
          <BrainCircuit size={15} />
          <span>{props.block.status === "streaming" ? "Thinking" : "Reasoning"}</span>
        </summary>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.block.content || " "}</ReactMarkdown>
      </details>
    );
  }
  if (props.block.type === "tool_call" || props.block.type === "tool_result") {
    const toolName = typeof props.block.metadata?.toolName === "string" ? props.block.metadata.toolName : "tool";
    const isResult = props.block.type === "tool_result";
    return (
      <div data-slot="event-block" className={`[&_pre]:[overflow-x:auto] [&_pre]:[border-radius:10px] [&_pre]:[padding:10px] [&_pre]:[white-space:pre-wrap] [width:fit-content] [max-width:100%] [margin-top:6px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:8px_10px] [color:var(--muted)] [background:var(--panel-2)] [font-size:12px] [&_summary]:[display:flex] [&_summary]:[align-items:center] [&_summary]:[gap:6px] [&_summary]:[cursor:pointer] [&_summary]:[font-weight:650] [&_summary_span]:[color:inherit] [&_pre]:[max-width:100%] [&_pre]:[max-height:180px] [&_pre]:[margin:8px_0_0] [&_pre]:[overflow:auto] [&_pre]:[color:#404040] [&_pre]:[background:#ffffff] [&_p]:[margin:8px_0_0] ${props.block.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${props.block.status === "error" ? "[border-color:#dc26262e] [color:var(--danger)] [background:#fef2f2]" : ""}`}>
        <div className={"[display:flex] [align-items:center] [gap:6px] [cursor:pointer] [font-weight:650] [&_span]:[color:inherit]"}>
          {isResult ? <Braces size={15} /> : <Wrench size={15} />}
          <strong>{toolName}</strong>
          <span>{formatToolBlockStatus(props.block)}</span>
        </div>
        {props.block.content ? <pre>{props.block.content}</pre> : null}
      </div>
    );
  }
  if (props.block.type === "artifact" || props.block.type === "error") {
    return (
      <div data-slot="event-block" className={`[&_pre]:[overflow-x:auto] [&_pre]:[border-radius:10px] [&_pre]:[padding:10px] [&_pre]:[white-space:pre-wrap] [width:fit-content] [max-width:100%] [margin-top:6px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:8px_10px] [color:var(--muted)] [background:var(--panel-2)] [font-size:12px] [&_summary]:[display:flex] [&_summary]:[align-items:center] [&_summary]:[gap:6px] [&_summary]:[cursor:pointer] [&_summary]:[font-weight:650] [&_summary_span]:[color:inherit] [&_pre]:[max-width:100%] [&_pre]:[max-height:180px] [&_pre]:[margin:8px_0_0] [&_pre]:[overflow:auto] [&_pre]:[color:#404040] [&_pre]:[background:#ffffff] [&_p]:[margin:8px_0_0] ${props.block.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${props.block.type === "error" || props.block.status === "error" ? "[border-color:#dc26262e] [color:var(--danger)] [background:#fef2f2]" : ""}`}>
        <div className={"[display:flex] [align-items:center] [gap:6px] [cursor:pointer] [font-weight:650] [&_span]:[color:inherit]"}>
          <FileText size={15} />
          <strong>{props.block.type === "error" ? "Runtime event" : "Artifact"}</strong>
          <span>{props.block.status}</span>
        </div>
        {props.block.content ? <pre>{props.block.content}</pre> : null}
      </div>
    );
  }
  const content = normalizeMarkdownContent(props.block.content || " ");
  const quotedContent = extractLeadingReplyQuote(content);
  const bodyContent = quotedContent?.body ?? content;
  const messageLinks = extractMessageLinks(bodyContent);
  const summaryLinks = extractSummaryLinks(bodyContent);
  const bodyWithoutLinks = removeEmbeddedLinks(bodyContent).trim();
  const displayContent = bodyWithoutLinks || bodyContent;
  const collapsed = displayContent.length > COLLAPSED_MESSAGE_CHAR_LIMIT;
  const isLinkOnly =
    (messageLinks.length > 0 || summaryLinks.length > 0)
    && !bodyWithoutLinks
    && !props.quotedMessage
    && !quotedContent;
  return blockShell(
    <div
      data-slot="message-block"
      data-link-only={isLinkOnly || undefined}
      className={`message-prose [width:fit-content] [max-width:100%] [border:0] [border-radius:16px] [color:var(--text)] ${isLinkOnly ? "[display:grid] [gap:6px] [padding:0] [background:transparent]" : "[padding:10px_13px] [background:#00000008]"} ${props.block.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""}`}
    >
      {props.quotedMessage ? (
        <ReferencedMessagePreview
          message={props.quotedMessage}
          participants={props.allParticipants ?? []}
          identities={props.identities ?? []}
          onOpen={() => props.onOpenReferencedMessage?.(props.quotedMessage!)}
        />
      ) : quotedContent ? (
        <ReplyQuotePreview quotes={quotedContent.quotes} />
      ) : null}
      {messageLinks.map((messageId) => (
        <MessageLinkCard
          key={`message-${messageId}`}
          messageId={messageId}
          messages={props.allMessages ?? []}
          participants={props.allParticipants ?? []}
          conversations={props.conversations ?? []}
          rooms={props.rooms ?? []}
          onOpen={() => props.onOpenMessageLink?.(messageId)}
        />
      ))}
      {summaryLinks.map((taskId) => (
        <SummaryLinkCard
          key={`summary-${taskId}`}
          taskId={taskId}
          summaryTasks={props.summaryTasks ?? []}
          conversations={props.conversations ?? []}
          rooms={props.rooms ?? []}
          onEnsureSummaryTask={props.onEnsureSummaryTask}
          onOpen={() => props.onOpenSummaryLink?.(taskId)}
        />
      ))}
      {collapsed ? (
        <CollapsibleMessageContent content={displayContent} />
      ) : bodyWithoutLinks ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyWithoutLinks}</ReactMarkdown>
      ) : messageLinks.length || summaryLinks.length ? null : (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyContent || " "}</ReactMarkdown>
      )}
    </div>,
  );
}

function ReplyQuotePreview(props: { quotes: Array<{ sender: string; content: string }> }) {
  const firstQuote = props.quotes[0];
  if (!firstQuote) return null;
  return (
    <div className={"[display:block] [max-width:100%] [margin-bottom:8px] [border-left:3px_solid_#c6d1e3] [padding-left:10px] [color:#7b8494] [font-size:13px] [line-height:20px] [white-space:nowrap] [overflow:hidden] [text-overflow:ellipsis]"}>
      {props.quotes.length > 1 ? `引用 ${props.quotes.length} 条消息 · ${firstQuote.sender}: ${firstQuote.content}` : `回复 ${firstQuote.sender}: ${firstQuote.content}`}
    </div>
  );
}

const embeddedLinkCardClassName =
  "[display:grid] [width:300px] [max-width:100%] [gap:3px] [border:1px_solid_var(--border)] [border-radius:10px] [padding:7px_9px] [color:var(--text)] [background:#ffffff] [text-align:left] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] hover:[border-color:#cbd5e1] hover:[background:#f8fafc]";

function SummaryLinkCard(props: {
  taskId: string;
  summaryTasks: BackgroundTask[];
  conversations: Conversation[];
  rooms: Room[];
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  onOpen: () => void;
}) {
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "failed">("idle");
  const task = props.summaryTasks.find((item) => item.id === props.taskId) ?? null;
  const conversation = task ? props.conversations.find((item) => item.id === task.conversationId) ?? null : null;
  const room = conversation ? props.rooms.find((item) => item.id === conversation.roomId) ?? null : null;
  const preview = task
    ? compactInline(task.content || task.sourcePreview || "[附件]")
    : fetchState === "loading"
      ? "正在加载总结..."
      : fetchState === "failed"
        ? "这条总结不存在或已被移除"
        : "正在加载总结...";

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
      className={embeddedLinkCardClassName}
      onClick={props.onOpen}
    >
      <span className={"[display:flex] [align-items:center] [gap:5px] [color:#2563eb] [font-size:12px] [font-weight:700] [line-height:1.3]"}>
        <BrainCircuit size={13} />
        <span>{summaryLinkLabel(task)}</span>
      </span>
      <span className={"[display:block] [overflow:hidden] [color:var(--text)] [font-size:13px] [font-weight:600] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]"}>
        {preview}
      </span>
      <span className={"[display:flex] [align-items:center] [gap:6px] [color:var(--muted)] [font-size:11px] [line-height:1.3]"}>
        <span>{room?.title || conversation?.title || "未知会话"}</span>
        {task ? <span>{task.participantName}</span> : null}
        {task ? <span>{formatMessageTime(task.updatedAt)}</span> : null}
      </span>
    </button>
  );
}

function MessageLinkCard(props: {
  messageId: string;
  messages: Message[];
  participants: Participant[];
  conversations: Conversation[];
  rooms: Room[];
  onOpen: () => void;
}) {
  const message = props.messages.find((item) => item.id === props.messageId) ?? null;
  const participant = message?.senderParticipantId
    ? props.participants.find((item) => item.id === message.senderParticipantId) ?? null
    : null;
  const conversation = message ? props.conversations.find((item) => item.id === message.conversationId) ?? null : null;
  const room = conversation ? props.rooms.find((item) => item.id === conversation.roomId) ?? null : null;
  return (
    <button
      type="button"
      className={embeddedLinkCardClassName}
      onClick={props.onOpen}
    >
      <span className={"[display:flex] [align-items:center] [gap:5px] [color:#2563eb] [font-size:12px] [font-weight:700] [line-height:1.3]"}>
        <Reply size={13} />
        <span>{message ? `来自 ${messageSenderLabel(message, props.participants)} 的消息链接` : "消息链接"}</span>
      </span>
      <span className={"[display:block] [overflow:hidden] [color:var(--text)] [font-size:13px] [font-weight:600] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]"}>
        {message ? compactInline(message.content || "[附件]") : "这条消息暂时不在本地快照中"}
      </span>
      <span className={"[display:flex] [align-items:center] [gap:6px] [color:var(--muted)] [font-size:11px] [line-height:1.3]"}>
        <span>{room?.title || conversation?.title || "未知会话"}</span>
        {participant ? <span>{participant.displayName}</span> : null}
        {message ? <span>{formatMessageTime(message.createdAt)}</span> : null}
      </span>
    </button>
  );
}

function CollapsibleMessageContent(props: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsCollapse = props.content.length > COLLAPSED_MESSAGE_CHAR_LIMIT;
  const visibleContent =
    !needsCollapse || expanded
      ? props.content
      : `${props.content.slice(0, COLLAPSED_MESSAGE_CHAR_LIMIT)}...`;

  return (
    <div className={"[display:grid] [gap:6px]"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleContent}</ReactMarkdown>
      {needsCollapse ? (
        <button
          type="button"
          className={"[justify-self:start] [border:0] [padding:0] [color:#2563eb] [background:transparent] [font-size:12px] [font-weight:650] [cursor:pointer] hover:[text-decoration:underline]"}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      ) : null}
    </div>
  );
}


function imageArtifactsForMessage(messageId: string, blocks: MessageBlock[], artifacts: Artifact[]) {
  return blocks
    .filter((block) => block.messageId === messageId && block.type === "image")
    .map((block) => {
      const artifactId = typeof block.metadata?.artifactId === "string" ? block.metadata.artifactId : null;
      return artifactId ? artifacts.find((artifact) => artifact.id === artifactId) ?? null : null;
    })
    .filter((artifact): artifact is Artifact => Boolean(artifact));
}

function normalizeMarkdownContent(content: string) {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/i);
  return match?.[1] ?? content;
}

function extractLeadingReplyQuote(content: string) {
  const lines = content.split(/\n/);
  const bodyStartIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "");
  if (bodyStartIndex === -1) return null;
  const quoteLines = lines.slice(0, bodyStartIndex);
  if (!quoteLines.length || quoteLines.some((line) => !line.startsWith(">"))) return null;
  const quotes = quoteLines
    .map((line) => line.replace(/^>\s?/, "").match(/^回复\s+([^:：]+)[:：]\s*(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      sender: match[1]?.trim() || "消息",
      content: (match[2] ?? "").replace(/\s+/g, " ").trim(),
    }));
  if (quotes.length !== quoteLines.length) return null;
  const quoteText = quoteLines
    .map((line) => line.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/^回复\s+([^:：]+)[:：]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  const body = lines.slice(bodyStartIndex + 1).join("\n").trimStart();
  return {
    sender: quotes[0]?.sender ?? "消息",
    content: quoteText,
    quotes,
    body,
  };
}

function formatToolBlockStatus(block: MessageBlock) {
  if (block.type === "tool_call" && block.status === "streaming") return "running";
  if (block.type === "tool_call" && block.status === "success") return "called";
  if (block.type === "tool_result" && block.status === "success") return "completed";
  if (block.status === "error") return "failed";
  return block.status;
}

function ArtifactBlock(props: { artifact: Artifact; onOpen: () => void }) {
  const isImage = props.artifact.mimeType.startsWith("image/");
  if (isImage) {
    return (
      <button
        type="button"
        data-slot="artifact-block"
        className={"[display:block] [width:min(280px,_100%)] [height:180px] [margin-top:8px] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:16px] [padding:0] [background:var(--panel)] [cursor:pointer]"}
        onClick={props.onOpen}
        aria-label={props.artifact.filename}
      >
        <img
          className={"[display:block] [width:100%] [height:100%] [object-fit:cover]"}
          src={props.artifact.publicUrl}
          alt={props.artifact.filename}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      data-slot="artifact-block"
      className={"[display:grid] [width:min(520px,_100%)] [min-height:88px] [grid-template-columns:56px_minmax(0,_1fr)] [align-items:center] [gap:16px] [margin-top:8px] [border:1px_solid_var(--border)] [border-radius:12px] [padding:16px_20px] [color:var(--text)] [background:#ffffff] [cursor:pointer] [box-shadow:0_1px_2px_rgb(0_0_0_/_3%)] [transition:border-color_0.12s_ease,_background-color_0.12s_ease,_box-shadow_0.12s_ease] hover:[border-color:#d4d4d8] hover:[background:#fbfbfc] hover:[box-shadow:0_4px_14px_rgb(0_0_0_/_6%)] focus-visible:[outline:none] focus-visible:[border-color:var(--border-strong)]"}
      onClick={props.onOpen}
      title={canPreviewInApp(props.artifact.mimeType, props.artifact.filename) ? "应用内预览" : "用系统默认应用打开"}
    >
      <span className={"[position:relative] [display:grid] [width:50px] [height:58px] [place-items:center] [border-radius:7px] [color:#ffffff] [background:#8d96a3] [box-shadow:inset_0_0_0_1px_rgb(255_255_255_/_20%)] before:[content:''] before:[position:absolute] before:[right:0] before:[top:0] before:[width:16px] before:[height:16px] before:[clip-path:polygon(0_0,_100%_100%,_100%_0)] before:[background:#c8ced6]"}>
        <FileText size={25} strokeWidth={2.1} />
      </span>
      <span className={"[display:grid] [min-width:0] [gap:8px] [text-align:left]"}>
        <strong className={"[min-width:0] [overflow:hidden] [color:#171717] [font-size:17px] [font-weight:600] [line-height:1.25] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {props.artifact.filename}
        </strong>
        <small className={"[color:#8a8f98] [font-size:14px] [font-weight:450] [line-height:1]"}>
          {formatBytes(props.artifact.sizeBytes)}
        </small>
      </span>
    </button>
  );
}
