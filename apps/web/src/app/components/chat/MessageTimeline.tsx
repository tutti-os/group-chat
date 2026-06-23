import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Braces, BrainCircuit, CheckSquare, ChevronDown, ChevronRight, ChevronsDown, Copy, Edit3, Ear, FileText, MoreHorizontal, Reply, RotateCcw, SendHorizontal, Terminal, Trash2, Wrench, X } from "lucide-react";
import type { Artifact, AgentRun, AgentRunEvent, Conversation, Identity, Message, MessageBlock, Participant, Room, RuntimeProfile } from "@group-chat/shared";
import { isLocalUserMessage, resolveMessageVisibility, enrichAssistantContentWithWorkspaceResourceLinks, resolveTriggerUserMentions, stripAssistantSkillDetails } from "@group-chat/shared";
import { getArtifactCategory, revealArtifactInTuttiFileManager } from "../../artifact-actions.js";
import { enrichMessageContentForCopy } from "../../composer-paste-content.js";
import { formatBytes, formatMessageStatus, formatMessageTime, truncateMiddle } from "../../formatting.js";
import { TuttiMessageLinkIcon } from "../../tutti-reference-icons.js";
import type { LocalUserProfile } from "../../user-profile.js";
import { UserAvatar, type UserAvatarSize } from "../ui/UserAvatar.js";
import { getRuntimeProviderAvatarStyle, resolveAgentAvatarFromContext } from "../../identity-avatar.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";
import { WHISPER_FEATURE_ENABLED } from "../../feature-flags.js";
import type { BackgroundTask } from "../../background-tasks.js";
import type { TuttiAgentGuiProvider } from "../../agent-gui-dispatch.js";
import {
  collectSummaryTaskIds,
  copyMessagesToClipboard,
  copyMessagesToClipboardEvent,
  copySummaryToClipboard,
  extractMessageLinks,
  extractSummaryLinks,
  formatMessageLink,
  formatMessageLinkLabel,
  parseMessageLinkIds,
  primaryMessageLinkId,
  removeEmbeddedLinks,
  readStashedSummaryLink,
  resolveSourceMessages,
  resolveMessageAgentParticipant,
  resolveMessageSenderLabel,
  messageSenderLabel,
  summaryLinkLabel,
} from "../../chat-links.js";
import { collectImageFileArtifactsForMessages } from "../../message-artifacts.js";
import { enrichContentWithParticipantMentions, enrichContentWithReferenceMentions } from "../../reference-mentions.js";
import { MessageReferenceContent } from "./MessageReferenceContent.js";
import { isMessageGroupBreak, MESSAGE_GROUP_IDLE_MS } from "../../message-group-breaks.js";
import { attachmentLabel, t, translateAgentError, translateSystemNotice, useTranslation } from "../../i18n/index.js";
import { resolveSummaryCardPresentation, SUMMARY_LINK_CARD_CLASS } from "../../summary-link-card.js";
import { resolveLinkedMessagePreviewBlocks } from "../../message-card-elements.js";
import { resolveMessageHoverTimePosition } from "../../message-hover-layout.js";

const COLLAPSED_MESSAGE_CHAR_LIMIT = 800;
const COPY_TIP_OFFSET_PX = 8;
const MESSAGE_GROUP_GAP_MS = MESSAGE_GROUP_IDLE_MS;
const EMPTY_MESSAGE_BLOCKS: MessageBlock[] = [];

type CopyTipPosition = { x: number; y: number };
type CopyMessageInput = { position: CopyTipPosition; anchorEl?: HTMLElement | null; menuCopy?: boolean };

export type AgentForwardTarget = {
  provider: TuttiAgentGuiProvider;
  runtimeProvider: string;
  label: string;
  subtitle: string;
  available: boolean;
};

const MessageBodyCopyContext = createContext<((input: CopyMessageInput) => void) | null>(null);

const MESSAGE_MORE_MENU_SELECTOR = '[data-slot="message-more-menu"]';

type CopyMessageScope =
  | { kind: "message" }
  | { kind: "artifact"; artifactId: string }
  | { kind: "text-block"; blockId: string };

function resolveCopyScopeFromAnchor(anchor: HTMLElement | null): CopyMessageScope {
  if (!anchor) return { kind: "message" };
  const slot = anchor.getAttribute("data-slot");
  if (slot === "artifact-block") {
    const artifactId = anchor.getAttribute("data-artifact-id")?.trim();
    if (artifactId) return { kind: "artifact", artifactId };
  }
  if (slot === "message-block") {
    const blockId = anchor.getAttribute("data-block-id")?.trim();
    if (blockId) return { kind: "text-block", blockId };
  }
  return { kind: "message" };
}

function hasMeaningfulMessageCopyText(text: string) {
  const trimmed = text.trim();
  return Boolean(trimmed) && trimmed !== attachmentLabel();
}

function selectionIntersectsNode(range: Range, node: Node) {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function selectionIntersectsTimelineCopyContent(range: Range, container: HTMLElement) {
  for (const element of container.querySelectorAll('[data-slot="message-copy-content"]')) {
    if (selectionIntersectsNode(range, element)) return true;
  }
  return false;
}

function selectedTextFromTimelineRange(range: Range, container: HTMLElement) {
  const parts: string[] = [];
  for (const content of container.querySelectorAll<HTMLElement>('[data-slot="message-copy-content"]')) {
    if (!selectionIntersectsNode(range, content)) continue;
    const contentRange = document.createRange();
    contentRange.selectNodeContents(content);
    const intersection = document.createRange();
    if (range.compareBoundaryPoints(Range.START_TO_START, contentRange) > 0) {
      intersection.setStart(range.startContainer, range.startOffset);
    } else {
      intersection.setStart(contentRange.startContainer, contentRange.startOffset);
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, contentRange) < 0) {
      intersection.setEnd(range.endContainer, range.endOffset);
    } else {
      intersection.setEnd(contentRange.endContainer, contentRange.endOffset);
    }
    const text = intersection.toString();
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

function selectedArtifactIdsFromTimelineRange(range: Range, container: HTMLElement) {
  const artifactIds = new Set<string>();
  for (const element of container.querySelectorAll<HTMLElement>('[data-slot="artifact-block"][data-artifact-id]')) {
    if (!selectionIntersectsNode(range, element)) continue;
    const artifactId = element.dataset.artifactId?.trim();
    if (artifactId) artifactIds.add(artifactId);
  }
  return [...artifactIds];
}

type OrderedClipboardPart =
  | { type: "text"; content: string }
  | { type: "artifact"; artifactId: string };

function selectedOrderedPartsFromTimelineRange(
  range: Range,
  container: HTMLElement,
  blocks: MessageBlock[],
  messages: Message[],
): OrderedClipboardPart[] {
  const parts: OrderedClipboardPart[] = [];
  for (const element of container.querySelectorAll<HTMLElement>(
    '[data-slot="message-block"], [data-slot="artifact-block"][data-artifact-id]',
  )) {
    if (!selectionIntersectsNode(range, element)) continue;
    if (element.dataset.slot === "artifact-block") {
      const artifactId = element.dataset.artifactId?.trim();
      if (artifactId) parts.push({ type: "artifact", artifactId });
      continue;
    }
    const contentRange = document.createRange();
    contentRange.selectNodeContents(element);
    const intersection = document.createRange();
    intersection.setStart(
      range.compareBoundaryPoints(Range.START_TO_START, contentRange) > 0 ? range.startContainer : contentRange.startContainer,
      range.compareBoundaryPoints(Range.START_TO_START, contentRange) > 0 ? range.startOffset : contentRange.startOffset,
    );
    intersection.setEnd(
      range.compareBoundaryPoints(Range.END_TO_END, contentRange) < 0 ? range.endContainer : contentRange.endContainer,
      range.compareBoundaryPoints(Range.END_TO_END, contentRange) < 0 ? range.endOffset : contentRange.endOffset,
    );
    const blockId = element.dataset.blockId;
    const block = blockId ? blocks.find((item) => item.id === blockId) : null;
    const message = block ? messages.find((item) => item.id === block.messageId) : null;
    const fullySelected = range.compareBoundaryPoints(Range.START_TO_START, contentRange) <= 0
      && range.compareBoundaryPoints(Range.END_TO_END, contentRange) >= 0;
    const preserveWholeBlock = fullySelected || element.dataset.linkOnly === "true";
    const content = preserveWholeBlock && block
      ? enrichMessageContentForCopy(block.content, message?.mentions ?? [])
      : serializeTimelineSelectionFragment(intersection.cloneContents());
    if (content) parts.push({ type: "text", content });
  }
  return parts;
}

function orderedPartsForMessages(messages: Message[], blocks: MessageBlock[]): OrderedClipboardPart[] {
  return messages.flatMap((message) => blocks
    .filter((block) => block.messageId === message.id && !isRuntimeEventBlock(block))
    .sort(compareMessageBlocks)
    .flatMap((block): OrderedClipboardPart[] => {
      if (block.type === "image" || block.type === "file") {
        const artifactId = typeof block.metadata?.artifactId === "string" ? block.metadata.artifactId : "";
        return artifactId ? [{ type: "artifact", artifactId }] : [];
      }
      const content = enrichMessageContentForCopy(block.content, message.mentions ?? []);
      return content ? [{ type: "text", content }] : [];
    }));
}

function serializeTimelineSelectionFragment(fragment: DocumentFragment) {
  const serialize = (node: Node): string => {
    if (node instanceof Text) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return [...node.childNodes].map(serialize).join("");
    const pasteMarkdown = node.dataset.composerPasteMarkdown?.trim();
    if (pasteMarkdown) return pasteMarkdown;
    if (node.tagName === "BR") return "\n";
    const content = [...node.childNodes].map(serialize).join("");
    return node.tagName === "DIV" || node.tagName === "P" ? `${content}\n` : content;
  };
  return [...fragment.childNodes].map(serialize).join("").replace(/\n+$/, "");
}

const MESSAGE_MENU_ACTIVE_ATTR = "data-menu-active";

let activeMessageMenuAnchor: HTMLElement | null = null;

function clearActiveMessageMenuAnchor() {
  if (activeMessageMenuAnchor) {
    activeMessageMenuAnchor.removeAttribute(MESSAGE_MENU_ACTIVE_ATTR);
  }
  activeMessageMenuAnchor = null;
}

function setActiveMessageMenuAnchor(anchor: HTMLElement) {
  if (activeMessageMenuAnchor && activeMessageMenuAnchor !== anchor) {
    activeMessageMenuAnchor.removeAttribute(MESSAGE_MENU_ACTIVE_ATTR);
  }
  activeMessageMenuAnchor = anchor;
  anchor.setAttribute(MESSAGE_MENU_ACTIVE_ATTR, "true");
}

function getActiveMessageMenuAnchor() {
  return activeMessageMenuAnchor;
}

export function MessageTimeline(props: {
  messages: Message[];
  allMessages: Message[];
  blocks: MessageBlock[];
  allBlocks: MessageBlock[];
  artifacts: Artifact[];
  allArtifacts: Artifact[];
  agentRunEvents: AgentRunEvent[];
  agentRuns: AgentRun[];
  participants: Participant[];
  allParticipants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  agentForwardTargets: AgentForwardTarget[];
  conversations: Conversation[];
  rooms: Room[];
  participantsCount: number;
  focusMessageRequest: { messageId: string; artifactId?: string; seq: number } | null;
  scrollToBottomRequest: { seq: number } | null;
  bulkToolbarHost?: HTMLElement | null;
  onSelectionModeChange?: (active: boolean) => void;
  onOpenMembers: (options?: { startAdding?: boolean }) => void;
  onOpenAgentProfile: (participant: Participant) => void;
  onMentionParticipant: (participant: Participant) => void;
  onOpenMessageLink: (messageId: string) => void;
  onOpenSummaryLink: (taskId: string) => void;
  onInsertSummaryLink?: (taskId: string) => void;
  onEnsureSummaryTask: (taskId: string) => Promise<BackgroundTask | null>;
  summaryTasks: BackgroundTask[];
  onQuoteMessages: (messages: Message[], mode?: "quote" | "summary" | "send-to-app" | "send-to-agent") => void;
  onForwardMessagesToAgent: (messages: Message[], provider: TuttiAgentGuiProvider) => void | Promise<void>;
  onForwardSummaryToAgent: (task: BackgroundTask, provider: TuttiAgentGuiProvider) => void | Promise<void>;
  onStartSummary: (messages: Message[], participant: Participant) => void | Promise<void>;
  openBackgroundTask: BackgroundTask | null;
  onCloseBackgroundTaskPanel: () => void;
  onFocusMessage: (messageId: string) => void;
  onEditMessage: (message: Message) => void;
  onDeleteMessage: (message: Message) => Promise<unknown>;
  onDeleteMessages?: (messages: Message[]) => Promise<unknown>;
  onRecallMessage: (message: Message) => Promise<unknown>;
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl" | "displayName">;
  onOpenUserProfile: (anchor: HTMLElement) => void;
  onViewThinking: (message: Message) => void;
  onRegisterScrollPreserver?: (preserver: { capture: () => void } | null) => void;
}) {
  useTranslation();
  const scrollRef = useRef<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const copyTipTimerRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const preserveTimelineScrollRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const [detailReplyMessageId, setDetailReplyMessageId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [openMessageMenu, setOpenMessageMenu] = useState<{ messageId: string } | null>(null);
  const [hoveredActionMessageId, setHoveredActionMessageId] = useState<string | null>(null);
  const hideActionTimerRef = useRef<number | null>(null);

  const closeOpenMessageMenu = useCallback(() => {
    clearActiveMessageMenuAnchor();
    setOpenMessageMenu(null);
  }, []);

  const showActionsForMessage = useCallback((messageId: string) => {
    if (openMessageMenu && openMessageMenu.messageId !== messageId) return;
    if (hideActionTimerRef.current) {
      window.clearTimeout(hideActionTimerRef.current);
      hideActionTimerRef.current = null;
    }
    setHoveredActionMessageId(messageId);
  }, [openMessageMenu]);

  const hideActionsForMessage = useCallback((messageId: string) => {
    if (openMessageMenu?.messageId === messageId) return;
    if (hideActionTimerRef.current) window.clearTimeout(hideActionTimerRef.current);
    hideActionTimerRef.current = window.setTimeout(() => {
      setHoveredActionMessageId((current) => (current === messageId ? null : current));
      hideActionTimerRef.current = null;
    }, 140);
  }, [openMessageMenu]);
  const [copyTipPosition, setCopyTipPosition] = useState<CopyTipPosition | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [summaryAgentPickerMessages, setSummaryAgentPickerMessages] = useState<Message[] | null>(null);
  const visibleMessages = useMemo(
    () => props.messages.filter(shouldShowMessage),
    [props.messages],
  );
  const messagesById = useMemo(
    () => new Map(props.messages.map((message) => [message.id, message])),
    [props.messages],
  );
  const messageIndexesById = useMemo(
    () => new Map(props.messages.map((message, index) => [message.id, index])),
    [props.messages],
  );
  const referencedMessagesById = useMemo(() => {
    const referencedById = new Map<string, Message>();
    for (const message of visibleMessages) {
      const referenced = resolveReferencedMessage(
        message,
        props.messages,
        props.allParticipants,
        props.identities,
        messagesById,
        messageIndexesById,
      );
      if (referenced) referencedById.set(message.id, referenced);
    }
    return referencedById;
  }, [messageIndexesById, messagesById, props.allParticipants, props.identities, props.messages, visibleMessages]);
  const blocksByMessageId = useMemo(
    () => groupMessageBlocksByMessageId(props.blocks),
    [props.blocks],
  );
  const artifactsById = useMemo(
    () => new Map(props.artifacts.map((artifact) => [artifact.id, artifact])),
    [props.artifacts],
  );
  const messageGroupLayout = useMemo(
    () => buildMessageGroupLayout(visibleMessages, props.messages),
    [visibleMessages, props.messages],
  );
  const selectedMessages = useMemo(
    () => visibleMessages.filter(
      (message) => selectedMessageIds.has(message.id) && !isRemovedMessage(message),
    ),
    [selectedMessageIds, visibleMessages],
  );
  const detailReplyMessage = useMemo(
    () => detailReplyMessageId ? messagesById.get(detailReplyMessageId) ?? null : null,
    [detailReplyMessageId, messagesById],
  );
  const detailMessages = useMemo(
    () => detailReplyMessage
      ? buildReferencedThread(
          detailReplyMessage,
          props.messages,
          props.allParticipants,
          props.identities,
          messagesById,
          messageIndexesById,
        )
      : [],
    [detailReplyMessage, messageIndexesById, messagesById, props.allParticipants, props.identities, props.messages],
  );
  const summaryTaskIds = useMemo(
    () => collectSummaryTaskIds(props.messages, props.blocks),
    [props.blocks, props.messages],
  );

  const captureTimelineScroll = useCallback(() => {
    if (scrollRef.current) {
      pendingScrollTopRef.current = scrollRef.current.scrollTop;
      preserveTimelineScrollRef.current = true;
    }
  }, []);

  useEffect(() => {
    props.onRegisterScrollPreserver?.({ capture: captureTimelineScroll });
    return () => props.onRegisterScrollPreserver?.(null);
  }, [props.onRegisterScrollPreserver, captureTimelineScroll]);

  useLayoutEffect(() => {
    if (pendingScrollTopRef.current === null || !scrollRef.current) return;
    restoreTimelineScroll(scrollRef.current, pendingScrollTopRef.current);
    pendingScrollTopRef.current = null;
  });

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
    for (const taskId of summaryTaskIds) {
      if (props.summaryTasks.some((task) => task.id === taskId)) continue;
      void props.onEnsureSummaryTask(taskId);
    }
  }, [props.onEnsureSummaryTask, props.summaryTasks, summaryTaskIds]);
  const summaryImages = useMemo(() => {
    if (!props.openBackgroundTask) return [];
    const messageIds = props.openBackgroundTask.sourceMessageIds.length
      ? props.openBackgroundTask.sourceMessageIds
      : props.openBackgroundTask.sourceMessageId
        ? [props.openBackgroundTask.sourceMessageId]
        : [];
    return imageArtifactsForMessages(messageIds, blocksByMessageId, artifactsById);
  }, [artifactsById, blocksByMessageId, props.openBackgroundTask]);
  const summarySourceMessages = useMemo(
    () => props.openBackgroundTask
      ? resolveSourceMessages(props.openBackgroundTask, props.allMessages)
      : [],
    [props.allMessages, props.openBackgroundTask],
  );
  const updateJumpToBottomVisibility = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
    setShowJumpToBottom(distanceFromBottom > element.clientHeight);
  };

  const scrollToBottomInstant = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    stickToBottomRef.current = true;
    container.scrollTop = container.scrollHeight;
    setShowJumpToBottom(false);
  }, []);

  useLayoutEffect(() => {
    if (selectionMode) return;
    if (preserveTimelineScrollRef.current) {
      preserveTimelineScrollRef.current = false;
      return;
    }
    if (!stickToBottomRef.current) return;
    scrollToBottomInstant();
  }, [props.messages, props.blocks, selectionMode, scrollToBottomInstant]);

  useLayoutEffect(() => {
    if (!props.scrollToBottomRequest) return;
    scrollToBottomInstant();
  }, [props.scrollToBottomRequest, scrollToBottomInstant]);

  useEffect(() => {
    updateJumpToBottomVisibility();
  }, [props.messages, props.blocks]);

  useEffect(() => {
    if (!props.focusMessageRequest) return;
    window.requestAnimationFrame(() =>
      scrollToMessage(props.focusMessageRequest!.messageId, props.focusMessageRequest!.artifactId),
    );
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

  const handleOpenArtifact = (artifact: Artifact) => {
    revealArtifactInTuttiFileManager(artifact);
  };

  const toggleSelectedMessage = (messageId: string) => {
    const message = visibleMessages.find((item) => item.id === messageId);
    if (message && isRemovedMessage(message)) return;
    captureTimelineScroll();
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
    if (isRemovedMessage(message)) return;
    captureTimelineScroll();
    setSelectionMode(true);
    setSelectedMessageIds(new Set([message.id]));
    closeOpenMessageMenu();
    props.onSelectionModeChange?.(true);
  };

  const exitSelectionMode = () => {
    captureTimelineScroll();
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
    props.onSelectionModeChange?.(false);
  };

  const copyMessages = async (
    messages: Message[],
    position: CopyTipPosition,
    anchorEl?: HTMLElement | null,
  ) => {
    const visibleMessages = messages.filter((message) => message.status !== "deleted" && message.status !== "recalled");
    const scope = resolveCopyScopeFromAnchor(anchorEl ?? null);
    const visibleMessageIds = new Set(visibleMessages.map((message) => message.id));

    if (scope.kind === "artifact") {
      const artifact = props.artifacts.find((item) => item.id === scope.artifactId);
      if (!artifact || (artifact.messageId && !visibleMessageIds.has(artifact.messageId))) {
        showCopyTip(position);
        return;
      }
      await copyMessagesToClipboard({
        text: "",
        artifactIds: [artifact.id],
        includeText: false,
      });
      showCopyTip(position);
      return;
    }

    if (scope.kind === "text-block") {
      const block = props.blocks.find(
        (item) => item.id === scope.blockId && visibleMessageIds.has(item.messageId),
      );
      const blockMessage = block ? visibleMessages.find((message) => message.id === block.messageId) ?? null : null;
      const blockText = block ? enrichMessageContentForCopy(block.content.trim(), blockMessage?.mentions ?? []) : "";
      const messageArtifacts = collectImageFileArtifactsForMessages(visibleMessages, props.blocks, props.artifacts);
      if (!hasMeaningfulMessageCopyText(blockText) && messageArtifacts.length === 1) {
        await copyMessagesToClipboard({
          text: "",
          artifactIds: [messageArtifacts[0]!.id],
          includeText: false,
        });
        showCopyTip(position);
        return;
      }
      await copyMessagesToClipboard({
        text: blockText,
        artifactIds: [],
        includeText: true,
      });
      showCopyTip(position);
      return;
    }

    const text = visibleMessages
      .map((message) => enrichMessageContentForCopy(message.content.trim() || attachmentLabel(), message.mentions ?? []).trim() || attachmentLabel())
      .join("\n");
    const artifacts = collectImageFileArtifactsForMessages(visibleMessages, props.blocks, props.artifacts);
    if (!hasMeaningfulMessageCopyText(text) && artifacts.length === 1) {
      await copyMessagesToClipboard({
        text: "",
        artifactIds: [artifacts[0]!.id],
        includeText: false,
      });
      showCopyTip(position);
      return;
    }
    await copyMessagesToClipboard({
      text,
      artifactIds: artifacts.map((artifact) => artifact.id),
      includeText: true,
      parts: orderedPartsForMessages(visibleMessages, props.blocks),
    });
    showCopyTip(position);
  };

  const copyMessagesFromNativeSelection = (event: globalThis.ClipboardEvent) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const container = scrollRef.current;
    if (!container) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    if (!selectionIntersectsTimelineCopyContent(range, container)) return;

    const selectedText = selectedTextFromTimelineRange(range, container);
    const artifactIds = selectedArtifactIdsFromTimelineRange(range, container);
    const parts = selectedOrderedPartsFromTimelineRange(range, container, props.blocks, props.allMessages);
    if (!selectedText && artifactIds.length === 0) return;

    copyMessagesToClipboardEvent(event, {
      text: selectedText,
      artifactIds,
      includeText: Boolean(selectedText),
      parts,
    });
  };

  useEffect(() => {
    const handleCopy = (event: globalThis.ClipboardEvent) => {
      copyMessagesFromNativeSelection(event);
    };
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  });

  useEffect(() => {
    const syncArtifactSelectionHighlight = () => {
      const container = scrollRef.current;
      if (!container) return;
      const selection = window.getSelection();
      const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      const isTimelineSelection = Boolean(
        range
        && container.contains(range.commonAncestorContainer)
        && selectionIntersectsTimelineCopyContent(range, container),
      );
      for (const artifactBlock of container.querySelectorAll<HTMLElement>(
        '[data-slot="artifact-block"][data-artifact-id]',
      )) {
        artifactBlock.toggleAttribute(
          "data-copy-selected",
          Boolean(range && isTimelineSelection && selectionIntersectsNode(range, artifactBlock)),
        );
      }
    };
    document.addEventListener("selectionchange", syncArtifactSelectionHighlight);
    return () => {
      document.removeEventListener("selectionchange", syncArtifactSelectionHighlight);
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-copy-selected]")
        .forEach((element) => element.removeAttribute("data-copy-selected"));
    };
  }, []);

  const copyMessageLink = async (messageIds: string | string[], position: CopyTipPosition) => {
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
    await copyTextToClipboard(formatMessageLink(...ids));
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
    try {
      if (props.onDeleteMessages) {
        await props.onDeleteMessages(selectedMessages);
      } else {
        await Promise.all(selectedMessages.map((message) => props.onDeleteMessage(message)));
      }
      exitSelectionMode();
    } catch {
      // cancelled
    }
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

  const scrollToBottom = () => {
    scrollToBottomInstant();
  };

  const scrollToMessage = (messageId: string, artifactId?: string) => {
    const container = scrollRef.current;
    const target = container?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!(container instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    const scrollTarget = artifactId
      ? (target.querySelector(`[data-artifact-id="${CSS.escape(artifactId)}"]`) as HTMLElement | null) ?? target
      : target;
    const containerRect = container.getBoundingClientRect();
    const targetRect = scrollTarget.getBoundingClientRect();
    const nextScrollTop =
      container.scrollTop +
      (targetRect.top - containerRect.top) -
      (container.clientHeight - targetRect.height) / 2;
    container.scrollTop = Math.max(0, nextScrollTop);
    scrollTarget.dataset.flash = "true";
    if (scrollTarget !== target) {
      target.dataset.flash = "true";
      window.setTimeout(() => {
        delete target.dataset.flash;
      }, 1400);
    }
    window.setTimeout(() => {
      delete scrollTarget.dataset.flash;
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
      if (hideActionTimerRef.current) window.clearTimeout(hideActionTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyTipTimerRef.current) window.clearTimeout(copyTipTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!openMessageMenu) return;
    const container = scrollRef.current;
    if (!container) return;
    const previousOverflowY = container.style.overflowY;
    const lockedScrollTop = container.scrollTop;
    const preventTimelineScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(MESSAGE_MORE_MENU_SELECTOR)) return;
      event.preventDefault();
    };
    const restoreLockedScrollTop = () => {
      if (container.scrollTop !== lockedScrollTop) container.scrollTop = lockedScrollTop;
    };
    const handleSelectStart = () => closeOpenMessageMenu();
    container.style.overflowY = "hidden";
    container.addEventListener("wheel", preventTimelineScroll, { passive: false });
    container.addEventListener("touchmove", preventTimelineScroll, { passive: false });
    container.addEventListener("scroll", restoreLockedScrollTop);
    container.addEventListener("selectstart", handleSelectStart);
    return () => {
      container.style.overflowY = previousOverflowY;
      container.removeEventListener("wheel", preventTimelineScroll);
      container.removeEventListener("touchmove", preventTimelineScroll);
      container.removeEventListener("scroll", restoreLockedScrollTop);
      container.removeEventListener("selectstart", handleSelectStart);
    };
  }, [openMessageMenu, closeOpenMessageMenu]);

  return (
    <section
      ref={scrollRef}
      className={`[position:relative] [min-height:0] [overflow-y:auto] [background:var(--panel)] [padding:26px_18px_8px_14px] [&_article:last-of-type]:[margin-bottom:0] max-[1080px]:[padding-inline:14px_18px] max-[760px]:[padding:18px_18px_8px_14px]`}
      onScroll={updateJumpToBottomVisibility}
    >
      {visibleMessages.length === 0 ? (
        <EmptyTimelineState
          participantsCount={props.participantsCount}
          onOpenMembers={props.onOpenMembers}
        />
      ) : null}
      {visibleMessages.map((message) => {
        if (message.role === "system") {
          return <SystemNoticeRow key={message.id} message={message} />;
        }
        const groupLayout = messageGroupLayout.get(message.id) ?? { showHeader: true, isLastInGroup: true };
        return (
        <MessageRow
          key={message.id}
          message={message}
          showHeader={groupLayout.showHeader}
          isLastInGroup={groupLayout.isLastInGroup}
          quotedMessage={referencedMessagesById.get(message.id) ?? null}
          blocks={blocksByMessageId.get(message.id) ?? EMPTY_MESSAGE_BLOCKS}
          allBlocks={props.allBlocks}
          artifacts={props.allArtifacts}
          agentRunEvents={props.agentRunEvents}
          agentRuns={props.agentRuns}
          allMessages={props.allMessages}
          allParticipants={props.allParticipants}
          conversations={props.conversations}
          rooms={props.rooms}
          participant={resolveMessageAgentParticipant(message, props.participants, props.allParticipants)}
          identities={props.identities}
          runtimeProfiles={props.runtimeProfiles}
          agentForwardTargets={props.agentForwardTargets}
          userProfile={props.userProfile}
          onOpenUserProfile={props.onOpenUserProfile}
          onViewThinking={props.onViewThinking}
          onOpenAgentProfile={props.onOpenAgentProfile}
          onMentionParticipant={mentionParticipantKeepingScroll}
          onOpenArtifact={handleOpenArtifact}
          onOpenMessageLink={props.onOpenMessageLink}
          onOpenSummaryLink={props.onOpenSummaryLink}
          onEnsureSummaryTask={props.onEnsureSummaryTask}
          summaryTasks={props.summaryTasks}
          onOpenReferencedMessage={(_referencedMessage, replyMessage) => setDetailReplyMessageId(replyMessage.id)}
          selectionMode={selectionMode}
          selected={selectedMessageIds.has(message.id)}
          menuOpen={openMessageMenu?.messageId === message.id}
          actionsVisible={
            openMessageMenu?.messageId === message.id
            || (openMessageMenu === null && hoveredActionMessageId === message.id)
          }
          onShowActions={() => showActionsForMessage(message.id)}
          onHideActions={() => hideActionsForMessage(message.id)}
          onToggleSelected={() => toggleSelectedMessage(message.id)}
          onOpenMenu={(anchor) => {
            if (openMessageMenu?.messageId === message.id) {
              closeOpenMessageMenu();
              return;
            }
            setActiveMessageMenuAnchor(anchor);
            setHoveredActionMessageId(message.id);
            setOpenMessageMenu({ messageId: message.id });
          }}
          onCloseMenu={closeOpenMessageMenu}
          onQuoteMessage={() => props.onQuoteMessages([message], "quote")}
          onForwardToAgent={(provider) => props.onForwardMessagesToAgent([message], provider)}
          onSummarizeMessage={() => requestSummary([message])}
          onCopyMessage={(input) => void copyMessages([message], input.position, input.anchorEl)}
          onCopyMessageLink={(position) => void copyMessageLink(message.id, position)}
          onEditMessage={() => props.onEditMessage(message)}
          onDeleteMessage={() => props.onDeleteMessage(message)}
          onRecallMessage={() => props.onRecallMessage(message)}
          onSelectMessage={() => enterSelectionMode(message)}
        />
        );
      })}
      {selectionMode && props.bulkToolbarHost
        ? createPortal(
            <BulkMessageToolbar
              count={selectedMessages.length}
              onCopy={(input) => {
                void copyMessages(selectedMessages, input.position, input.anchorEl);
                exitSelectionMode();
              }}
              onCopyMessageLink={(position) => {
                const messageIds = selectedMessages.map((message) => message.id);
                if (!messageIds.length) return;
                void copyMessageLink(messageIds, position);
                exitSelectionMode();
              }}
              onQuote={() => {
                props.onQuoteMessages(selectedMessages, "quote");
                exitSelectionMode();
              }}
              onForwardToAgent={(provider) => {
                void props.onForwardMessagesToAgent(selectedMessages, provider);
                exitSelectionMode();
              }}
              agentForwardTargets={props.agentForwardTargets}
              onSummarize={() => {
                requestSummary(selectedMessages);
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
          aria-label={t("messageActions.jumpToLatest")}
          title={t("messageActions.jumpToLatest")}
          onClick={scrollToBottom}
        >
          <ChevronsDown size={22} />
        </button>
      ) : null}
      {detailMessages.length ? (
        <ReferencedMessagePanel
          messages={detailMessages}
          blocksByMessageId={blocksByMessageId}
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
          onOpenArtifact={handleOpenArtifact}
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
          sourceMessages={summarySourceMessages}
          blocks={props.blocks}
          artifacts={props.artifacts}
          allMessages={props.allMessages}
          allParticipants={props.allParticipants}
          identities={props.identities}
          conversations={props.conversations}
          rooms={props.rooms}
          summaryTasks={props.summaryTasks}
          runtimeProfiles={props.runtimeProfiles}
          userProfile={props.userProfile}
          onOpenArtifact={handleOpenArtifact}
          onOpenMessageLink={props.onOpenMessageLink}
          onOpenSummaryLink={props.onOpenSummaryLink}
          onEnsureSummaryTask={props.onEnsureSummaryTask}
          onOpenAgentProfile={props.onOpenAgentProfile}
          agentForwardTargets={props.agentForwardTargets}
          onForwardToAgent={(provider) => props.onForwardSummaryToAgent(props.openBackgroundTask!, provider)}
          onCopy={(position) => {
            const task = props.openBackgroundTask!;
            const sourceMessages = resolveSourceMessages(task, props.allMessages);
            void copySummaryToClipboard({
              task,
              sourceMessages,
              participants: props.allParticipants,
              images: summaryImages,
            })
              .then(() => {
                showCopyTip(position);
              })
              .catch(() => window.alert(t("app.copyFailed")));
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
          className={"[position:fixed] [z-index:80] [width:max-content] [white-space:nowrap] [border-radius:999px] [padding:7px_12px] [color:#ffffff] [background:rgb(17_24_39_/_88%)] [box-shadow:0_10px_30px_rgb(0_0_0_/_18%)] [font-size:12px] [font-weight:650] [pointer-events:none]"}
          style={{
            left: copyTipPosition.x,
            top: copyTipPosition.y - COPY_TIP_OFFSET_PX,
            transform: "translate(-50%, -100%)",
          }}
        >
          {t("common.copied")}
        </div>
      ) : null}
    </section>
  );
}

function EmptyTimelineState(props: { participantsCount: number; onOpenMembers: (options?: { startAdding?: boolean }) => void }) {
  const noAgents = props.participantsCount === 0;
  return (
    <div className={"[display:grid] [min-height:100%] [place-items:center] [padding:28px] [text-align:center]"}>
      <div className={"[display:grid] [max-width:460px] [gap:14px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:28px] [background:#ffffff99] [&_h3]:[margin:0] [&_h3]:[color:var(--text)] [&_h3]:[font-size:18px] [&_h3]:[font-weight:700] [&_p]:[margin:0] [&_p]:[color:var(--muted)] [&_p]:[font-size:13px] [&_p]:[line-height:1.6]"}>
        <h3>{noAgents ? t("timeline.emptyNoAgentsTitle") : t("timeline.emptyStartTitle")}</h3>
        <p>
          {noAgents
            ? t("timeline.emptyNoAgentsHint")
            : t("timeline.emptyStartHint")}
        </p>
        <div className={"[display:flex] [flex-wrap:wrap] [justify-content:center] [gap:8px] [&_span]:[border:1px_solid_var(--border)] [&_span]:[border-radius:999px] [&_span]:[padding:5px_10px] [&_span]:[color:var(--tag-agent-text)] [&_span]:[background:#ffffff] [&_span]:[font-size:12px]"}>
          <span>{t("timeline.suggestionAnalyze")}</span>
          <span>{t("timeline.suggestionProductPlan")}</span>
          <span>{t("timeline.suggestionDiscussAll")}</span>
        </div>
        <button
          type="button"
          className={"[justify-self:center] [height:36px] [border:0] [border-radius:6px] [padding:0_14px] [color:#ffffff] [background:var(--primary)] [font-size:13px] [font-weight:650] [&:hover]:[background:var(--accent)]"}
          onClick={() => props.onOpenMembers(noAgents ? { startAdding: true } : undefined)}
        >
          {noAgents ? t("timeline.addAgent") : t("timeline.manageAgents")}
        </button>
      </div>
    </div>
  );
}

function isRemovedMessage(message: Message) {
  return message.status === "deleted" || message.status === "recalled";
}

function resolveMessageSenderKey(message: Message, allMessages: Message[]) {
  const visibility = resolveMessageVisibility(message, allMessages);
  if (message.role === "user") return `user:${visibility}`;
  if (message.role === "system") return `system:${message.id}`;
  return `assistant:${message.senderParticipantId ?? message.senderName ?? "unknown"}:${visibility}`;
}

function shouldStartNewMessageGroup(
  previous: Message | null,
  current: Message,
  allMessages: Message[],
) {
  if (!previous) return true;
  if (previous.role === "system" || current.role === "system") return true;
  if (isRemovedMessage(previous) || isRemovedMessage(current)) return true;
  if (previous.role === "assistant" && previous.status === "error") return true;
  if (current.role === "assistant" && current.status === "error") return true;
  if (resolveMessageSenderKey(previous, allMessages) !== resolveMessageSenderKey(current, allMessages)) {
    return true;
  }
  if (current.role === "user" && isMessageGroupBreak(current.id)) return true;
  const previousTime = Date.parse(previous.createdAt);
  const currentTime = Date.parse(current.createdAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return true;
  return currentTime - previousTime > MESSAGE_GROUP_GAP_MS;
}

function buildMessageGroupLayout(visibleMessages: Message[], allMessages: Message[]) {
  const layout = new Map<string, { showHeader: boolean; isLastInGroup: boolean }>();
  let previous: Message | null = null;

  for (let index = 0; index < visibleMessages.length; index++) {
    const message = visibleMessages[index];
    if (!message) continue;
    if (message.role === "system") {
      previous = null;
      continue;
    }

    const showHeader = shouldStartNewMessageGroup(previous, message, allMessages);
    let nextConversationMessage: Message | null = null;
    for (let nextIndex = index + 1; nextIndex < visibleMessages.length; nextIndex++) {
      const candidate = visibleMessages[nextIndex];
      if (!candidate) continue;
      if (candidate.role !== "system") {
        nextConversationMessage = candidate;
        break;
      }
    }
    const isLastInGroup =
      !nextConversationMessage
      || shouldStartNewMessageGroup(message, nextConversationMessage, allMessages);

    layout.set(message.id, { showHeader, isLastInGroup });
    previous = message;
  }

  return layout;
}

function shouldShowMessage(message: Message) {
  if (message.role === "assistant" && message.status === "error") return true;
  return !(message.role === "assistant" && !message.content.trim() && (message.status === "cancelled" || message.status === "streaming"));
}

function hasVisibleConversationContent(blocks: MessageBlock[]) {
  return blocks.some((block) => {
    if (block.type === "image" || block.type === "file") return true;
    return Boolean(block.content.trim());
  });
}

function resolveAssistantFailureText(message: Message, blocks: MessageBlock[], agentRuns: AgentRun[]) {
  if (message.role !== "assistant" || message.status !== "error") return null;
  const messageText = message.content.trim();
  if (messageText) return translateAgentError(messageText);
  const run = message.runId ? agentRuns.find((item) => item.id === message.runId) ?? null : null;
  const runError = run?.error?.trim();
  if (runError) return translateAgentError(runError);
  const blockText = blocks.find((block) => block.content.trim())?.content.trim();
  return blockText || null;
}

function resolveReferencedMessage(
  message: Message,
  messages: Message[],
  participants: Participant[],
  identities: Identity[],
  messagesById?: Map<string, Message>,
  messageIndexesById?: Map<string, number>,
) {
  if (message.parentMessageId) {
    return messagesById?.get(message.parentMessageId)
      ?? messages.find((item) => item.id === message.parentMessageId)
      ?? null;
  }
  const legacyQuote = extractLeadingReplyQuote(normalizeMarkdownContent(message.content));
  if (!legacyQuote) return null;
  const messageIndex = messageIndexesById?.get(message.id) ?? messages.findIndex((item) => item.id === message.id);
  const candidates = (messageIndex === -1 ? messages : messages.slice(0, messageIndex)).filter(
    (candidate) => candidate.status !== "deleted" && candidate.status !== "recalled",
  );
  const quoteText = compactComparableText(legacyQuote.content);
  return [...candidates].reverse().find((candidate) => {
    const senderMatches = messageSenderLabel(candidate, participants, identities) === legacyQuote.sender || candidate.senderName === legacyQuote.sender;
    const candidateText = compactComparableText(candidate.content || attachmentLabel());
    return senderMatches && (candidateText.includes(quoteText) || quoteText.includes(candidateText.slice(0, 40)));
  }) ?? null;
}

function buildReferencedThread(
  replyMessage: Message,
  messages: Message[],
  participants: Participant[],
  identities: Identity[],
  messagesById?: Map<string, Message>,
  messageIndexesById?: Map<string, number>,
) {
  const chain: Message[] = [];
  const seen = new Set<string>();
  let current: Message | null = replyMessage;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = resolveReferencedMessage(current, messages, participants, identities, messagesById, messageIndexesById);
  }
  return chain;
}

function resolveWhisperFooterLabel(
  message: Message,
  isWhisper: boolean,
  allParticipants: Participant[],
): { label: string; variant: "user" | "agent" } | null {
  if (message.role === "user" && message.visibility === "whisper") {
    const mention = message.mentions.find((item) => item.mentionType === "participant" && item.participantId !== "all");
    const participant = mention?.participantId
      ? allParticipants.find((item) => item.id === mention.participantId) ?? null
      : null;
    const name = participant?.displayName?.trim() || mention?.displayNameSnapshot?.trim() || t("common.agent");
    return { label: t("timeline.whisperTo", { name }), variant: "user" };
  }
  if (message.role === "assistant" && isWhisper) {
    return { label: t("timeline.visibleToMeOnly"), variant: "agent" };
  }
  return null;
}


function shouldRenderWhisperPlainText(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return !/^#{1,6}\s/m.test(trimmed)
    && !/[*_~`]/.test(trimmed)
    && !/^\s*[-*+]\s/m.test(trimmed)
    && !/^\s*\d+\.\s/m.test(trimmed)
    && !/^\s*>/m.test(trimmed)
    && !/\[.+?\]\(.+?\)/.test(trimmed);
}

function stripLeadingMentionsFromContent(content: string, mentions: Message["mentions"]): string {
  let result = content;
  for (const mention of mentions) {
    if (mention.mentionType === "all") continue;
    const name = mention.displayNameSnapshot.trim();
    if (!name) continue;
    const pattern = new RegExp(`^@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`);
    if (pattern.test(result)) {
      result = result.replace(pattern, "");
    }
  }
  return result;
}

function WhisperMessageFooter(props: { label: string }) {
  return (
    <div
      data-slot="whisper-footer"
      className={"[display:flex] [align-items:center] [gap:4px] [padding-left:4px] [color:#8f959e] [font-size:11px] [line-height:16px]"}
    >
      <Ear size={12} strokeWidth={1.75} className={"[flex:0_0_auto]"} aria-hidden />
      <span>{props.label}</span>
    </div>
  );
}

function SystemNoticeRow(props: { message: Message }) {
  if (props.message.status === "deleted" || props.message.status === "recalled") return null;
  const text = props.message.content.trim();
  if (!text) return null;
  return (
    <div
      data-message-id={props.message.id}
      data-role="system"
      className={"[display:flex] [justify-content:center] [margin:6px_0_14px] [padding:0_20px]"}
    >
      <span className={"[inline-flex] [max-width:min(560px,_100%)] [align-items:center] [justify-content:center] [border-radius:999px] [padding:4px_12px] [color:var(--muted)] [background:#00000008] [font-size:12px] [line-height:18px] [text-align:center]"}>
        {translateSystemNotice(text)}
      </span>
    </div>
  );
}

const messageRoleContentClassName =
  "[&[data-role=assistant]:not([data-whisper=true])_[data-slot=message-block]:not([data-link-only])]:[background:#f2f3f5] "
  + "[&[data-role=assistant]:not([data-whisper=true])_[data-slot=message-block]:not([data-link-only])]:[border-radius:8px] "
  + "[&[data-role=user]:not([data-whisper=true])_[data-slot=message-block]:not([data-link-only])]:[border-color:transparent] "
  + "[&[data-role=user]:not([data-whisper=true])_[data-slot=message-block]:not([data-link-only])]:[background:#d6e9ff]";

function MessageRow(props: {
  message: Message;
  showHeader: boolean;
  isLastInGroup: boolean;
  quotedMessage: Message | null;
  blocks: MessageBlock[];
  allBlocks: MessageBlock[];
  artifacts: Artifact[];
  agentRunEvents: AgentRunEvent[];
  agentRuns: AgentRun[];
  allMessages: Message[];
  allParticipants: Participant[];
  conversations: Conversation[];
  rooms: Room[];
  participant: Participant | null;
  agentForwardTargets: AgentForwardTarget[];
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
  actionsVisible: boolean;
  onShowActions: () => void;
  onHideActions: () => void;
  onToggleSelected: () => void;
  onOpenMenu: (anchor: HTMLElement) => void;
  onCloseMenu: () => void;
  onQuoteMessage: () => void;
  onForwardToAgent: (provider: TuttiAgentGuiProvider) => void | Promise<void>;
  onSummarizeMessage: () => void;
  onCopyMessage: (input: CopyMessageInput) => void;
  onCopyMessageLink: (position: CopyTipPosition) => void;
  onEditMessage: () => void;
  onDeleteMessage: () => Promise<unknown>;
  onRecallMessage: () => Promise<unknown>;
  onSelectMessage: () => void;
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl" | "displayName">;
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  onOpenUserProfile: (anchor: HTMLElement) => void;
  onViewThinking: (message: Message) => void;
}) {
  const statusLabel = formatMessageStatus(props.message.status);
  const sortedBlocks = [...props.blocks].sort(compareMessageBlocks);
  const runtimeEventBlocks = sortedBlocks.filter(isRuntimeEventBlock);
  const conversationBlocks = sortedBlocks.filter((block) => !isRuntimeEventBlock(block) && block.type !== "reasoning");
  const failureFallbackText = resolveAssistantFailureText(props.message, sortedBlocks, props.agentRuns);
  const showFailureFallback = Boolean(failureFallbackText) && !hasVisibleConversationContent(conversationBlocks);
  const isWhisper = WHISPER_FEATURE_ENABLED && resolveMessageVisibility(props.message, props.allMessages) === "whisper";
  const whisperFooter = resolveWhisperFooterLabel(props.message, isWhisper, props.allParticipants);
  const whisperFooterBlockId = whisperFooter
    ? [...conversationBlocks].reverse().find((block) => block.type === "main_text")?.id
      ?? conversationBlocks.at(-1)?.id
      ?? null
    : null;
  const visibleConversationBlocks = (showFailureFallback
    ? conversationBlocks.filter((block) => block.content.trim())
    : conversationBlocks
  ).filter((block) => {
    if (block.type !== "main_text") return true;
    if (block.content.trim()) return true;
    return whisperFooter !== null && block.id === whisperFooterBlockId;
  });
  const isUserMessage = props.message.role === "user";
  const triggerUserMentions = props.message.role === "assistant"
    ? resolveTriggerUserMentions(props.message, props.allMessages)
    : [];
  const isRemoved = props.message.status === "deleted" || props.message.status === "recalled";
  const participantIdentity = props.participant?.identityId
    ? props.identities.find((identity) => identity.id === props.participant?.identityId) ?? null
    : null;
  const senderLabel = resolveMessageSenderLabel(
    props.message,
    props.participant,
    participantIdentity,
    props.userProfile.displayName,
  );

  const messageAvatar = isUserMessage ? (
    <button
      data-slot="message-avatar"
      data-profile-trigger="message-avatar"
      type="button"
      className={"[position:relative] [display:inline-grid] [flex:0_0_auto] [width:34px] [height:34px] [overflow:hidden] [border:0] [border-radius:999px] [padding:0] [background:transparent] [cursor:pointer] [transition:transform_0.12s_ease] [&:hover]:[transform:translateY(-1px)] [&:focus-visible]:[outline:2px_solid_var(--accent)] [&:focus-visible]:[outline-offset:2px]"}
      title={t("messageActions.viewProfile")}
      aria-label={t("messageActions.viewProfile")}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onOpenUserProfile(event.currentTarget);
      }}
    >
      <MessageSenderAvatar
        message={props.message}
        participant={props.participant}
        identity={participantIdentity}
        runtimeProfiles={props.runtimeProfiles}
        userProfile={props.userProfile}
        className={"[pointer-events:none]"}
      />
    </button>
  ) : props.participant ? (
    <button
      data-slot="message-avatar"
      type="button"
      className={"[position:relative] [display:inline-flex] [flex:0_0_auto] [align-items:center] [justify-content:center] [width:34px] [height:34px] [border:0] [padding:0] [background:transparent] [cursor:pointer] [transition:transform_0.12s_ease] [&:hover]:[transform:translateY(-1px)] [&:focus-visible]:[outline:2px_solid_var(--accent)] [&:focus-visible]:[outline-offset:2px]"}
      title={t("messageActions.viewParticipant", { name: props.participant.displayName })}
      aria-label={t("messageActions.viewAgentInfo", { name: props.participant.displayName })}
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
      className={"[display:inline-flex] [flex:0_0_auto] [width:34px] [height:34px] [align-items:center] [justify-content:center]"}
    >
      <MessageSenderAvatar
        message={props.message}
        participant={props.participant}
        identity={participantIdentity}
        runtimeProfiles={props.runtimeProfiles}
        userProfile={props.userProfile}
      />
    </div>
  );

  const messageBody = (
    <MessageBodyShell
      selectionMode={props.selectionMode}
      menuOpen={props.menuOpen}
      actionsVisible={props.actionsVisible}
      disabled={isRemoved}
      showHoverTime={!props.showHeader}
      createdAt={props.message.createdAt}
      onReply={props.onQuoteMessage}
      onCopy={props.onCopyMessage}
      agentForwardTargets={props.agentForwardTargets}
      onForwardToAgent={props.onForwardToAgent}
      onOpenMenu={props.onOpenMenu}
      onCloseMenu={props.onCloseMenu}
      onShowActions={props.onShowActions}
      onHideActions={props.onHideActions}
    >
        {props.menuOpen ? (
          <MessageMoreMenu
            message={props.message}
            selectionMode={props.selectionMode}
            onClose={props.onCloseMenu}
            onSummarize={props.onSummarizeMessage}
            onViewThinking={() => props.onViewThinking(props.message)}
            agentForwardTargets={props.agentForwardTargets}
            onForwardToAgent={props.onForwardToAgent}
            onCopyLink={props.onCopyMessageLink}
            onEdit={props.onEditMessage}
            onDelete={props.onDeleteMessage}
            onRecall={props.onRecallMessage}
            onSelect={props.onSelectMessage}
          />
        ) : null}
        {props.showHeader ? (
        <div data-slot="message-meta" className={"[user-select:none] [min-width:0] [max-width:100%] [&_span:not([data-message-status=error])]:[color:var(--muted)] [&_span[data-message-status=error]]:[color:#dc2626] [&_span]:[font-size:12px] [display:flex] [align-items:center] [gap:7px] [overflow:hidden] [min-height:20px] [margin-bottom:4px] [&_strong]:[color:var(--muted)] [&_strong]:[font-size:12px] [&_strong]:[font-weight:550]"}>
            {isUserMessage ? (
              <strong className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{senderLabel}</strong>
            ) : props.participant && props.participant.status !== "removed" ? (
                <button
                  type="button"
                  className={"group [display:inline-flex] [min-width:0] [align-items:center] [overflow:hidden] [border:0] [padding:0] [color:var(--muted)] [background:transparent] [font-size:12px] [font-weight:550] [line-height:20px] [cursor:pointer] [transition:color_0.12s_ease] hover:![color:#2563eb] focus-visible:![color:#2563eb] focus-visible:[outline:none]"}
                  title={`@${props.participant.displayName}`}
                  aria-label={t("messageActions.mentionInComposer", { name: props.participant.displayName })}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => props.onMentionParticipant(props.participant!)}
                >
                  <span className={"[display:inline-block] [max-width:0] [overflow:hidden] [opacity:0] [transition:max-width_0.12s_ease,_opacity_0.12s_ease] group-hover:[max-width:14px] group-hover:[opacity:1] group-focus-visible:[max-width:14px] group-focus-visible:[opacity:1]"}>
                    @
                  </span>
                  <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{senderLabel}</span>
                </button>
              ) : (
                <strong className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{senderLabel}</strong>
              )}
            <span className={"[flex:0_0_auto]"}>{formatMessageTime(props.message.createdAt)}</span>
            {statusLabel ? (
              <span data-message-status={props.message.status === "error" ? "error" : undefined}>{statusLabel}</span>
            ) : null}
          </div>
        ) : null}
        {isRemoved ? (
          <DeletedMessageBubble status={props.message.status} />
        ) : (
          <div data-slot="message-copy-content" className={"[user-select:text] [min-width:0]"}>
            {visibleConversationBlocks.map((block, index) => (
              <MessageBlockRenderer
                key={block.id}
                block={block}
                artifacts={props.artifacts}
                allBlocks={props.allBlocks}
                allMessages={props.allMessages}
                allParticipants={props.allParticipants}
                identities={props.identities}
                userProfile={props.userProfile}
                conversations={props.conversations}
                rooms={props.rooms}
                onOpenArtifact={props.onOpenArtifact}
                onOpenMessageLink={props.onOpenMessageLink}
                onOpenSummaryLink={props.onOpenSummaryLink}
                onEnsureSummaryTask={props.onEnsureSummaryTask}
                summaryTasks={props.summaryTasks}
                quotedMessage={index === 0 ? props.quotedMessage : null}
                onOpenReferencedMessage={(referencedMessage) => props.onOpenReferencedMessage(referencedMessage, props.message)}
                whisperFooter={whisperFooter && block.id === whisperFooterBlockId ? whisperFooter : null}
                whisperMentionsToStrip={
                  whisperFooter?.variant === "user" && block.id === whisperFooterBlockId
                    ? props.message.mentions
                    : undefined
                }
                referenceMentions={props.message.mentions}
                messageRole={props.message.role}
                triggerUserMentions={triggerUserMentions}
                onOpenAgentProfile={props.onOpenAgentProfile}
                runtimeProfiles={props.runtimeProfiles}
              />
            ))}
            {showFailureFallback && failureFallbackText ? (
              <MessageBlockRenderer
                key={`${props.message.id}-failure-fallback`}
                block={{
                  id: `${props.message.id}-failure-fallback`,
                  messageId: props.message.id,
                  type: "main_text",
                  content: failureFallbackText,
                  status: "error",
                  metadata: null,
                  sortOrder: 0,
                  createdAt: props.message.createdAt,
                  updatedAt: props.message.updatedAt,
                }}
                artifacts={props.artifacts}
                allBlocks={props.allBlocks}
                allMessages={props.allMessages}
                allParticipants={props.allParticipants}
                identities={props.identities}
                userProfile={props.userProfile}
                conversations={props.conversations}
                rooms={props.rooms}
                onOpenArtifact={props.onOpenArtifact}
                onOpenMessageLink={props.onOpenMessageLink}
                onOpenSummaryLink={props.onOpenSummaryLink}
                onEnsureSummaryTask={props.onEnsureSummaryTask}
                summaryTasks={props.summaryTasks}
                quotedMessage={visibleConversationBlocks.length === 0 ? props.quotedMessage : null}
                onOpenReferencedMessage={(referencedMessage) => props.onOpenReferencedMessage(referencedMessage, props.message)}
                onOpenAgentProfile={props.onOpenAgentProfile}
                runtimeProfiles={props.runtimeProfiles}
              />
            ) : null}
            {runtimeEventBlocks.length ? <RuntimeEventGroup blocks={runtimeEventBlocks} artifacts={props.artifacts} onOpenArtifact={props.onOpenArtifact} /> : null}
          </div>
        )}
    </MessageBodyShell>
  );

  return (
    <article
      data-message-id={props.message.id}
      data-role={props.message.role}
      data-whisper={isWhisper || undefined}
      data-failed={props.message.status === "error" || undefined}
      data-selected={props.selected || undefined}
      data-group-continuation={!props.showHeader || undefined}
      className={`group/message [position:relative] [display:grid] ${props.selectionMode ? "[grid-template-columns:22px_34px_minmax(0,_1fr)]" : "[grid-template-columns:34px_minmax(0,_1fr)]"} [gap:8px] [align-items:start] [border-radius:18px] [transition:background-color_0.2s_ease,_box-shadow_0.2s_ease] ${props.isLastInGroup ? "[margin-bottom:18px]" : "[margin-bottom:4px]"} ${props.selectionMode && !isRemoved ? "[cursor:pointer]" : ""} [&_[data-slot=message-avatar]]:[user-select:none] [&[data-selected=true]]:[background:#eaf2ff66] [&[data-flash=true]]:[background:#fef3c7] [&[data-flash=true]]:[box-shadow:0_0_0_2px_#facc15] [&[data-whisper=true]:not([data-failed=true])_[data-slot=message-block]:not([data-link-only])]:[border:1px_dashed_#d0d3d6] [&[data-whisper=true][data-failed=true]_[data-slot=message-block]:not([data-link-only])]:[border:1px_dashed_#f59e0b] [&[data-whisper=true]_[data-slot=message-block]:not([data-link-only])]:[border-radius:8px] [&[data-whisper=true][data-role=assistant]_[data-slot=message-block]:not([data-link-only])]:[background:#f8f9fb] [&[data-role=user][data-whisper=true]_[data-slot=message-block]:not([data-link-only])]:[background:#eef6ff] ${messageRoleContentClassName}`}
      onClickCapture={(event) => {
        if (!props.selectionMode || isRemoved) return;
        event.preventDefault();
        event.stopPropagation();
        props.onToggleSelected();
      }}
    >
      {props.selectionMode ? (
      <div
        data-slot="message-select"
        className={"[user-select:none] [display:flex] [height:34px] [align-items:center] [justify-content:center]"}
      >
        {!isRemoved ? (
          <label className={"[display:grid] [width:16px] [height:16px] [place-items:center] [cursor:pointer]"}>
            <input className={"[width:16px] [height:16px] [accent-color:var(--primary)]"} type="checkbox" checked={props.selected} onChange={props.onToggleSelected} aria-label={t("messageActions.selectMessage")} />
          </label>
        ) : null}
      </div>
      ) : null}
      {props.showHeader ? messageAvatar : (
        <div data-slot="message-avatar" aria-hidden="true" className={"[width:34px] [height:34px]"} />
      )}
      {messageBody}
    </article>
  );
}

function isRuntimeEventBlock(block: MessageBlock) {
  return block.type === "tool_call" || block.type === "tool_result" || block.type === "artifact" || block.type === "error";
}

const MESSAGE_ACTION_BAR_Z_INDEX = 2147483000;
const MESSAGE_MORE_MENU_Z_INDEX = MESSAGE_ACTION_BAR_Z_INDEX + 1;
const MESSAGE_MORE_MENU_BOTTOM_RESERVE_PX = 96;
const MESSAGE_MORE_MENU_MIN_WIDTH = 196;

function computeMessageMoreMenuPosition(anchorRect: DOMRect, menuHeight: number) {
  const viewportPadding = 12;
  const maxBottom = window.innerHeight - MESSAGE_MORE_MENU_BOTTOM_RESERVE_PX;
  const maxMenuHeight = Math.max(160, maxBottom - viewportPadding);
  const effectiveHeight = Math.min(menuHeight, maxMenuHeight);

  let top = anchorRect.top;
  if (top + effectiveHeight > maxBottom) {
    top = Math.max(viewportPadding, maxBottom - effectiveHeight);
  }

  let left = anchorRect.right;
  let transform: string | undefined;
  if (left + MESSAGE_MORE_MENU_MIN_WIDTH > window.innerWidth - viewportPadding) {
    left = anchorRect.left;
    transform = "translateX(-100%)";
  }

  return { top, left, transform, maxMenuHeight };
}

const MESSAGE_ACTION_BAR_BUTTON_CLASS =
  "group/icon [position:relative] [display:inline-grid] [width:24px] [height:24px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000008]";

const MESSAGE_ACTION_BAR_TOOLTIP_GAP_PX = 6;
const MESSAGE_ACTION_BAR_TOOLTIP_VIEWPORT_PADDING_PX = 8;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function ViewportActionTooltip(props: {
  anchorRef: { current: HTMLElement | null };
  visible: boolean;
  children: ReactNode;
}) {
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const [layout, setLayout] = useState<{
    arrowLeft: number;
    placement: "above" | "below";
    ready: boolean;
    style: CSSProperties;
  }>({
    arrowLeft: 0,
    placement: "above",
    ready: false,
    style: { left: -9999, top: -9999 },
  });

  const updateLayout = useCallback(() => {
    const anchor = props.anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const padding = MESSAGE_ACTION_BAR_TOOLTIP_VIEWPORT_PADDING_PX;
    const gap = MESSAGE_ACTION_BAR_TOOLTIP_GAP_PX;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const anchorCenterX = anchorRect.left + anchorRect.width / 2;
    const spaceAbove = anchorRect.top - padding;
    const spaceBelow = viewportHeight - anchorRect.bottom - padding;
    const placement = spaceAbove >= tooltipRect.height + gap || spaceAbove >= spaceBelow ? "above" : "below";
    const unclampedTop = placement === "above"
      ? anchorRect.top - tooltipRect.height - gap
      : anchorRect.bottom + gap;
    const top = clampNumber(unclampedTop, padding, Math.max(padding, viewportHeight - tooltipRect.height - padding));
    const left = clampNumber(
      anchorCenterX - tooltipRect.width / 2,
      padding,
      Math.max(padding, viewportWidth - tooltipRect.width - padding),
    );
    setLayout({
      arrowLeft: clampNumber(anchorCenterX - left, 8, Math.max(8, tooltipRect.width - 8)),
      placement,
      ready: true,
      style: { left, top, zIndex: MESSAGE_ACTION_BAR_Z_INDEX + 2 },
    });
  }, [props.anchorRef]);

  useLayoutEffect(() => {
    if (!props.visible) return;
    updateLayout();
  }, [props.children, props.visible, updateLayout]);

  useEffect(() => {
    if (!props.visible) return;
    const handleMove = () => updateLayout();
    window.addEventListener("resize", handleMove);
    window.addEventListener("scroll", handleMove, true);
    return () => {
      window.removeEventListener("resize", handleMove);
      window.removeEventListener("scroll", handleMove, true);
    };
  }, [props.visible, updateLayout]);

  if (!props.visible) return null;
  return createPortal(
    <span
      ref={tooltipRef}
      role="tooltip"
      className={"[position:fixed] [border-radius:5px] [padding:3px_6px] [color:#ffffff] [background:#1f2329] [font-size:11px] [font-weight:500] [line-height:16px] [white-space:nowrap] [pointer-events:none]"}
      style={{ ...layout.style, visibility: layout.ready ? "visible" : "hidden" }}
    >
      {props.children}
      <span
        aria-hidden
        className={`[position:absolute] [width:0] [height:0] [border-left:5px_solid_transparent] [border-right:5px_solid_transparent] ${layout.placement === "above"
          ? "[top:100%] [border-top:5px_solid_#1f2329]"
          : "[bottom:100%] [border-bottom:5px_solid_#1f2329]"}`}
        style={{ left: layout.arrowLeft, transform: "translateX(-50%)" }}
      />
    </span>,
    document.body,
  );
}

function MessageActionBar(props: {
  visible: boolean;
  menuOpen: boolean;
  position: { top: number; left: number } | null;
  onReply: () => void;
  onCopy: (position: CopyTipPosition) => void;
  agentForwardTargets: AgentForwardTarget[];
  onForwardToAgent: (provider: TuttiAgentGuiProvider) => void | Promise<void>;
  onOpenMenu: (anchor: HTMLElement) => void;
  onCloseMenu: () => void;
  onDismissActions: () => void;
}) {
  return (
    <div
      data-slot="message-actions"
      className={`[user-select:none] [position:absolute] [z-index:30] [display:flex] [align-items:center] [gap:1px] [overflow:visible] [border:1px_solid_var(--border)] [border-radius:4px] [padding:2px] [background:#fffffff2] [box-shadow:0_8px_24px_rgb(0_0_0_/_10%)] [transition:opacity_0.12s_ease] before:[content:''] before:[position:absolute] before:[top:0] before:[right:100%] before:[width:4px] before:[height:100%] before:[pointer-events:auto] ${props.visible && props.position ? "[opacity:1] [pointer-events:auto]" : "[opacity:0] [pointer-events:none]"} ${props.menuOpen ? "![opacity:1] ![pointer-events:auto]" : ""}`}
      style={{
        ...(props.position
          ? { top: props.position.top, left: props.position.left, right: "auto", transform: "none" }
          : { top: 0, left: 0, visibility: "hidden" }),
        ...(props.menuOpen ? { zIndex: MESSAGE_ACTION_BAR_Z_INDEX } : {}),
      }}
      aria-label={t("messageActions.menu")}
      onMouseEnter={(event) => event.stopPropagation()}
      onMouseLeave={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconAction title={t("common.reply")} onClick={() => {
        props.onCloseMenu();
        props.onReply();
      }}><Reply size={13} /></IconAction>
      <IconAction title={t("common.copy")} onClick={(event) => {
        props.onCloseMenu();
        props.onCopy({ x: event.clientX, y: event.clientY });
      }}><Copy size={13} /></IconAction>
      <ForwardToAgentAction
        targets={props.agentForwardTargets}
        onForward={(provider) => void props.onForwardToAgent(provider)}
        active={Boolean((props.visible || props.menuOpen) && props.position)}
        moreMenuOpen={props.menuOpen}
        onCloseMenu={props.onCloseMenu}
        onDismissActions={props.onDismissActions}
      />
      <IconAction
        title={t("common.more")}
        onClick={(event) => {
          const anchor = event.currentTarget.closest('[data-slot="message-actions"]');
          if (!(anchor instanceof HTMLElement)) return;
          if (props.menuOpen) {
            props.onCloseMenu();
            return;
          }
          props.onOpenMenu(anchor);
        }}
      >
        <MoreHorizontal size={13} />
      </IconAction>
    </div>
  );
}

function ForwardToAgentAction(props: {
  targets: AgentForwardTarget[];
  onForward: (provider: TuttiAgentGuiProvider) => void;
  active: boolean;
  moreMenuOpen: boolean;
  onCloseMenu: () => void;
  onDismissActions: () => void;
}) {
  const { anchorRef, closeMenu, open, toggleMenu } = useForwardSubmenuHover(props.onDismissActions);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  useEffect(() => {
    if (!props.active) closeMenu();
  }, [closeMenu, props.active]);

  useEffect(() => {
    if (props.moreMenuOpen) closeMenu();
  }, [closeMenu, props.moreMenuOpen]);

  return (
    <div
      ref={anchorRef}
      className={"[position:relative] [display:inline-grid]"}
    >
      <button
        type="button"
        className={MESSAGE_ACTION_BAR_BUTTON_CLASS}
        aria-label={t("messageActions.forwardTo")}
        aria-expanded={open}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        onClick={() => {
          props.onCloseMenu();
          setTooltipVisible(false);
          toggleMenu();
        }}
      >
        <SendHorizontal
          size={13}
          className={"[transition:transform_0.14s_ease]"}
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>
      <ViewportActionTooltip anchorRef={anchorRef} visible={tooltipVisible && props.active && !props.moreMenuOpen && !open}>
        {t("messageActions.forwardTo")}
      </ViewportActionTooltip>
      {open ? (
        <div
          className={"[position:absolute] [left:50%] [top:100%] [z-index:40] [transform:translateX(-50%)] before:[content:''] before:[position:absolute] before:[bottom:100%] before:[left:0] before:[right:0] before:[height:8px]"}
        >
          <AgentForwardSubmenu
            variant="inline"
            attach="below"
            targets={props.targets}
            onForward={(provider) => {
              closeMenu();
              props.onForward(provider);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MessageMoreMenu(props: {
  message: Message;
  selectionMode: boolean;
  onClose: () => void;
  onSummarize: () => void;
  onViewThinking: () => void;
  agentForwardTargets: AgentForwardTarget[];
  onForwardToAgent: (provider: TuttiAgentGuiProvider) => void | Promise<void>;
  onCopyLink: (position: CopyTipPosition) => void;
  onEdit: () => void;
  onDelete: () => Promise<unknown>;
  onRecall: () => Promise<unknown>;
  onSelect: () => void;
}) {
  const invokeCopy = useContext(MessageBodyCopyContext);
  const canRecallMessage = isLocalUserMessage(props.message);
  const isAssistant = props.message.role === "assistant";
  const isRemoved = isRemovedMessage(props.message);
  const menuRef = useRef<HTMLDivElement>(null);
  const baseMenuWidthRef = useRef<number | null>(null);

  const run = async (action: () => void | Promise<unknown>) => {
    await action();
    props.onClose();
  };

  const applyMenuPosition = useCallback(() => {
    const anchor = getActiveMessageMenuAnchor();
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.width === 0 && anchorRect.height === 0) return;

    const maxBottom = window.innerHeight - MESSAGE_MORE_MENU_BOTTOM_RESERVE_PX;
    const maxMenuHeight = Math.max(160, maxBottom - 12);
    menu.style.position = "fixed";
    menu.style.visibility = "hidden";
    menu.style.pointerEvents = "none";
    menu.style.left = "-9999px";
    menu.style.top = "0px";
    menu.style.transform = "none";
    menu.style.maxHeight = `${maxMenuHeight}px`;
    if (baseMenuWidthRef.current === null) {
      baseMenuWidthRef.current = Math.max(menu.offsetWidth, MESSAGE_MORE_MENU_MIN_WIDTH);
    }
    menu.style.width = `${baseMenuWidthRef.current}px`;
    menu.style.maxWidth = `${baseMenuWidthRef.current}px`;
    menu.style.overflowX = "hidden";
    const menuHeight = menu.offsetHeight || menu.scrollHeight || 280;
    const position = computeMessageMoreMenuPosition(anchorRect, menuHeight);

    menu.style.top = `${position.top}px`;
    menu.style.left = `${position.left}px`;
    menu.style.transform = position.transform ?? "none";
    menu.style.zIndex = String(MESSAGE_MORE_MENU_Z_INDEX);
    menu.style.maxHeight = `${position.maxMenuHeight}px`;
    menu.style.overflowY = "auto";
    menu.style.visibility = "visible";
    menu.style.pointerEvents = "auto";
  }, []);

  useLayoutEffect(() => {
    baseMenuWidthRef.current = null;
    applyMenuPosition();
  }, [applyMenuPosition, props.message.id, isAssistant]);

  useEffect(() => {
    const handleReposition = () => applyMenuPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [applyMenuPosition]);

  return createPortal(
    <div
      ref={menuRef}
      data-slot="message-more-menu"
      className={"[user-select:none] [display:grid] [min-width:196px] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:4px] [padding:6px] [background:#ffffff] [box-shadow:0_18px_46px_rgb(0_0_0_/_14%)]"}
      style={{
        position: "fixed",
        top: -9999,
        left: -9999,
        visibility: "hidden",
        pointerEvents: "none",
      }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {!isRemoved ? (
        <ForwardToAgentMenuItem
          targets={props.agentForwardTargets}
          onForward={(provider) => void run(() => props.onForwardToAgent(provider))}
          onLayoutChange={applyMenuPosition}
        />
      ) : null}
      {!isRemoved ? <MenuButton icon={<CheckSquare size={14} />} label={t("messageActions.select")} onClick={() => void run(props.onSelect)} /> : null}
      <MenuButton icon={<BrainCircuit size={14} />} label={t("messageActions.summarize")} onClick={() => void run(props.onSummarize)} />
      {isAssistant ? <MenuButton icon={<BrainCircuit size={14} />} label={t("messageActions.viewThinking")} onClick={() => void run(props.onViewThinking)} /> : null}
      {!isRemoved ? <MenuButton icon={<Copy size={14} />} label={t("common.copy")} onClick={(event) => void run(() => {
        if (!invokeCopy) return;
        invokeCopy({ position: { x: event.clientX, y: event.clientY }, menuCopy: true });
      })} /> : null}
      <MenuButton icon={<Copy size={14} />} label={t("messageActions.copyLink")} onClick={(event) => void run(() => props.onCopyLink({ x: event.clientX, y: event.clientY }))} />
      {canRecallMessage ? <MenuButton icon={<Edit3 size={14} />} label={t("messageActions.editResend")} onClick={() => void run(props.onEdit)} /> : null}
      {canRecallMessage && !props.selectionMode ? <MenuButton icon={<RotateCcw size={14} />} label={t("messageActions.recall")} danger onClick={() => void run(props.onRecall)} /> : null}
      {!props.selectionMode ? <MenuButton icon={<Trash2 size={14} />} label={t("common.delete")} danger onClick={() => void run(props.onDelete)} /> : null}
    </div>,
    document.body,
  );
}

const AGENT_FORWARD_SUBMENU_WIDTH_PX = 230;
const AGENT_FORWARD_SUBMENU_Z_INDEX = MESSAGE_MORE_MENU_Z_INDEX + 1;

function useForwardSubmenuHover(onOutsideDismiss?: () => void) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const openMenu = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);
  const toggleMenu = useCallback(() => {
    clearCloseTimer();
    setOpen((current) => !current);
  }, [clearCloseTimer]);
  const closeMenu = useCallback(() => {
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer]);
  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-agent-forward-submenu]")) return;
      closeMenu();
      onOutsideDismiss?.();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeMenu, onOutsideDismiss, open]);

  return { anchorRef, closeMenu, open, openMenu, scheduleClose, toggleMenu };
}

function measureAgentForwardSubmenuStyle(
  anchor: HTMLElement,
  placement: "above" | "right",
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 12;
  const menuWidth = AGENT_FORWARD_SUBMENU_WIDTH_PX;
  const estimatedHeight = 120;

  if (placement === "above") {
    return {
      top: Math.max(viewportPadding, rect.top - 8),
      left: Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - menuWidth - viewportPadding),
      transform: "translateY(-100%)",
    };
  }

  let left = rect.right + 6;
  if (left + menuWidth > window.innerWidth - viewportPadding) {
    left = Math.max(viewportPadding, rect.left - menuWidth - 6);
  }
  let top = rect.top;
  if (top + estimatedHeight > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, window.innerHeight - viewportPadding - estimatedHeight);
  }
  return { top, left };
}

function ForwardToAgentMenuItem(props: {
  targets: AgentForwardTarget[];
  onForward: (provider: TuttiAgentGuiProvider) => void;
  onLayoutChange?: () => void;
}) {
  const { anchorRef, closeMenu, open, toggleMenu } = useForwardSubmenuHover();

  useLayoutEffect(() => {
    if (!open) return;
    props.onLayoutChange?.();
  }, [open, props.onLayoutChange]);

  return (
    <div
      ref={anchorRef}
      className={"[min-width:0] [overflow:hidden]"}
    >
      <button
        type="button"
        className={`[display:grid] [width:100%] [min-width:0] [height:34px] [grid-template-columns:14px_max-content_14px] [align-items:center] [column-gap:8px] [border:0] [padding:0_9px] [color:var(--text)] [font-size:12px] [font-weight:650] [text-align:left] [&:hover]:[background:#00000008] ${open ? "[border-radius:8px_8px_0_0] [background:#00000006]" : "[border-radius:8px] [background:transparent]"}`}
        role="menuitem"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleMenu();
        }}
      >
        <SendHorizontal size={14} />
        <span className={"[min-width:max-content] [white-space:nowrap]"}>{t("messageActions.forwardTo")}</span>
        {open ? <ChevronDown size={14} className={"[justify-self:end] [color:var(--muted)]"} /> : <ChevronRight size={14} className={"[justify-self:end] [color:var(--muted)]"} />}
      </button>
      {open ? (
        <AgentForwardSubmenu
          variant="inline"
          targets={props.targets}
          onForward={(provider) => {
            closeMenu();
            props.onForward(provider);
          }}
        />
      ) : null}
    </div>
  );
}

function ForwardToAgentToolbarItem(props: {
  targets: AgentForwardTarget[];
  onForward: (provider: TuttiAgentGuiProvider) => void;
}) {
  const { anchorRef, closeMenu, open, toggleMenu } = useForwardSubmenuHover();
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    setMenuStyle(measureAgentForwardSubmenuStyle(anchor, "above"));
  }, [anchorRef, open]);

  return (
    <div
      ref={anchorRef}
      className={"[position:relative] [flex-shrink:0]"}
    >
      <ToolbarButton
        icon={(
          <SendHorizontal
            size={14}
            className={"[transition:transform_0.14s_ease]"}
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          />
        )}
        label={t("messageActions.forwardTo")}
        onClick={toggleMenu}
      />
      {open ? createPortal(
        <AgentForwardSubmenu
          targets={props.targets}
          onForward={(provider) => {
            closeMenu();
            props.onForward(provider);
          }}
          className={"[position:fixed] [display:grid]"}
          style={{ ...menuStyle, zIndex: AGENT_FORWARD_SUBMENU_Z_INDEX }}
        />,
        document.body,
      ) : null}
    </div>
  );
}

function AgentForwardSubmenu(props: {
  targets: AgentForwardTarget[];
  onForward: (provider: TuttiAgentGuiProvider) => void;
  variant?: "floating" | "inline";
  attach?: "below" | "inline";
  className?: string;
  style?: CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const isInline = props.variant === "inline";
  const attachBelow = props.attach === "below";
  const shellClass = isInline
    ? attachBelow
      ? "[display:grid] [gap:0] [min-width:180px] [width:max-content] [overflow:hidden] [padding:2px] [border:1px_solid_var(--border)] [border-radius:8px] [background:#ffffff] [box-shadow:0_12px_32px_rgb(0_0_0_/_12%)]"
      : "[display:grid] [gap:0] [min-width:0] [overflow:hidden] [padding:0_2px_2px] [border:0] [border-radius:0_0_8px_8px] [background:#00000006]"
    : "[min-width:230px] [gap:0] [padding:3px] [border:1px_solid_var(--border)] [border-radius:10px] [background:#ffffff] [box-shadow:0_18px_46px_rgb(0_0_0_/_14%)] [display:grid]";
  const inlineItemClass = (index: number) => [
    "[display:flex] [width:100%] [min-width:0] [height:34px] [align-items:center] [gap:8px]",
    "[border:0] [border-radius:6px] [padding:0_8px] [color:var(--text)] [background:transparent]",
    "[font-size:12px] [font-weight:650] [text-align:left]",
    "hover:[background:#00000008] disabled:[opacity:0.45] disabled:[cursor:not-allowed]",
    index > 0 ? "[border-top:1px_solid_rgb(0_0_0_/_6%)]" : "",
  ].join(" ");
  const floatingItemClass = (index: number) => [
    "[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:9px]",
    "[min-height:40px] [border:0] [border-radius:9px] [padding:5px_8px] [color:var(--text)] [background:transparent]",
    "[text-align:left] hover:[background:#f3f6fa] disabled:[opacity:0.45] disabled:[cursor:not-allowed]",
    index > 0 ? "[border-top:1px_solid_#cfd7e3]" : "",
  ].join(" ");
  return (
    <div
      className={`${shellClass} ${props.className ?? ""}`}
      data-agent-forward-submenu
      style={props.style}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      {props.targets.length ? props.targets.map((target, index) => (
        <button
          key={target.provider}
          type="button"
          className={isInline ? inlineItemClass(index) : floatingItemClass(index)}
          role="menuitem"
          disabled={!target.available}
          onClick={() => props.onForward(target.provider)}
        >
          <AgentForwardAvatar target={target} compact={isInline} />
          {isInline ? (
            <span className={"[min-width:0] [flex:1_1_auto] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
              {target.label}
            </span>
          ) : (
            <span className={"[display:grid] [min-width:0] [gap:1px]"}>
              <strong className={"[overflow:hidden] [font-size:12px] [font-weight:650] [line-height:16px] [text-overflow:ellipsis] [white-space:nowrap]"}>
                {target.label}
              </strong>
              <span className={"[overflow:hidden] [color:var(--muted)] [font-size:11px] [line-height:14px] [text-overflow:ellipsis] [white-space:nowrap]"}>
                {target.subtitle}
              </span>
            </span>
          )}
        </button>
      )) : (
        <p className={`[margin:0] [color:var(--muted)] [font-size:12px] [line-height:18px] ${isInline ? "[padding:0_9px] [height:34px] [display:flex] [align-items:center]" : "[padding:8px]"}`}>
          {t("messageActions.noTuttiAgentsAvailable")}
        </p>
      )}
    </div>
  );
}

function AgentForwardAvatar(props: { target: AgentForwardTarget; compact?: boolean }) {
  const size = props.compact ? 18 : 32;
  const radius = props.compact ? 6 : 10;
  const style = getRuntimeProviderAvatarStyle(props.target.runtimeProvider);
  if (style?.iconUrl) {
    return (
      <span
        className={"[display:grid] [overflow:hidden] [place-items:center] [flex-shrink:0] [background:#f3f4f6]"}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <img src={style.iconUrl} alt="" className={"[object-fit:cover]"} style={{ width: size, height: size }} />
      </span>
    );
  }
  return (
    <span
      className={"[display:grid] [place-items:center] [flex-shrink:0] [font-weight:750]"}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: props.compact ? 9 : 11,
        background: style?.background ?? "#374151",
        color: style?.color ?? "#ffffff",
      }}
    >
      {style?.label ?? "AI"}
    </span>
  );
}

function BulkMessageToolbar(props: {
  count: number;
  onCopy: (input: CopyMessageInput) => void;
  onCopyMessageLink: (position: CopyTipPosition) => void;
  onQuote: () => void;
  onForwardToAgent: (provider: TuttiAgentGuiProvider) => void;
  agentForwardTargets: AgentForwardTarget[];
  onSummarize: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={"[position:absolute] [inset:0] [z-index:20] [display:flex] [align-items:center] [padding:10px_16px] [background:linear-gradient(180deg,_rgb(248_250_252_/_86%),_rgb(255_255_255_/_96%))] [backdrop-filter:blur(18px)] [border-top:1px_solid_rgb(226_232_240_/_82%)] [box-shadow:0_-18px_50px_rgb(15_23_42_/_10%)] max-[760px]:[padding:8px_10px]"}
      role="toolbar"
      aria-label={t("messageActions.bulkToolbar")}
    >
      <div className={"[display:flex] [width:100%] [min-width:0] [align-items:center] [gap:10px] [overflow-x:auto] [border:1px_solid_rgb(226_232_240_/_92%)] [border-radius:22px] [padding:8px_10px_8px_12px] [background:rgb(255_255_255_/_86%)] [box-shadow:0_18px_54px_rgb(15_23_42_/_13%),_inset_0_1px_0_rgb(255_255_255_/_92%)] max-[760px]:[gap:7px] max-[760px]:[border-radius:18px] max-[760px]:[padding:7px]"}>
        <span className={"[display:inline-flex] [flex-shrink:0] [align-items:center] [gap:7px] [border:1px_solid_rgb(37_99_235_/_14%)] [border-radius:999px] [padding:7px_11px] [color:#1d4ed8] [background:#eff6ff] [font-size:13px] [font-weight:800] [letter-spacing:-0.01em] [white-space:nowrap]"}>
          <CheckSquare size={15} strokeWidth={2.2} />
          {t("messageActions.selectedCount", { count: props.count })}
        </span>
        <span className={"[display:flex] [flex-shrink:0] [align-items:center] [gap:6px] [border-left:1px_solid_rgb(226_232_240)] [padding-left:10px] max-[760px]:[padding-left:7px]"}>
          <ToolbarButton icon={<Copy size={14} />} label={t("common.copy")} onClick={(event) => props.onCopy({ position: { x: event.clientX, y: event.clientY } })} />
          <ToolbarButton icon={<FileText size={14} />} label={t("messageActions.copyLink")} onClick={(event) => props.onCopyMessageLink({ x: event.clientX, y: event.clientY })} />
          <ToolbarButton icon={<Reply size={14} />} label={t("messageActions.quote")} onClick={props.onQuote} />
        </span>
        <span className={"[display:flex] [flex-shrink:0] [align-items:center] [gap:6px] [border-left:1px_solid_rgb(226_232_240)] [padding-left:10px] max-[760px]:[padding-left:7px]"}>
          <ForwardToAgentToolbarItem targets={props.agentForwardTargets} onForward={props.onForwardToAgent} />
          <ToolbarButton icon={<BrainCircuit size={14} />} label={t("messageActions.summarize")} onClick={props.onSummarize} />
        </span>
        <span className={"[display:flex] [flex-shrink:0] [align-items:center] [gap:6px] [border-left:1px_solid_rgb(226_232_240)] [padding-left:10px] max-[760px]:[padding-left:7px]"}>
          <ToolbarButton icon={<Trash2 size={14} />} label={t("common.delete")} danger onClick={props.onDelete} />
        </span>
        <div className={"[flex:1_0_10px]"} />
        <button
          type="button"
          className={"[display:grid] [flex:0_0_auto] [width:34px] [height:34px] [place-items:center] [border:1px_solid_rgb(226_232_240)] [border-radius:999px] [color:#64748b] [background:#ffffff] [box-shadow:0_8px_20px_rgb(15_23_42_/_8%)] [transition:transform_0.12s_ease,_background_0.12s_ease,_color_0.12s_ease] hover:[transform:translateY(-1px)] hover:[color:#0f172a] hover:[background:#f8fafc] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]"}
          aria-label={t("messageActions.exitSelection")}
          title={t("messageActions.exitSelection")}
          onClick={props.onClose}
        >
          <X size={15} />
        </button>
      </div>
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
  const agents = props.participants
    .filter((participant) => participant.kind === "ai" && participant.status === "active")
    .sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      return right.sortOrder - left.sortOrder;
    });
  const preview = props.messages.length > 1
    ? t("messageActions.quotePreview", { count: props.messages.length, preview: compactInline(props.messages[0]?.content || attachmentLabel()) })
    : compactInline(props.messages[0]?.content || attachmentLabel());
  return (
    <div className={"[position:fixed] [inset:0] [z-index:90] [display:grid] [place-items:center] [padding:24px] [background:rgb(15_23_42_/_34%)]"} role="dialog" aria-modal="true" aria-label={t("messageActions.pickSummaryAgent")}>
      <div className={"[display:grid] [width:min(420px,_calc(100vw_-_40px))] [gap:12px] [border:1px_solid_var(--border)] [border-radius:18px] [padding:16px] [background:var(--panel)] [box-shadow:0_24px_70px_rgb(0_0_0_/_22%)]"}>
        <header className={"[display:grid] [grid-template-columns:minmax(0,_1fr)_30px] [align-items:center] [gap:10px]"}>
          <span className={"[display:grid] [gap:3px]"}>
            <strong className={"[font-size:15px] [font-weight:750] [color:var(--text)]"}>{t("messageActions.pickAgentTitle")}</strong>
            <small className={"[color:var(--muted)] [font-size:12px]"}>{preview}</small>
          </span>
          <button type="button" className={"[display:grid] [width:30px] [height:30px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#00000008]"} aria-label={t("common.close")} onClick={props.onClose}>
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
            <p className={"[margin:0] [color:var(--muted)] [font-size:13px]"}>{t("messageActions.noAgentsAvailable")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryPanel(props: {
  task: BackgroundTask;
  sourceMessages: Message[];
  blocks: MessageBlock[];
  artifacts: Artifact[];
  allMessages: Message[];
  allParticipants: Participant[];
  identities: Identity[];
  conversations: Conversation[];
  rooms: Room[];
  summaryTasks: BackgroundTask[];
  runtimeProfiles: RuntimeProfile[];
  userProfile: Pick<LocalUserProfile, "displayName">;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenMessageLink: (messageId: string) => void;
  onOpenSummaryLink: (taskId: string) => void;
  onEnsureSummaryTask: (taskId: string) => Promise<BackgroundTask | null>;
  onOpenAgentProfile: (participant: Participant) => void;
  agentForwardTargets: AgentForwardTarget[];
  onForwardToAgent: (provider: TuttiAgentGuiProvider) => void | Promise<void>;
  onCopy: (position: CopyTipPosition) => void;
  onBackToSource: () => void;
  onClose: () => void;
}) {
  const summaryContent = props.task.content.trim();
  const loading = props.task.status === "running";
  const isMultiSource = props.task.sourceMessageIds.length > 1;
  const sourceMentions = props.sourceMessages.flatMap((message) => message.mentions ?? []);
  const richSummaryContent = restoreSummaryReferenceLabels(summaryContent, sourceMentions);
  const referencedArtifacts = collectImageFileArtifactsForMessages(
    props.sourceMessages,
    props.blocks,
    props.artifacts,
  ).filter((artifact) => summaryContent.includes(artifact.filename));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  return (
    <div
      className={"[position:fixed] [top:56px] [right:0] [bottom:0] [left:0] [z-index:70] [display:flex] [justify-content:flex-end] [background:transparent]"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <aside className={"[display:grid] [width:min(420px,_calc(100vw_-_28px))] [grid-template-rows:auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:var(--panel)] [box-shadow:-18px_0_50px_rgb(0_0_0_/_14%)]"} aria-label={t("messageActions.summarySidebar")}>
        <header className={"[display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [align-items:center] [gap:8px] [border-bottom:1px_solid_var(--border)] [padding:14px] [background:#ffffff]"}>
          <span className={"[display:grid] [gap:2px] [min-width:0]"}>
            <strong className={"[color:var(--text)] [font-size:15px] [font-weight:750]"}>{t("messageActions.messageSummary")}</strong>
            <small className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap] [color:var(--muted)] [font-size:12px]"}>
              {isMultiSource
                ? t("messageActions.summaryByMulti", { name: props.task.participantName, count: props.task.sourceMessageIds.length })
                : t("messageActions.summaryBySingle", { name: props.task.participantName })}
            </small>
          </span>
          <button type="button" className={"[display:grid] [width:30px] [height:30px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#00000008]"} aria-label={t("messageActions.closeSummary")} onClick={props.onClose}>
            <X size={15} />
          </button>
        </header>
        <div className={"[min-height:0] [overflow:auto] [padding:14px] [display:grid] [align-content:start] [gap:12px]"}>
          <section className={"[display:grid] [gap:8px] [border:1px_solid_var(--border)] [border-radius:12px] [padding:10px] [background:#f8fafc]"}>
            <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
              <strong className={"[font-size:12px] [font-weight:750] [color:var(--muted)]"}>{t("summary.htmlSource")}</strong>
              {props.task.sourceMessageId ? (
                <button
                  type="button"
                  className={"[height:28px] [border:0] [border-radius:8px] [padding:0_10px] [color:#ffffff] [background:#111827] [font-size:12px] [font-weight:700] [white-space:nowrap]"}
                  onClick={props.onBackToSource}
                >
                  {t("messageActions.backToSource")}
                </button>
              ) : null}
            </div>
            {props.sourceMessages.length ? (
              <div className={"[display:grid] [gap:10px]"}>
                {props.sourceMessages.map((message) => (
                  <SummarySourceMessage
                    key={message.id}
                    message={message}
                    blocks={props.blocks.filter((block) => block.messageId === message.id && !isRuntimeEventBlock(block)).sort(compareMessageBlocks)}
                    artifacts={props.artifacts}
                    allMessages={props.allMessages}
                    allParticipants={props.allParticipants}
                    identities={props.identities}
                    conversations={props.conversations}
                    rooms={props.rooms}
                    summaryTasks={props.summaryTasks}
                    runtimeProfiles={props.runtimeProfiles}
                    userProfile={props.userProfile}
                    onOpenArtifact={props.onOpenArtifact}
                    onOpenMessageLink={props.onOpenMessageLink}
                    onOpenSummaryLink={props.onOpenSummaryLink}
                    onEnsureSummaryTask={props.onEnsureSummaryTask}
                    onOpenAgentProfile={props.onOpenAgentProfile}
                  />
                ))}
              </div>
            ) : (
              <p className={"[margin:0] [color:var(--text)] [font-size:13px] [line-height:1.55]"}>
                {compactInline(props.task.sourcePreview || attachmentLabel())}
              </p>
            )}
          </section>
          <section className={"[display:grid] [gap:8px]"}>
            <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
              <strong className={"[font-size:12px] [font-weight:750] [color:var(--muted)]"}>{loading ? t("messageActions.summarizing") : t("messageActions.summaryResult")}</strong>
              {!loading && summaryContent ? (
                <span className={"[display:flex] [align-items:center] [gap:6px]"}>
                  <ForwardToAgentToolbarItem
                    targets={props.agentForwardTargets}
                    onForward={(provider) => void props.onForwardToAgent(provider)}
                  />
                  <button
                    type="button"
                    className={"[height:28px] [border:0] [border-radius:8px] [padding:0_10px] [color:var(--text)] [background:#00000008] [font-size:12px] [font-weight:650]"}
                    onClick={(event) => props.onCopy({ x: event.clientX, y: event.clientY })}
                  >
                    {t("common.copy")}
                  </button>
                </span>
              ) : null}
            </div>
            <div
              data-role="assistant"
              className={`[display:grid] [min-height:160px] [align-content:start] [justify-items:start] [gap:2px] [border:1px_solid_var(--border)] [border-radius:12px] [padding:12px] [background:#ffffff] [color:var(--text)] [font-size:13px] [line-height:1.65] ${messageRoleContentClassName}`}
            >
              {props.task.status === "failed" ? (
                <p className={"[margin:0] [color:var(--danger)]"}>{props.task.error ? translateAgentError(props.task.error) : t("messageActions.summaryFailed")}</p>
              ) : summaryContent ? (
                <>
                  <MessageBlockRenderer
                    block={{
                      id: `${props.task.id}-summary-result`,
                      messageId: props.task.sourceMessageId || props.task.id,
                      type: "main_text",
                      content: richSummaryContent,
                      status: "success",
                      metadata: null,
                      sortOrder: 0,
                      createdAt: props.task.createdAt,
                      updatedAt: props.task.updatedAt,
                    }}
                    artifacts={props.artifacts}
                    allBlocks={props.blocks}
                    allMessages={props.allMessages}
                    allParticipants={props.allParticipants}
                    identities={props.identities}
                    userProfile={props.userProfile}
                    conversations={props.conversations}
                    rooms={props.rooms}
                    summaryTasks={props.summaryTasks}
                    referenceMentions={sourceMentions}
                    messageRole="assistant"
                    runtimeProfiles={props.runtimeProfiles}
                    onOpenArtifact={props.onOpenArtifact}
                    onOpenMessageLink={props.onOpenMessageLink}
                    onOpenSummaryLink={props.onOpenSummaryLink}
                    onEnsureSummaryTask={props.onEnsureSummaryTask}
                    onOpenAgentProfile={props.onOpenAgentProfile}
                  />
                  {referencedArtifacts.map((artifact, index) => (
                    <MessageBlockRenderer
                      key={artifact.id}
                      block={{
                        id: `${props.task.id}-summary-artifact-${artifact.id}`,
                        messageId: props.task.sourceMessageId || props.task.id,
                        type: artifact.mimeType.startsWith("image/") ? "image" : "file",
                        content: "",
                        status: "success",
                        metadata: { artifactId: artifact.id },
                        sortOrder: index + 1,
                        createdAt: props.task.createdAt,
                        updatedAt: props.task.updatedAt,
                      }}
                      artifacts={props.artifacts}
                      onOpenArtifact={props.onOpenArtifact}
                    />
                  ))}
                </>
              ) : (
                <p className={"[margin:0] [color:var(--muted)]"}>{t("messageActions.waitingSummary")}</p>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function restoreSummaryReferenceLabels(content: string, mentions: Message["mentions"]) {
  let result = content;
  for (const mention of mentions ?? []) {
    if (mention.mentionType !== "reference" || !mention.referenceEntityId) continue;
    const label = mention.displayNameSnapshot.trim();
    if (!label) continue;
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`\\[${escapedLabel}\\]\\((?!(?:group-chat:\\/\\/reference|mention:\\/\\/))[^\\n)]*\\)`, "g"),
      label,
    );
  }
  return result;
}

function SummarySourceMessage(props: {
  message: Message;
  blocks: MessageBlock[];
  artifacts: Artifact[];
  allMessages: Message[];
  allParticipants: Participant[];
  identities: Identity[];
  conversations: Conversation[];
  rooms: Room[];
  summaryTasks: BackgroundTask[];
  runtimeProfiles: RuntimeProfile[];
  userProfile: Pick<LocalUserProfile, "displayName">;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenMessageLink: (messageId: string) => void;
  onOpenSummaryLink: (taskId: string) => void;
  onEnsureSummaryTask: (taskId: string) => Promise<BackgroundTask | null>;
  onOpenAgentProfile: (participant: Participant) => void;
}) {
  const participant = resolveMessageAgentParticipant(props.message, props.allParticipants, props.allParticipants);
  const identity = participant?.identityId
    ? props.identities.find((item) => item.id === participant.identityId) ?? null
    : null;
  const senderLabel = resolveMessageSenderLabel(
    props.message,
    participant,
    identity,
    props.userProfile.displayName,
  );
  const blocks = props.blocks.length ? props.blocks : [{
    id: `${props.message.id}-summary-source`,
    messageId: props.message.id,
    type: "main_text" as const,
    content: props.message.content || attachmentLabel(),
    status: "success" as const,
    metadata: null,
    sortOrder: 0,
    createdAt: props.message.createdAt,
    updatedAt: props.message.updatedAt,
  }];

  return (
    <article data-role={props.message.role} className={`[min-width:0] ${messageRoleContentClassName}`}>
      <div className={"[margin-bottom:3px] [color:var(--muted)] [font-size:12px] [line-height:18px]"}>
        <strong>{senderLabel}</strong>
        <span className={"[margin-left:6px]"}>{formatMessageTime(props.message.createdAt)}</span>
      </div>
      <div className={"[display:grid] [justify-items:start] [min-width:0]"}>
        {blocks.map((block) => (
          <MessageBlockRenderer
            key={block.id}
            block={block}
            artifacts={props.artifacts}
            allBlocks={props.blocks}
            allMessages={props.allMessages}
            allParticipants={props.allParticipants}
            identities={props.identities}
            userProfile={props.userProfile}
            conversations={props.conversations}
            rooms={props.rooms}
            summaryTasks={props.summaryTasks}
            referenceMentions={props.message.mentions}
            messageRole={props.message.role}
            runtimeProfiles={props.runtimeProfiles}
            onOpenArtifact={props.onOpenArtifact}
            onOpenMessageLink={props.onOpenMessageLink}
            onOpenSummaryLink={props.onOpenSummaryLink}
            onEnsureSummaryTask={props.onEnsureSummaryTask}
            onOpenAgentProfile={props.onOpenAgentProfile}
          />
        ))}
      </div>
    </article>
  );
}

function DeletedMessageBubble(props: { status: Message["status"] }) {
  return (
    <div data-slot="message-block" className={"[width:fit-content] [max-width:100%] [border:1px_dashed_var(--border)] [border-radius:4px_6px_6px_4px] [padding:9px_12px] [color:var(--muted)] [background:#00000004] [font-size:13px] [font-style:italic]"}>
      {props.status === "recalled" ? t("messageActions.messageRecalled") : t("messageActions.messageDeleted")}
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
      title={t("messageActions.viewQuotedOriginal")}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onOpen();
      }}
    >
      <span className={"[display:block] [max-width:min(460px,_100%)] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
        {t("messageActions.replyTo", { sender: messageSenderLabel(props.message, props.participants, props.identities), content: compactInline(props.message.content || attachmentLabel()) })}
      </span>
    </button>
  );
}

function ReferencedMessagePanel(props: {
  messages: Message[];
  blocksByMessageId: Map<string, MessageBlock[]>;
  participants: Participant[];
  allParticipants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  artifacts: Artifact[];
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl" | "displayName">;
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
          <strong className={"[font-size:15px] [font-weight:760] [color:var(--text)]"}>{t("messageActions.detailPanel")}</strong>
          <button type="button" className={"[display:grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] hover:[color:var(--text)]"} aria-label={t("messageActions.closeDetail")} onClick={props.onClose}>
            <X size={15} />
          </button>
        </header>
        <div className={"[min-height:0] [overflow-y:auto] [padding:18px] [display:grid] [align-content:start] [gap:18px]"}>
          {props.messages.map((message) => (
            <DetailMessageCard
              key={message.id}
              message={message}
              blocks={props.blocksByMessageId.get(message.id) ?? EMPTY_MESSAGE_BLOCKS}
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
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl" | "displayName">;
  onBackToMessage: () => void;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const sortedBlocks = [...props.blocks].sort(compareMessageBlocks);
  const isRemoved = props.message.status === "deleted" || props.message.status === "recalled";
  const isUserMessage = props.message.role === "user";
  const participantIdentity = props.participant?.identityId
    ? props.identities.find((identity) => identity.id === props.participant?.identityId) ?? null
    : null;
  const senderLabel = resolveMessageSenderLabel(
    props.message,
    props.participant,
    participantIdentity,
    props.userProfile.displayName,
  );
  return (
    <article className={"[display:grid] [min-width:0] [overflow:hidden] [gap:10px] [border-radius:16px] [padding:16px] [background:#eef0f3]"}>
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
          <strong className={"[overflow:hidden] [font-size:13px] [font-weight:750] [color:var(--text)] [text-overflow:ellipsis] [white-space:nowrap]"}>{senderLabel}</strong>
          <small className={"[color:var(--muted)] [font-size:12px]"}>{formatMessageTime(props.message.createdAt)}</small>
        </span>
        <button
          type="button"
          className={"[height:30px] [border:0] [border-radius:9px] [padding:0_10px] [color:#ffffff] [background:#111827] [font-size:12px] [font-weight:700] [white-space:nowrap]"}
          onClick={props.onBackToMessage}
        >
          {t("messageActions.backToSource")}
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

function IconAction(props: {
  title: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={MESSAGE_ACTION_BAR_BUTTON_CLASS}
        aria-label={props.title}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        onClick={(event) => {
          setTooltipVisible(false);
          props.onClick(event);
        }}
      >
        {props.children}
      </button>
      <ViewportActionTooltip anchorRef={buttonRef} visible={tooltipVisible}>
        {props.title}
      </ViewportActionTooltip>
    </>
  );
}

function MenuButton(props: { icon: ReactNode; label: string; danger?: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className={`[display:flex] [width:100%] [min-width:0] [height:34px] [align-items:center] [gap:8px] [border:0] [border-radius:10px] [padding:0_9px] [background:transparent] [font-size:12px] [font-weight:650] [text-align:left] [&:hover]:[background:#00000008] ${props.danger ? "[color:var(--danger)]" : "[color:var(--text)]"}`} role="menuitem" onClick={props.onClick}>
      {props.icon}
      <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{props.label}</span>
    </button>
  );
}

function ToolbarButton(props: {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`[display:inline-flex] [height:34px] [align-items:center] [gap:6px] [border:1px_solid_transparent] [border-radius:999px] [padding:0_12px] [font-size:12px] [font-weight:780] [letter-spacing:-0.01em] [white-space:nowrap] [transition:transform_0.12s_ease,_box-shadow_0.12s_ease,_background_0.12s_ease,_border-color_0.12s_ease] hover:[transform:translateY(-1px)] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px] ${props.danger ? "[border-color:#fecdd3] [color:#be123c] [background:#fff1f2] hover:[background:#ffe4e6] hover:[box-shadow:0_8px_20px_rgb(190_18_60_/_14%)]" : "[color:#111827] [background:#eef2f6] hover:[border-color:#d5dde8] hover:[background:#f8fafc] hover:[box-shadow:0_8px_20px_rgb(15_23_42_/_10%)]"}`}
      onClick={props.onClick}
    >
      {props.icon ? <span className={"[display:grid] [place-items:center] [color:currentColor]"}>{props.icon}</span> : null}
      {props.label}
    </button>
  );
}

export function MessageSenderAvatar(props: {
  message: Message;
  participant: Participant | null;
  identity?: Pick<Identity, "name" | "icon" | "defaultRuntimeProfileId"> | null;
  runtimeProfiles: RuntimeProfile[];
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl" | "displayName">;
  size?: UserAvatarSize;
  className?: string;
}) {
  const size = props.size ?? 34;
  if (props.message.role === "user") {
    return (
      <UserAvatar
        size={size}
        preset={props.userProfile.avatarPreset}
        customAvatarUrl={props.userProfile.customAvatarUrl}
        className={props.className}
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
    <AgentAvatar
      title={label}
      avatar={resolvedAvatar.avatar}
      provider={resolvedAvatar.provider}
      size={avatarSize}
    />
  );
}

function compactInline(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 120);
}

function compactComparableText(content: string) {
  return compactInline(content).replace(/^>\s*(?:回复|Reply)\s+[^:：]+[:：]\s*/, "").toLowerCase();
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
    ? t("messageActions.runtimeDetailsFailed", { count: props.blocks.length, failed: failedCount })
    : t("messageActions.runtimeDetails", { count: props.blocks.length });
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

const MESSAGE_ACTION_BAR_GAP_PX = 4;
const MESSAGE_ACTION_ANCHOR_SELECTOR = '[data-message-action-anchor], [data-slot="message-block"], [data-slot="artifact-block"]';

type MessageBubbleAnchor = { top: number; left: number; width: number; height: number };

function resolveDefaultMessageActionAnchor(body: HTMLElement): HTMLElement | null {
  const anchors = body.querySelectorAll(MESSAGE_ACTION_ANCHOR_SELECTOR);
  for (let index = anchors.length - 1; index >= 0; index -= 1) {
    const candidate = anchors.item(index);
    if (candidate instanceof HTMLElement && candidate.hasAttribute("data-message-action-anchor")) {
      return candidate;
    }
  }
  for (let index = anchors.length - 1; index >= 0; index -= 1) {
    const candidate = anchors.item(index);
    if (candidate instanceof HTMLElement && candidate.dataset.slot === "artifact-block") {
      return candidate;
    }
  }
  const fallback = anchors.item(anchors.length - 1);
  return fallback instanceof HTMLElement ? fallback : null;
}

function measureMessageBubbleAnchor(body: HTMLElement, preferredAnchor?: HTMLElement | null): MessageBubbleAnchor | null {
  const anchor = preferredAnchor ?? resolveDefaultMessageActionAnchor(body);
  if (!(anchor instanceof HTMLElement)) return null;
  const bodyRect = body.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  return {
    top: anchorRect.top - bodyRect.top,
    left: anchorRect.left - bodyRect.left,
    width: anchorRect.width,
    height: anchorRect.height,
  };
}

function measureMessageActionBarPosition(anchor: MessageBubbleAnchor): { top: number; left: number } {
  return {
    top: anchor.top,
    left: anchor.left + anchor.width + MESSAGE_ACTION_BAR_GAP_PX,
  };
}

function MessageHoverTime(props: { createdAt: string; position: { top: number; left: number } | null }) {
  return (
    <time
      dateTime={props.createdAt}
      data-slot="message-hover-time"
      className={"[user-select:none] [position:absolute] [z-index:2] [white-space:nowrap] [color:var(--muted)] [font-size:12px] [line-height:20px] [opacity:0] [pointer-events:none] [transition:opacity_0.12s_ease] group-hover/message:opacity-100 group-focus-within/message:opacity-100"}
      style={
        props.position
          ? { top: props.position.top, left: props.position.left, transform: "translate(-100%, -50%)" }
          : { visibility: "hidden" }
      }
    >
      {formatMessageTime(props.createdAt)}
    </time>
  );
}

function MessageBodyShell(props: {
  selectionMode: boolean;
  menuOpen: boolean;
  actionsVisible: boolean;
  disabled?: boolean;
  showHoverTime?: boolean;
  createdAt?: string;
  onReply: () => void;
  onCopy: (input: CopyMessageInput) => void;
  agentForwardTargets: AgentForwardTarget[];
  onForwardToAgent: (provider: TuttiAgentGuiProvider) => void | Promise<void>;
  onOpenMenu: (anchor: HTMLElement) => void;
  onCloseMenu: () => void;
  onShowActions: () => void;
  onHideActions: () => void;
  children: ReactNode;
}) {
  const [actionAnchorEl, setActionAnchorEl] = useState<HTMLElement | null>(null);
  const actionAnchorElRef = useRef<HTMLElement | null>(null);
  const lastActionAnchorRef = useRef<HTMLElement | null>(null);
  const copyAnchorFromLayoutRef = useRef<HTMLElement | null>(null);
  const [bubbleAnchor, setBubbleAnchor] = useState<MessageBubbleAnchor | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rememberActionAnchor = useCallback((block: HTMLElement | null) => {
    actionAnchorElRef.current = block;
    if (block) lastActionAnchorRef.current = block;
    setActionAnchorEl(block);
  }, []);

  const syncContextCopyArtifactId = useCallback((block: HTMLElement | null) => {
    const body = bodyRef.current;
    if (!body) return;
    if (block?.dataset.slot === "artifact-block") {
      const artifactId = block.getAttribute("data-artifact-id")?.trim();
      if (artifactId) {
        body.dataset.contextCopyArtifactId = artifactId;
        return;
      }
    }
    delete body.dataset.contextCopyArtifactId;
  }, []);

  const resolveCopyAnchor = useCallback((input?: Pick<CopyMessageInput, "menuCopy">): HTMLElement | null => {
    const body = bodyRef.current;
    const layoutAnchor = copyAnchorFromLayoutRef.current;
    if (layoutAnchor instanceof HTMLElement) {
      if (layoutAnchor.dataset.slot === "artifact-block") return layoutAnchor;
      if (!input?.menuCopy) return layoutAnchor;
    }

    const hoverAnchor = actionAnchorElRef.current ?? lastActionAnchorRef.current;
    if (hoverAnchor) return hoverAnchor;

    if (input?.menuCopy && body) {
      const contextArtifactId = body.dataset.contextCopyArtifactId?.trim();
      if (contextArtifactId) {
        const contextBlock = body.querySelector(`[data-slot="artifact-block"][data-artifact-id="${contextArtifactId}"]`);
        if (contextBlock instanceof HTMLElement) return contextBlock;
      }
    }

    return body ? resolveDefaultMessageActionAnchor(body) : null;
  }, []);

  const invokeCopy = useCallback((input: CopyMessageInput) => {
    props.onCopy({
      ...input,
      anchorEl: input.anchorEl ?? resolveCopyAnchor(input),
    });
  }, [props.onCopy, resolveCopyAnchor]);

  const updateBubbleAnchor = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const anchor = actionAnchorElRef.current
      ?? actionAnchorEl
      ?? resolveDefaultMessageActionAnchor(body);
    copyAnchorFromLayoutRef.current = anchor instanceof HTMLElement ? anchor : null;
    setBubbleAnchor(measureMessageBubbleAnchor(body, anchor));
  }, [actionAnchorEl]);

  const syncActionAnchorFromTarget = useCallback((target: EventTarget | null) => {
    const block = target instanceof Element ? target.closest(MESSAGE_ACTION_ANCHOR_SELECTOR) : null;
    if (!(block instanceof HTMLElement) || !bodyRef.current?.contains(block)) return;
    if (actionAnchorElRef.current === block) return;
    rememberActionAnchor(block);
    syncContextCopyArtifactId(block);
  }, [rememberActionAnchor, syncContextCopyArtifactId]);

  const leaveMessageBody = useCallback((relatedTarget: EventTarget | null) => {
    if (relatedTarget instanceof Node) {
      if (bodyRef.current?.contains(relatedTarget)) return;
      const actionBar = bodyRef.current?.querySelector('[data-slot="message-actions"]');
      if (actionBar instanceof HTMLElement && actionBar.contains(relatedTarget)) return;
      const moreMenu = document.querySelector(MESSAGE_MORE_MENU_SELECTOR);
      if (moreMenu instanceof HTMLElement && moreMenu.contains(relatedTarget)) return;
    } else if (relatedTarget === null) {
      return;
    }
    rememberActionAnchor(null);
    props.onHideActions();
  }, [props.onHideActions, rememberActionAnchor]);

  const openMenuFromBody = useCallback(() => {
    const actions = bodyRef.current?.querySelector('[data-slot="message-actions"]');
    if (actions instanceof HTMLElement) props.onOpenMenu(actions);
  }, [props.onOpenMenu]);

  const actionBarPosition = bubbleAnchor ? measureMessageActionBarPosition(bubbleAnchor) : null;
  const hoverTimePosition = bubbleAnchor ? resolveMessageHoverTimePosition(bubbleAnchor) : null;

  useLayoutEffect(() => {
    updateBubbleAnchor();
    const body = bodyRef.current;
    if (!body) return;

    const observer = new ResizeObserver(() => updateBubbleAnchor());
    observer.observe(body);
    for (const anchor of body.querySelectorAll(MESSAGE_ACTION_ANCHOR_SELECTOR)) {
      if (anchor instanceof HTMLElement) observer.observe(anchor);
    }

    const handleReposition = () => updateBubbleAnchor();
    window.addEventListener("resize", handleReposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleReposition);
    };
  }, [updateBubbleAnchor, props.children, props.disabled, actionAnchorEl]);

  return (
    <MessageBodyCopyContext.Provider value={invokeCopy}>
    <div
      ref={bodyRef}
      data-slot="message-body"
      className={"group/body [user-select:none] [position:relative] [min-width:0] [max-width:min(760px,_70%)] [overflow:visible] max-[1080px]:[max-width:min(720px,_86%)] max-[760px]:[max-width:88%]"}
      onMouseEnter={props.onShowActions}
      onMouseLeave={(event) => leaveMessageBody(event.relatedTarget)}
      onMouseMove={(event) => syncActionAnchorFromTarget(event.target)}
      onFocusCapture={props.onShowActions}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        props.onHideActions();
      }}
      onContextMenu={(event) => {
        if (props.selectionMode || props.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        syncActionAnchorFromTarget(event.target);
        syncContextCopyArtifactId(actionAnchorElRef.current ?? lastActionAnchorRef.current);
        props.onShowActions();
        requestAnimationFrame(openMenuFromBody);
      }}
    >
      {!props.selectionMode && !props.disabled ? (
        <MessageActionBar
          visible={props.actionsVisible}
          menuOpen={props.menuOpen}
          position={actionBarPosition}
          onReply={props.onReply}
          onCopy={(position) => invokeCopy({ position })}
          agentForwardTargets={props.agentForwardTargets}
          onForwardToAgent={props.onForwardToAgent}
          onOpenMenu={props.onOpenMenu}
          onCloseMenu={props.onCloseMenu}
          onDismissActions={props.onHideActions}
        />
      ) : null}
      {props.showHoverTime && props.createdAt && !props.selectionMode && !props.disabled ? (
        <MessageHoverTime createdAt={props.createdAt} position={hoverTimePosition} />
      ) : null}
      {props.children}
    </div>
    </MessageBodyCopyContext.Provider>
  );
}

export function MessageBlockRenderer(props: {
  block: MessageBlock;
  artifacts: Artifact[];
  allBlocks?: MessageBlock[];
  allMessages?: Message[];
  allParticipants?: Participant[];
  identities?: Identity[];
  userProfile?: Pick<LocalUserProfile, "displayName">;
  conversations?: Conversation[];
  rooms?: Room[];
  summaryTasks?: BackgroundTask[];
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenMessageLink?: (messageId: string) => void;
  onOpenSummaryLink?: (taskId: string) => void;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  embeddedLinkDepth?: number;
  quotedMessage?: Message | null;
  onOpenReferencedMessage?: (message: Message) => void;
  whisperFooter?: { label: string; variant: "user" | "agent" } | null;
  whisperMentionsToStrip?: Message["mentions"];
  referenceMentions?: Message["mentions"];
  messageRole?: Message["role"];
  triggerUserMentions?: Message["mentions"];
  onOpenAgentProfile?: (participant: Participant) => void;
  runtimeProfiles?: RuntimeProfile[];
}) {
  const blockShell = (content: ReactNode) => content;

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
  const rawBodyContent = quotedContent?.body ?? content;
  const bodyContent = props.whisperMentionsToStrip?.length
    ? stripLeadingMentionsFromContent(rawBodyContent, props.whisperMentionsToStrip)
    : rawBodyContent;
  const strippedBodyContent = props.messageRole === "assistant" ? stripAssistantSkillDetails(bodyContent) : bodyContent;
  const displayBodyContent =
    props.messageRole === "assistant" && bodyContent.trim() && !strippedBodyContent
      ? "Skill invoked."
      : strippedBodyContent;
  const workspaceResourceLinks = props.messageRole === "assistant"
    ? enrichAssistantContentWithWorkspaceResourceLinks(displayBodyContent, props.triggerUserMentions ?? [])
    : { content: displayBodyContent, mentions: [] as Message["mentions"] };
  const workspaceLinkedContent = workspaceResourceLinks.content;
  const mergedReferenceMentions = [
    ...(props.referenceMentions ?? []),
    ...workspaceResourceLinks.mentions,
  ];
  const enrichedBodyContent = mergedReferenceMentions.length
    ? enrichContentWithReferenceMentions(
        enrichContentWithParticipantMentions(workspaceLinkedContent, mergedReferenceMentions),
        mergedReferenceMentions,
      )
    : workspaceLinkedContent;
  const messageLinks = extractMessageLinks(enrichedBodyContent);
  const summaryLinks = extractSummaryLinks(enrichedBodyContent);
  const canRenderEmbeddedCards = (props.embeddedLinkDepth ?? 0) < 1;
  const bodyWithoutLinks = removeEmbeddedLinks(enrichedBodyContent).trim();
  const displayContent = bodyWithoutLinks || enrichedBodyContent;
  const collapsed = displayContent.length > COLLAPSED_MESSAGE_CHAR_LIMIT;
  const isLinkOnly =
    canRenderEmbeddedCards
    && (messageLinks.length > 0 || summaryLinks.length > 0)
    && !bodyWithoutLinks
    && !props.quotedMessage
    && !quotedContent;
  const hiddenNestedLinkOnly =
    !canRenderEmbeddedCards
    && (messageLinks.length > 0 || summaryLinks.length > 0)
    && !bodyWithoutLinks;
  const hasWhisperFooter = Boolean(props.whisperFooter) && !isLinkOnly;
  const whisperPlainText = hasWhisperFooter && Boolean(bodyWithoutLinks) && shouldRenderWhisperPlainText(bodyWithoutLinks);
  return blockShell(
    <div
      data-slot="message-block"
      data-block-id={props.block.id}
      data-link-only={isLinkOnly || undefined}
      className={`message-prose [box-sizing:border-box] [width:fit-content] [min-width:0] [max-width:100%] [overflow-wrap:anywhere] [word-break:break-word] [border:0] [color:var(--text)] ${isLinkOnly ? "[display:grid] [gap:6px] [padding:0] [background:transparent] [border-radius:0]" : hasWhisperFooter ? "[display:flex] [flex-direction:column] [gap:4px] [padding:10px_12px] [border-radius:8px]" : "[padding:10px_13px] [border-radius:4px_6px_6px_4px]"} ${props.block.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${props.block.status === "error" && !hasWhisperFooter ? "[border:1px_solid_#fecaca] [color:var(--danger)] [background:#fef2f2]" : ""}`}
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
      {canRenderEmbeddedCards ? (
        <>
          {messageLinks.map((messageIdSegment) => (
            <MessageLinkCard
              key={`message-${messageIdSegment}`}
              messageIdSegment={messageIdSegment}
              messages={props.allMessages ?? []}
              blocks={props.allBlocks ?? []}
              artifacts={props.artifacts}
              participants={props.allParticipants ?? []}
              identities={props.identities ?? []}
              userProfile={props.userProfile}
              conversations={props.conversations ?? []}
              rooms={props.rooms ?? []}
              summaryTasks={props.summaryTasks ?? []}
              runtimeProfiles={props.runtimeProfiles}
              depth={props.embeddedLinkDepth ?? 0}
              onOpenArtifact={props.onOpenArtifact}
              onOpenMessageLink={props.onOpenMessageLink}
              onOpenSummaryLink={props.onOpenSummaryLink}
              onEnsureSummaryTask={props.onEnsureSummaryTask}
              onOpenAgentProfile={props.onOpenAgentProfile}
              onOpen={() => props.onOpenMessageLink?.(messageIdSegment)}
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
        </>
      ) : null}
      {collapsed ? (
        <CollapsibleMessageContent
          content={displayContent}
          mentions={mergedReferenceMentions}
          artifacts={props.artifacts}
          participants={props.allParticipants}
          onOpenAgentProfile={props.onOpenAgentProfile}
          onOpenArtifact={props.onOpenArtifact}
          runtimeProfiles={props.runtimeProfiles}
          tightSpacing={hasWhisperFooter}
        />
      ) : whisperPlainText ? (
        <span data-slot="whisper-body" className="[display:block] [min-width:0] [max-width:100%] [overflow-wrap:anywhere] [word-break:break-word] [line-height:1.35] [white-space:pre-wrap]">{bodyWithoutLinks}</span>
      ) : bodyWithoutLinks ? (
        <MessageReferenceContent
          content={bodyWithoutLinks}
          mentions={mergedReferenceMentions}
          artifacts={props.artifacts}
          participants={props.allParticipants}
          onOpenAgentProfile={props.onOpenAgentProfile}
          onOpenArtifact={props.onOpenArtifact}
          runtimeProfiles={props.runtimeProfiles}
          tightSpacing={hasWhisperFooter}
        />
      ) : canRenderEmbeddedCards && (messageLinks.length || summaryLinks.length) ? null : hiddenNestedLinkOnly ? (
        <span className={"[display:inline-flex] [max-width:100%] [align-items:center] [gap:5px] [overflow:hidden] [color:#2563eb] [font-size:13px] [font-weight:650] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {messageLinks.length ? <TuttiMessageLinkIcon /> : <BrainCircuit size={13} />}
          <span>{messageLinks.length ? t("composer.messageLink") : t("summary.title")}</span>
        </span>
      ) : (
        <MessageReferenceContent
          content={enrichedBodyContent || " "}
          mentions={mergedReferenceMentions}
          artifacts={props.artifacts}
          participants={props.allParticipants}
          onOpenAgentProfile={props.onOpenAgentProfile}
          onOpenArtifact={props.onOpenArtifact}
          runtimeProfiles={props.runtimeProfiles}
          tightSpacing={hasWhisperFooter}
        />
      )}
      {hasWhisperFooter && props.whisperFooter ? (
        <WhisperMessageFooter label={props.whisperFooter.label} />
      ) : null}
    </div>,
  );
}

function ReplyQuotePreview(props: { quotes: Array<{ sender: string; content: string }> }) {
  const firstQuote = props.quotes[0];
  if (!firstQuote) return null;
  return (
    <div className={"[display:block] [max-width:100%] [margin-bottom:8px] [border-left:3px_solid_#c6d1e3] [padding-left:10px] [color:#7b8494] [font-size:13px] [line-height:20px] [white-space:nowrap] [overflow:hidden] [text-overflow:ellipsis]"}>
      {props.quotes.length > 1
        ? t("messageActions.quotePreview", { count: props.quotes.length, preview: `${firstQuote.sender}: ${firstQuote.content}` })
        : t("messageActions.replyTo", { sender: firstQuote.sender, content: firstQuote.content })}
    </div>
  );
}

const embeddedLinkCardClassName =
  "[display:grid] [width:300px] [min-width:0] [max-width:100%] [overflow:hidden] [gap:3px] [border:1px_solid_var(--border)] [border-radius:10px] [padding:7px_9px] [color:var(--text)] [background:#ffffff] [text-align:left] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] hover:[border-color:#cbd5e1] hover:[background:#f8fafc]";

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
      data-message-action-anchor
      className={SUMMARY_LINK_CARD_CLASS}
      onClick={props.onOpen}
    >
      <span className={"[display:flex] [min-width:0] [align-items:center] [gap:5px] [overflow:hidden] [color:#2563eb] [font-size:12px] [font-weight:700] [line-height:1.3]"}>
        <BrainCircuit size={13} className={"[flex:0_0_auto]"} />
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{presentation.title}</span>
      </span>
      {presentation.meta ? (
        <span className={"[display:block] [overflow:hidden] [color:var(--muted)] [font-size:11px] [font-weight:600] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {presentation.meta}
        </span>
      ) : null}
      <span className={"[display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] [overflow:hidden] [color:var(--text)] [font-size:13px] [font-weight:500] [line-height:1.45]"}>
        {presentation.body}
      </span>
      {task ? (
        <span className={"[display:flex] [min-width:0] [align-items:center] [gap:6px] [overflow:hidden] [color:var(--muted)] [font-size:11px] [line-height:1.3]"}>
          <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{room?.title || conversation?.title || t("common.unknownConversation")}</span>
          <span className={"[flex:0_0_auto]"}>{formatMessageTime(task.updatedAt)}</span>
        </span>
      ) : null}
    </button>
  );
}

function MessageLinkCard(props: {
  messageIdSegment: string;
  messages: Message[];
  blocks: MessageBlock[];
  artifacts: Artifact[];
  participants: Participant[];
  identities: Identity[];
  userProfile?: Pick<LocalUserProfile, "displayName">;
  conversations: Conversation[];
  rooms: Room[];
  summaryTasks: BackgroundTask[];
  runtimeProfiles?: RuntimeProfile[];
  depth: number;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenMessageLink?: (messageId: string) => void;
  onOpenSummaryLink?: (taskId: string) => void;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  onOpenAgentProfile?: (participant: Participant) => void;
  onOpen: () => void;
}) {
  const messageId = primaryMessageLinkId(props.messageIdSegment);
  const messageIds = parseMessageLinkIds(props.messageIdSegment);
  const linkedMessages = messageIds
    .map((id) => props.messages.find((item) => item.id === id))
    .filter((item): item is Message => Boolean(item));
  const message = linkedMessages[0] ?? null;
  const conversation = message ? props.conversations.find((item) => item.id === message.conversationId) ?? null : null;
  const room = conversation ? props.rooms.find((item) => item.id === conversation.roomId) ?? null : null;

  const senderNames: string[] = [];
  const seenSenderKeys = new Set<string>();
  for (const msg of linkedMessages) {
    const key = msg.senderParticipantId ?? msg.senderName ?? msg.id;
    if (seenSenderKeys.has(key)) continue;
    seenSenderKeys.add(key);
    const senderLabel = messageSenderLabel(msg, props.participants, props.identities, props.userProfile?.displayName);
    if (senderLabel) senderNames.push(senderLabel);
  }
  const senderSummary = senderNames.length <= 2
    ? senderNames.join("、")
    : t("messageLink.sendersAndMore", { first: senderNames[0]!, second: senderNames[1]!, count: senderNames.length - 2 });
  const cardLabel = t("messageLink.cardLabel", { senders: truncateMiddle(senderSummary, 14), count: linkedMessages.length });

  return (
    <button
      type="button"
      data-message-action-anchor
      className={embeddedLinkCardClassName}
      role="group"
      aria-label={cardLabel}
      onClick={props.onOpen}
    >
      <span className={"[display:flex] [min-width:0] [align-items:center] [gap:5px] [overflow:hidden] [color:#2563eb] [font-size:12px] [font-weight:700] [line-height:1.3]"}>
        <TuttiMessageLinkIcon />
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{cardLabel}</span>
      </span>
      <span className={"[display:flex] [min-width:0] [align-items:center] [gap:6px] [overflow:hidden] [color:var(--muted)] [font-size:11px] [line-height:1.3]"}>
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{room?.title || conversation?.title || t("common.unknownConversation")}</span>
        {message ? <span className={"[flex:0_0_auto]"}>{formatMessageTime(message.createdAt)}</span> : null}
      </span>
    </button>
  );
}

function LinkedMessageCardBody(props: {
  message: Message | null;
  textBlocks: MessageBlock[];
  artifactBlocks: MessageBlock[];
  messages: Message[];
  blocks: MessageBlock[];
  artifacts: Artifact[];
  participants: Participant[];
  identities: Identity[];
  userProfile?: Pick<LocalUserProfile, "displayName">;
  conversations: Conversation[];
  rooms: Room[];
  summaryTasks: BackgroundTask[];
  runtimeProfiles?: RuntimeProfile[];
  depth: number;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenMessageLink?: (messageId: string) => void;
  onOpenSummaryLink?: (taskId: string) => void;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  onOpenAgentProfile?: (participant: Participant) => void;
}) {
  if (!props.message) {
    return (
      <span className={"[display:block] [overflow:hidden] [color:var(--text)] [font-size:13px] [font-weight:600] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]"}>
        {t("messageActions.messageNotInSnapshot")}
      </span>
    );
  }

  const message = props.message;
  const previewBlocks = resolveLinkedMessagePreviewBlocks(
    message,
    props.textBlocks,
    props.artifactBlocks,
    attachmentLabel(),
  );

  return (
    <span className={"[display:grid] [min-width:0] [max-width:100%] [overflow:hidden] [gap:4px] [&_[data-slot=message-block]]:[min-width:0] [&_[data-slot=message-block]]:[max-width:100%] [&_[data-slot=message-block]]:[overflow:hidden] [&_[data-slot=message-block]]:[padding:0] [&_[data-slot=message-block]]:[font-size:13px] [&_[data-slot=message-block]]:[font-weight:600]"}>
      {previewBlocks.map((block) => (
        <MessageBlockRenderer
          key={block.id}
          block={block}
          artifacts={props.artifacts}
          allBlocks={props.blocks}
          allMessages={props.messages}
          allParticipants={props.participants}
          identities={props.identities}
          userProfile={props.userProfile}
          conversations={props.conversations}
          rooms={props.rooms}
          summaryTasks={props.summaryTasks}
          onOpenArtifact={props.onOpenArtifact}
          onOpenMessageLink={props.onOpenMessageLink}
          onOpenSummaryLink={props.onOpenSummaryLink}
          onEnsureSummaryTask={props.onEnsureSummaryTask}
          referenceMentions={message.mentions}
          messageRole={message.role}
          triggerUserMentions={message.role === "assistant" ? resolveTriggerUserMentions(message, props.messages) : []}
          onOpenAgentProfile={props.onOpenAgentProfile}
          runtimeProfiles={props.runtimeProfiles}
          embeddedLinkDepth={props.depth + 1}
        />
      ))}
    </span>
  );
}

function CollapsibleMessageContent(props: {
  content: string;
  tightSpacing?: boolean;
  mentions?: Message["mentions"];
  artifacts?: Artifact[];
  participants?: Participant[];
  onOpenAgentProfile?: (participant: Participant) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
  runtimeProfiles?: RuntimeProfile[];
}) {
  const [expanded, setExpanded] = useState(false);
  const needsCollapse = props.content.length > COLLAPSED_MESSAGE_CHAR_LIMIT;
  const visibleContent =
    !needsCollapse || expanded
      ? props.content
      : `${props.content.slice(0, COLLAPSED_MESSAGE_CHAR_LIMIT)}...`;

  return (
    <div className={props.tightSpacing ? "[display:grid] [gap:4px]" : "[display:grid] [gap:6px]"}>
      <MessageReferenceContent
        content={visibleContent}
        mentions={props.mentions}
        artifacts={props.artifacts}
        participants={props.participants}
        onOpenAgentProfile={props.onOpenAgentProfile}
        onOpenArtifact={props.onOpenArtifact}
        runtimeProfiles={props.runtimeProfiles}
        tightSpacing={props.tightSpacing}
      />
      {needsCollapse ? (
        <button
          type="button"
          className={"[justify-self:start] [border:0] [padding:0] [color:#2563eb] [background:transparent] [font-size:12px] [font-weight:650] [cursor:pointer] hover:[text-decoration:underline]"}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t("common.collapse") : t("common.expand")}
        </button>
      ) : null}
    </div>
  );
}


function groupMessageBlocksByMessageId(blocks: MessageBlock[]) {
  const grouped = new Map<string, MessageBlock[]>();
  for (const block of blocks) {
    const existing = grouped.get(block.messageId);
    if (existing) {
      existing.push(block);
    } else {
      grouped.set(block.messageId, [block]);
    }
  }
  return grouped;
}

function imageArtifactsForMessages(
  messageIds: string[],
  blocksByMessageId: Map<string, MessageBlock[]>,
  artifactsById: Map<string, Artifact>,
) {
  return messageIds.flatMap((messageId) => {
    const blocks = blocksByMessageId.get(messageId) ?? EMPTY_MESSAGE_BLOCKS;
    return blocks
      .filter((block) => block.type === "image")
      .map((block) => {
        const artifactId = typeof block.metadata?.artifactId === "string" ? block.metadata.artifactId : null;
        return artifactId ? artifactsById.get(artifactId) ?? null : null;
      })
      .filter((artifact): artifact is Artifact => Boolean(artifact));
  });
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
    .map((line) => line.replace(/^>\s?/, "").match(/^(?:回复|Reply)\s+([^:：]+)[:：]\s*(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      sender: match[1]?.trim() || t("common.message"),
      content: (match[2] ?? "").replace(/\s+/g, " ").trim(),
    }));
  if (quotes.length !== quoteLines.length) return null;
  const quoteText = quoteLines
    .map((line) => line.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/^(?:回复|Reply)\s+([^:：]+)[:：]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  const body = lines.slice(bodyStartIndex + 1).join("\n").trimStart();
  return {
    sender: quotes[0]?.sender ?? t("common.message"),
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

export function ArtifactBlock(props: { artifact: Artifact; onOpen: () => void }) {
  const isImage = props.artifact.mimeType.startsWith("image/");
  const isVideo = getArtifactCategory(props.artifact) === "video";
  if (isImage) {
    return (
      <button
        type="button"
        data-slot="artifact-block"
        data-artifact-id={props.artifact.id}
        className={"[position:relative] [display:block] [width:min(180px,_100%)] [height:120px] [margin-top:6px] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:10px] [padding:0] [background:var(--panel)] [cursor:pointer] [transition:box-shadow_0.2s_ease] after:[content:''] after:[position:absolute] after:[inset:0] after:[background:transparent] after:[pointer-events:none] [&[data-copy-selected]]:[box-shadow:0_0_0_2px_#2563eb] [&[data-copy-selected]]:after:[background:rgb(37_99_235_/_22%)] [&[data-flash=true]]:[box-shadow:0_0_0_2px_#facc15]"}
        onClick={props.onOpen}
        aria-label={props.artifact.filename}
        title={t("messageActions.revealInFileManager")}
      >
        <img
          className={"[display:block] [width:100%] [height:100%] [object-fit:cover]"}
          src={props.artifact.publicUrl}
          alt={props.artifact.filename}
          data-artifact-id={props.artifact.id}
        />
      </button>
    );
  }

  if (isVideo) {
    return (
      <div
        data-slot="artifact-block"
        data-artifact-id={props.artifact.id}
        className={"[position:relative] [display:block] [width:min(320px,_100%)] [margin-top:6px] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:12px] [background:#101114] [box-shadow:0_1px_3px_rgb(0_0_0_/_8%)] [transition:box-shadow_0.12s_ease] after:[content:''] after:[position:absolute] after:[inset:0] after:[background:transparent] after:[pointer-events:none] [&[data-copy-selected]]:[box-shadow:0_0_0_2px_#2563eb] [&[data-copy-selected]]:after:[background:rgb(37_99_235_/_22%)] [&[data-flash=true]]:[box-shadow:0_0_0_2px_#facc15]"}
      >
        <video
          className={"[display:block] [width:100%] [max-height:240px] [aspect-ratio:16/9] [object-fit:contain] [background:#101114]"}
          src={props.artifact.publicUrl}
          controls
          playsInline
          preload="metadata"
          aria-label={props.artifact.filename}
          data-artifact-id={props.artifact.id}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-slot="artifact-block"
      data-artifact-id={props.artifact.id}
      className={"[display:grid] [width:min(300px,_100%)] [min-width:0] [min-height:40px] [overflow:hidden] [grid-template-columns:28px_minmax(0,_1fr)] [align-items:center] [gap:9px] [margin-top:6px] [border:1px_solid_var(--border)] [border-radius:10px] [padding:6px_10px] [color:var(--text)] [background:#ffffff] [cursor:pointer] [box-shadow:0_1px_2px_rgb(0_0_0_/_3%)] [transition:border-color_0.12s_ease,_background-color_0.12s_ease,_box-shadow_0.12s_ease] hover:[border-color:#d4d4d8] hover:[background:#fbfbfc] hover:[box-shadow:0_3px_10px_rgb(0_0_0_/_5%)] focus-visible:[outline:none] focus-visible:[border-color:var(--border-strong)] [&[data-copy-selected]]:[border-color:#2563eb] [&[data-copy-selected]]:[background:#dbeafe] [&[data-copy-selected]]:[box-shadow:0_0_0_2px_rgb(37_99_235_/_22%)] [&[data-flash=true]]:[box-shadow:0_0_0_2px_#facc15] [&[data-flash=true]]:[border-color:#facc15]"}
      onClick={props.onOpen}
      title={t("messageActions.revealInFileManager")}
    >
      <span className={"[position:relative] [display:grid] [width:28px] [height:28px] [place-items:center] [border-radius:7px] [color:#ffffff] [background:#8d96a3] [box-shadow:inset_0_0_0_1px_rgb(255_255_255_/_20%)] before:[content:''] before:[position:absolute] before:[right:0] before:[top:0] before:[width:9px] before:[height:9px] before:[clip-path:polygon(0_0,_100%_100%,_100%_0)] before:[background:#c8ced6]"}>
        <FileText size={15} strokeWidth={2.1} />
      </span>
      <span className={"[display:flex] [min-width:0] [align-items:baseline] [gap:7px] [text-align:left]"}>
        <strong className={"[min-width:0] [overflow:hidden] [color:#171717] [font-size:13px] [font-weight:650] [line-height:18px] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {props.artifact.filename}
        </strong>
        <small className={"[flex:0_0_auto] [color:#8a8f98] [font-size:12px] [font-weight:450] [line-height:16px]"}>
          {formatBytes(props.artifact.sizeBytes)}
        </small>
      </span>
    </button>
  );
}
