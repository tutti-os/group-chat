import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppWindow, AtSign, Bot, Ear, FileOutput, FileText, LayoutList, LoaderCircle, Paperclip, Send, Square, Video, X } from "lucide-react";
import type { AgentRun, Artifact, Conversation, Identity, LocalAgentProviderStatus, MentionTarget, Message, Participant, Room, RuntimeProfile, TuttiAtProviderId } from "@group-chat/shared";
import { resolveArtifactLinkedMessageId } from "@group-chat/shared";
import { cancelRun, sendMessage, updateMessage, uploadArtifact } from "../../../api/client.js";
import { getArtifactCategory, revealArtifactInTuttiFileManager, resolveArtifactPublicUrl } from "../../artifact-actions.js";
import { formatBytes, fileToBase64 } from "../../formatting.js";
import {
  formatMessageLink,
  formatMessageLinkLabel,
  formatSummaryLink,
  isArtifactOnlyClipboardPlainText,
  parseMessageLinkIds,
  primaryMessageLinkId,
  readArtifactClipboardFromDataTransfer,
  readStashedSummaryLink,
  SUMMARY_LINK_MIME,
} from "../../chat-links.js";
import { resolveArtifactsByIds } from "../../message-artifacts.js";
import type { BackgroundTask } from "../../background-tasks.js";
import { markMessageGroupBreak, MESSAGE_GROUP_IDLE_MS } from "../../message-group-breaks.js";
import { AttachmentPreviewDialog, isTextAttachment, type AttachmentPreview } from "./AttachmentPreviewDialog.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";
import { getRuntimeProviderAvatarIconUrl, getRuntimeProviderAvatarStyle, resolveAgentAvatarFromContext } from "../../identity-avatar.js";
import { WHISPER_FEATURE_ENABLED } from "../../feature-flags.js";
import { attachmentLabel, useTranslation, t } from "../../i18n/index.js";
import { dispatchAgentGuiTask, openAgentGuiProvider, resolveAgentGuiDispatchFromMentions } from "../../agent-gui-dispatch.js";
import {
  isAgentLauncherAppId,
  resolveAgentGuiProviderFromAppId,
  resolveAgentLauncherRuntimeProvider,
} from "../../agent-launcher-mentions.js";
import {
  fetchAvailableAgentLauncherAppIds,
  readCachedAvailableAgentLauncherAppIds,
  sameStringSet,
} from "../../agent-launcher-availability.js";
import { tryOpenFileInTuttiSync, buildTuttiMentionHref, isOpenableTuttiReferenceProvider } from "../../tutti-bridge.js";
import { openReferenceMentionTarget } from "../../reference-mention-open.js";
import { buildLocalAgentLauncherReference, buildLocalAgentMentionOptions, type LocalAgentMentionOption } from "../../local-agent-mention-options.js";
import {
  parseTuttiAtMentionKey,
  isTuttiAtMentionCacheReady,
  queryTuttiAtMentions,
  readCachedTuttiAtMentions,
  roomFileMentionCacheFingerprint,
  resolveMentionThumbnailUrl,
  tuttiAtMentionKey,
  type TuttiAtQueryResult,
  type TuttiAtRoomFileMeta,
} from "../../tutti-at-mentions.js";
import { serializeReferenceMentionChip } from "../../reference-mentions.js";
import { buildReferencePasteTarget, normalizeComposerPasteText, splitComposerPasteContent, type ComposerPasteContext } from "../../composer-paste-content.js";
import { createSummaryLinkChipElement } from "../../summary-link-card.js";
import { mentionTabProviders } from "../../mention-panel-tabs.js";
import { createTuttiMessageLinkIconElement, createTuttiReferenceIconElement } from "../../tutti-reference-icons.js";
import { AGENT_LAUNCHER_MENTION_ICON_CLASS, PARTICIPANT_MENTION_CLASS, REFERENCE_MENTION_CHIP_CLASS, REFERENCE_MENTION_ICON_CLASS, REFERENCE_MENTION_LABEL_CLASS, splitAgentLauncherMentionLabel } from "./reference-mention-chip.js";
import {
  MENTION_PANEL_TABS,
  mentionTabI18nKey,
  referenceProviderToMentionTab,
  type MentionPanelTab,
} from "../../mention-panel-tabs.js";

const MENTION_MENU_Z_INDEX = 90;
const COMPOSER_UPLOAD_CLIPBOARD_MIME = "application/x-agent-chat-composer-uploads";
const COMPOSER_UPLOAD_CLIPBOARD_CACHE_LIMIT = 10;
const composerUploadClipboardSnapshots = new Map<string, UploadItem[]>();

function mentionPanelCacheKey(tab: MentionPanelTab, roomId: string, roomFileFingerprint: string) {
  return tab === "files"
    ? `${tab}:${roomId}:${roomFileFingerprint}`
    : tab;
}

function tuttiAtQueryResultSignature(item: TuttiAtQueryResult) {
  return JSON.stringify({
    providerId: item.providerId,
    itemId: item.itemId,
    label: item.label,
    subtitle: item.subtitle ?? "",
    thumbnailUrl: item.thumbnailUrl ?? "",
    insert: item.insert,
    roomFile: item.roomFile ?? null,
  });
}

function sameTuttiAtQueryResults(left: TuttiAtQueryResult[], right: TuttiAtQueryResult[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => tuttiAtQueryResultSignature(item) === tuttiAtQueryResultSignature(right[index]!));
}

export function Composer(props: {
  conversation: Conversation;
  conversationId: string;
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
  onRefreshLocalAgentProviders?: () => void | Promise<void>;
  allMessages: Message[];
  allParticipants: Participant[];
  conversations: Conversation[];
  rooms: Room[];
  activeRuns: AgentRun[];
  agentRuns: AgentRun[];
  onSend: typeof sendMessage;
  onUpdateMessage: typeof updateMessage;
  onUpload: typeof uploadArtifact;
  onCancelRun: typeof cancelRun;
  mentionRequest: { participantId: string; seq: number } | null;
  focusRequest: { seq: number } | null;
  summaryTasks: BackgroundTask[];
  onOpenSummaryLink?: (taskId: string) => void;
  onOpenMessageLink?: (messageId: string) => void;
  userDisplayName: string;
  artifacts: Artifact[];
  allArtifacts: Artifact[];
  onFocusRoomFile?: (input: { messageId: string; artifactId: string }) => void;
  composerRequest:
    | { type: "insert"; seq: number; content: string }
    | { type: "insertSummaryLink"; seq: number; taskId: string }
    | { type: "quote"; seq: number; quote: ComposerQuote }
    | { type: "quotes"; seq: number; quotes: ComposerQuote[] }
    | { type: "edit"; seq: number; messageId: string; content: string; mentions: MentionTarget[] }
    | null;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMentions, setEditingMentions] = useState<MentionTarget[]>([]);
  const [quotes, setQuotes] = useState<ComposerQuote[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionMenuDismissed, setMentionMenuDismissed] = useState(false);
  const [mentionedIds, setMentionedIds] = useState<Set<string>>(new Set());
  const [mentionedAll, setMentionedAll] = useState(false);
  const [externalMentionOptions, setExternalMentionOptions] = useState<TuttiAtQueryResult[]>([]);
  const [externalMentionsLoading, setExternalMentionsLoading] = useState(false);
  const [availableAgentLauncherAppIds, setAvailableAgentLauncherAppIds] = useState<Set<string>>(
    () => readCachedAvailableAgentLauncherAppIds(),
  );
  const [activeMentionTab, setActiveMentionTab] = useState<MentionPanelTab>("members");
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [selectedUploadItemIds, setSelectedUploadItemIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const attachmentDragSelectionRef = useRef<{ pointerId: number; startX: number } | null>(null);
  const suppressEditorClickClearRef = useRef(false);
  const composerDraftsRef = useRef<Map<string, ComposerDraft>>(new Map());
  const activeDraftConversationIdRef = useRef(props.conversationId);
  const pendingFocusSeqRef = useRef(0);
  const handledMentionRequestSeqRef = useRef(0);
  const handledFocusRequestSeqRef = useRef(0);
  const handledComposerRequestSeqRef = useRef(0);
  const removedUploadIdsRef = useRef<Set<string>>(new Set());
  const uploadItemPromisesRef = useRef<Map<string, Promise<Artifact | null>>>(new Map());
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const mentionSelectionRef = useRef<Range | null>(null);
  const mentionQueryRangeRef = useRef<Range | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const mentionMenuListRef = useRef<HTMLDivElement | null>(null);
  const prefetchedMentionPanelKeysRef = useRef<Set<string>>(new Set());
  const lastActiveReferenceTabRef = useRef<MentionPanelTab | null>(null);
  const lastLocalAgentProviderRefreshAtRef = useRef(0);
  const localAgentProviderRefreshTimersRef = useRef<number[]>([]);
  const footerRef = useRef<HTMLElement | null>(null);
  const [mentionMenuStyle, setMentionMenuStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const composerCaretOffsetRef = useRef<number | null>(null);
  const lastComposerInputAtRef = useRef(Date.now());
  const composerIdleBreakPendingRef = useRef(false);
  const roomMembers = useMemo(
    () => props.participants.filter((participant) => participant.status !== "removed"),
    [props.participants],
  );
  const mentionableAgents = useMemo(
    () => roomMembers.filter((participant) => participant.kind === "ai"),
    [roomMembers],
  );
  const realRoomMembers = useMemo(
    () => roomMembers.filter((participant) => participant.kind !== "ai"),
    [roomMembers],
  );
  const allMentionableParticipants = roomMembers;
  const memberMentionOptions = useMemo(
    () => buildParticipantMentionOptions(realRoomMembers, mentionQuery, mentionedIds, mentionedAll, { includeEveryone: false }),
    [realRoomMembers, mentionQuery, mentionedIds, mentionedAll],
  );
  const groupAgentMentionOptions = useMemo(
    () => buildParticipantMentionOptions(mentionableAgents, mentionQuery, mentionedIds, mentionedAll, { includeEveryone: false }),
    [mentionableAgents, mentionQuery, mentionedIds, mentionedAll],
  );
  const localAgentMentionOptions = useMemo(
    () =>
      buildLocalAgentMentionOptions(
        props.runtimeProfiles,
        props.localAgentProviders,
        roomMembers,
        props.identities,
        mentionQuery,
        availableAgentLauncherAppIds,
      ),
    [props.runtimeProfiles, props.localAgentProviders, roomMembers, props.identities, mentionQuery, availableAgentLauncherAppIds],
  );
  const composerPasteContext = useMemo<ComposerPasteContext>(
    () => ({
      participants: roomMembers,
      runtimeProfiles: props.runtimeProfiles,
      localAgentProviders: props.localAgentProviders,
      identities: props.identities,
    }),
    [roomMembers, props.runtimeProfiles, props.localAgentProviders, props.identities],
  );
  const composerInsertLabels = useMemo(() => ({
    getMessageLabel: (messageIdSegment: string) => formatMessageLinkLabel(
      messageIdSegment,
      props.allMessages,
      props.allParticipants,
      props.identities,
      props.userDisplayName,
    ),
    getSummaryTask: (taskId: string) => props.summaryTasks.find((task) => task.id === taskId) ?? null,
  }), [props.allMessages, props.allParticipants, props.identities, props.summaryTasks, props.userDisplayName]);
  const bindEditorRef = useCallback((node: HTMLDivElement | null) => {
    editorRef.current = node;
    if (!node) return;
    if (pendingFocusSeqRef.current <= handledFocusRequestSeqRef.current) return;
    focusEditorAtEnd(node, { preventScroll: true });
    if (isComposerEditorFocused(node)) {
      handledFocusRequestSeqRef.current = pendingFocusSeqRef.current;
    }
  }, []);
  const referenceMentionOptions = useMemo<MentionOption[]>(
    () =>
      externalMentionOptions.map((item) => ({
        kind: "reference" as const,
        key: tuttiAtMentionKey(item.providerId, item.itemId),
        label: item.label,
        subtitle: item.subtitle,
        thumbnailUrl: item.thumbnailUrl,
        providerId: item.providerId,
        item,
      })),
    [externalMentionOptions],
  );
  const mentionOptionsByTab = useMemo<Record<MentionPanelTab, MentionOption[]>>(() => {
    const referencesByTab = Object.fromEntries(
      MENTION_PANEL_TABS.map((tab) => [tab, [] as MentionOption[]]),
    ) as Record<MentionPanelTab, MentionOption[]>;
    for (const option of referenceMentionOptions) {
      if (option.kind !== "reference") continue;
      const tab = referenceProviderToMentionTab(option.providerId);
      if (!tab) continue;
      if (tab === "files" && !option.item.roomFile) continue;
      referencesByTab[tab].push(option);
    }
    const allOption = memberMentionOptions.find((option) => option.kind === "all") ?? null;
    const realMemberOptions = memberMentionOptions.filter((option) => option.kind !== "all");
    return {
      members: [
        ...(allOption ? [allOption] : []),
        ...groupAgentMentionOptions,
        ...realMemberOptions,
      ],
      files: referencesByTab.files,
      sessions: referencesByTab.sessions,
      apps: referencesByTab.apps.filter((option) => option.kind !== "reference" || !isAgentLauncherAppId(option.item.itemId)),
      tasks: referencesByTab.tasks,
    };
  }, [memberMentionOptions, localAgentMentionOptions, groupAgentMentionOptions, referenceMentionOptions]);
  const mentionOptions = mentionOptionsByTab[activeMentionTab] ?? [];
  const roomArtifacts = useMemo(
    () => props.artifacts.filter((artifact) => artifact.roomId === props.conversation.roomId),
    [props.artifacts, props.conversation.roomId],
  );
  const roomFileFingerprint = useMemo(
    () => roomFileMentionCacheFingerprint(roomArtifacts, props.conversation.roomId),
    [roomArtifacts, props.conversation.roomId],
  );

  const refreshAvailableAgentLauncherApps = useCallback((options?: { force?: boolean }) => {
    void fetchAvailableAgentLauncherAppIds(options).then((ids) => {
      setAvailableAgentLauncherAppIds((current) => sameStringSet(current, ids) ? current : new Set(ids));
    });
  }, []);

  const refreshLocalAgentProvidersForComposer = useCallback((options?: { force?: boolean }) => {
    const now = Date.now();
    if (!options?.force && now - lastLocalAgentProviderRefreshAtRef.current < 3000) return;
    lastLocalAgentProviderRefreshAtRef.current = now;
    void props.onRefreshLocalAgentProviders?.();
  }, [props.onRefreshLocalAgentProviders]);

  const scheduleLocalAgentProviderRefreshBurst = useCallback(() => {
    for (const timer of localAgentProviderRefreshTimersRef.current) {
      window.clearTimeout(timer);
    }
    localAgentProviderRefreshTimersRef.current = [0, 250, 900, 1800, 3200].map((delayMs) =>
      window.setTimeout(() => refreshLocalAgentProvidersForComposer({ force: true }), delayMs),
    );
    refreshAvailableAgentLauncherApps({ force: true });
  }, [refreshAvailableAgentLauncherApps, refreshLocalAgentProvidersForComposer]);

  useEffect(() => () => {
    for (const timer of localAgentProviderRefreshTimersRef.current) {
      window.clearTimeout(timer);
    }
    localAgentProviderRefreshTimersRef.current = [];
  }, []);

  useEffect(() => {
    refreshAvailableAgentLauncherApps();
  }, [refreshAvailableAgentLauncherApps]);

  useEffect(() => {
    if (mentionQuery === null) {
      setExternalMentionOptions([]);
      setExternalMentionsLoading(false);
      prefetchedMentionPanelKeysRef.current.clear();
      lastActiveReferenceTabRef.current = null;
      return;
    }
    const tabProviders = mentionTabProviders(activeMentionTab);
    if (tabProviders === null) {
      setExternalMentionOptions([]);
      setExternalMentionsLoading(false);
      lastActiveReferenceTabRef.current = null;
      return;
    }
    let cancelled = false;
    const isFilesTab = tabProviders.includes("file");
    const cacheReady = isTuttiAtMentionCacheReady(tabProviders, {
      roomId: props.conversation.roomId,
      roomFileFingerprint,
    });
    const shouldForceRefresh = isFilesTab
      ? !cacheReady
      : lastActiveReferenceTabRef.current !== activeMentionTab;
    lastActiveReferenceTabRef.current = activeMentionTab;
    const cachedItems = readCachedTuttiAtMentions({
      keyword: mentionQuery,
      roomId: props.conversation.roomId,
      maxResults: 20,
      providers: tabProviders,
      roomArtifacts,
    });
    if (cachedItems) {
      setExternalMentionOptions(cachedItems);
      setActiveMentionIndex(0);
    }
    if (cachedItems && isFilesTab) {
      setExternalMentionsLoading(false);
      return;
    }
    setExternalMentionsLoading(!cachedItems && !isFilesTab);
    void queryTuttiAtMentions({
      keyword: mentionQuery,
      roomId: props.conversation.roomId,
      maxResults: 20,
      providers: tabProviders,
      roomArtifacts,
      forceRefresh: shouldForceRefresh,
    }).then((items) => {
      if (cancelled) return;
      setExternalMentionOptions((current) => sameTuttiAtQueryResults(current, items) ? current : items);
      setExternalMentionsLoading(false);
      setActiveMentionIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionQuery, props.conversation.roomId, activeMentionTab, roomArtifacts, roomFileFingerprint]);

  useEffect(() => {
    if (mentionQuery === null) return;
    scheduleLocalAgentProviderRefreshBurst();
  }, [mentionQuery, scheduleLocalAgentProviderRefreshBurst]);

  useEffect(() => {
    if (mentionQuery === null) return;
    const prefetchInputs = MENTION_PANEL_TABS
      .map((tab) => ({
        key: mentionPanelCacheKey(tab, props.conversation.roomId, roomFileFingerprint),
        providers: mentionTabProviders(tab),
        forceRefresh: tab !== "files",
      }))
      .filter((input): input is { key: string; providers: readonly TuttiAtProviderId[]; forceRefresh: boolean } => Boolean(input.providers));

    for (const input of prefetchInputs) {
      if (prefetchedMentionPanelKeysRef.current.has(input.key)) continue;
      prefetchedMentionPanelKeysRef.current.add(input.key);
      void queryTuttiAtMentions({
        keyword: "",
        roomId: props.conversation.roomId,
        maxResults: 20,
        providers: input.providers,
        roomArtifacts,
        forceRefresh: input.forceRefresh,
      }).finally(() => {
        if (!isTuttiAtMentionCacheReady(input.providers, {
          roomId: props.conversation.roomId,
          roomFileFingerprint,
        })) {
          prefetchedMentionPanelKeysRef.current.delete(input.key);
        }
      });
    }
  }, [mentionQuery, props.conversation.roomId, roomArtifacts, roomFileFingerprint]);
  const send = async () => {
    if (sending || (!text.trim() && uploadItems.length === 0)) return;
    setSending(true);
    try {
      if (editingMessageId) {
        await props.onUpdateMessage(editingMessageId, { content: text, mentions: editingMentions });
        setText("");
        setEditorText(editorRef.current, "", 0);
        setEditingMessageId(null);
        setEditingMentions([]);
        setMentionedIds(new Set());
        setMentionedAll(false);
        setMentionQuery(null);
        return;
      }
      const orderedUploadItems = uploadItemsInEditorOrder(editorRef.current, uploadItems);
      const artifacts = await uploadQueuedItems(orderedUploadItems);
      const artifactsByUploadItemId = new Map(
        orderedUploadItems.flatMap((item, index) => artifacts[index] ? [[item.id, artifacts[index]!] as const] : []),
      );
      const messageParts = serializeComposerMessageParts(editorRef.current, artifactsByUploadItemId);
      const editorMentions = collectMentionTargetsFromEditor(editorRef.current, allMentionableParticipants);
      const isWhisper = WHISPER_FEATURE_ENABLED && hasWhisperChipInEditor(editorRef.current);
      const messageContent = quotes.length ? `${formatQuotesForMessage(quotes)}\n\n${text}` : text;
      const agentGuiDispatch = resolveAgentGuiDispatchFromMentions(
        messageContent,
        editorMentions,
        {
          artifacts: [...props.artifacts, ...artifacts],
          messages: props.allMessages,
          participants: allMentionableParticipants,
          identities: props.identities,
          userDisplayName: props.userDisplayName,
          summaryTasks: props.summaryTasks,
        },
      );
      const result = await props.onSend(props.conversationId, {
        content: messageContent,
        artifactIds: artifacts.map((artifact) => artifact.id),
        parts: quotes.length ? undefined : messageParts,
        parentMessageId: quotes.length === 1 ? quotes[0]!.messageId : null,
        mentions: editorMentions,
        visibility: isWhisper ? "whisper" : "public",
        senderName: props.userDisplayName.trim() || undefined,
      });
      if (agentGuiDispatch) {
        void dispatchAgentGuiTask(agentGuiDispatch);
      }
      if (composerIdleBreakPendingRef.current && result.message?.id) {
        markMessageGroupBreak(result.message.id);
        composerIdleBreakPendingRef.current = false;
      }
      lastComposerInputAtRef.current = Date.now();
      setText("");
      setEditorText(editorRef.current, "", 0);
      setQuotes([]);
      setUploadItems((current) => {
        for (const item of current) {
          revokePreviewUrl(item.previewUrl);
          if (item.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
        }
        return [];
      });
      removedUploadIdsRef.current.clear();
      setMentionedIds(new Set());
      setMentionedAll(false);
      setMentionQuery(null);
    } finally {
      setSending(false);
    }
  };

  const cancelActiveRuns = async () => {
    if (cancelling || props.activeRuns.length === 0) return;
    setCancelling(true);
    try {
      await Promise.all(props.activeRuns.map((run) => props.onCancelRun(run.id)));
    } finally {
      setCancelling(false);
    }
  };

  const syncMentionedIdsFromEditor = (editor: HTMLDivElement) => {
    const ids = new Set<string>();
    let hasAll = false;
    for (const chip of editor.querySelectorAll("[data-mention-chip='true']")) {
      const mentionId = (chip as HTMLElement).dataset.mentionId;
      if (!mentionId) continue;
      if (mentionId === "all") {
        hasAll = true;
        continue;
      }
      if (parseTuttiAtMentionKey(mentionId)) {
        continue;
      }
      ids.add(mentionId);
    }
    setMentionedIds(ids);
    setMentionedAll(hasAll);
  };

  const syncMentionedIds = (value: string) => {
    const editor = editorRef.current;
    if (editor) {
      syncMentionedIdsFromEditor(editor);
      return;
    }
    setMentionedAll(/\B@(all\b|所有人)/i.test(value));
    setMentionedIds((current) => {
      const next = new Set<string>();
      for (const participant of allMentionableParticipants) {
        if (value.includes(`@${participant.displayName}`) && current.has(participant.id)) next.add(participant.id);
      }
      return next;
    });
  };

  const saveMentionSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.startContainer)) {
      mentionSelectionRef.current = range.cloneRange();
      composerCaretOffsetRef.current = caretTextOffset(editor);
    }
  };

  const handleEditorBlur = () => {
    saveMentionSelection();
    syncEditorText();
  };

  const restoreMentionSelection = (editor: HTMLDivElement) => {
    restoreComposerCaret(editor, mentionSelectionRef.current, composerCaretOffsetRef.current);
  };

  const readMentionQueryFromRange = (range: Range | null) => {
    if (!range || rangeCrossesMentionChip(range)) return null;
    const raw = range.toString();
    if (!raw.startsWith("@")) return null;
    const query = raw.slice(1);
    if (/[\s@]/.test(query)) return null;
    return query;
  };

  const captureActiveMentionQueryRange = (editor: HTMLDivElement) => {
    const range = findActiveMentionQueryRange(editor);
    if (!range || rangeCrossesMentionChip(range)) {
      mentionQueryRangeRef.current = null;
      return null;
    }
    mentionQueryRangeRef.current = range.cloneRange();
    return mentionQueryRangeRef.current;
  };

  const updateMentionQuery = (value: string, cursor: number, reopenMentionMenu = false) => {
    const editor = editorRef.current;
    const nextQuery = editor
      ? readMentionQueryFromRange(mentionQueryRangeRef.current ?? findActiveMentionQueryRange(editor))
      : (() => {
          const beforeCursor = value.slice(0, cursor);
          const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
          return match?.[1] ?? null;
        })();
    setMentionQuery((current) => {
      if (current !== nextQuery) {
        setActiveMentionIndex(0);
        if (nextQuery !== null && current === null) {
          setActiveMentionTab("members");
        }
      }
      if (nextQuery !== null) {
        saveMentionSelection();
        if (reopenMentionMenu) setMentionMenuDismissed(false);
      } else {
        mentionSelectionRef.current = null;
        mentionQueryRangeRef.current = null;
        setMentionMenuDismissed(false);
      }
      return nextQuery;
    });
  };

  const suppressEditorSyncRef = useRef(false);

  const syncEditorText = (reopenMentionMenu = false) => {
    if (suppressEditorSyncRef.current) return;
    const now = Date.now();
    if (now - lastComposerInputAtRef.current > MESSAGE_GROUP_IDLE_MS) {
      composerIdleBreakPendingRef.current = true;
    }
    lastComposerInputAtRef.current = now;
    const editor = editorRef.current;
    const nextText = editorText(editor);
    const cursor = editor ? caretTextOffset(editor) : nextText.length;
    setText(nextText);
    syncMentionedIds(nextText);
    if (editor) captureActiveMentionQueryRange(editor);
    updateMentionQuery(nextText, cursor, reopenMentionMenu);
    if (editor) composerCaretOffsetRef.current = cursor;
    resizeComposerEditor(editor);
  };

  useLayoutEffect(() => {
    resizeComposerEditor(editorRef.current);
  }, [text, quotes.length, uploadItems.length, props.conversationId]);

  useLayoutEffect(() => {
    syncUploadItemChips(editorRef.current, uploadItems);
  }, [uploadItems]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    for (const chip of editor.querySelectorAll<HTMLElement>("[data-upload-item-id]")) {
      chip.toggleAttribute("data-selected", selectedUploadItemIds.has(chip.dataset.uploadItemId ?? ""));
    }
  }, [selectedUploadItemIds]);

  useEffect(() => {
    setSelectedUploadItemIds((current) => {
      if (!current.size) return current;
      const uploadIds = new Set(uploadItems.map((item) => item.id));
      const next = new Set([...current].filter((id) => uploadIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [uploadItems]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = attachmentDragSelectionRef.current;
      const footer = footerRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !footer) return;
      const selectedIds = uploadItemIdsCrossedByLeftDrag(footer, drag.startX, event.clientX, event.clientY);
      setSelectedUploadItemIds((current) => sameStringSet(current, selectedIds) ? current : selectedIds);
      if (selectedIds.size > 0) suppressEditorClickClearRef.current = true;
    };
    const handlePointerEnd = (event: PointerEvent) => {
      if (attachmentDragSelectionRef.current?.pointerId !== event.pointerId) return;
      attachmentDragSelectionRef.current = null;
    };
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, []);

  const insertMentionChipAtActiveQuery = (label: string, mentionId: string, reference?: TuttiAtQueryResult): boolean => {
    const editor = editorRef.current;
    if (!editor) return false;

    let queryRange = mentionQueryRangeRef.current;
    if (
      queryRange &&
      (!editor.contains(queryRange.startContainer) || !editor.contains(queryRange.endContainer))
    ) {
      queryRange = null;
    }
    if (!queryRange) {
      restoreMentionSelection(editor);
      queryRange = findActiveMentionQueryRange(editor);
    }
    if (!queryRange || rangeCrossesMentionChip(queryRange)) return false;

    suppressEditorSyncRef.current = true;
    try {
      const trailingSpace = replaceMentionQueryRange(queryRange.cloneRange(), label, mentionId, reference);
      normalizeEditorAfterMentionInsert(editor);
      focusAfterTrailingSpace(trailingSpace, editor);
    } finally {
      suppressEditorSyncRef.current = false;
    }

    setText(editorText(editor));
    syncMentionedIdsFromEditor(editor);
    setMentionQuery(null);
    mentionSelectionRef.current = null;
    mentionQueryRangeRef.current = null;
    resizeComposerEditor(editor);
    return true;
  };

  const insertMention = (participant: Participant) => {
    insertMentionChipAtActiveQuery(participant.displayName, participant.id);
  };

  const insertMentionAtCursor = (participant: Participant): boolean => {
    setMentionQuery(null);
    const editor = editorRef.current;
    if (!editor) return false;

    editor.focus({ preventScroll: true });
    restoreComposerCaret(editor, mentionSelectionRef.current, composerCaretOffsetRef.current);

    suppressEditorSyncRef.current = true;
    let trailingSpace: Text | null = null;
    try {
      let queryRange = mentionQueryRangeRef.current;
      if (
        queryRange &&
        (!editor.contains(queryRange.startContainer) || !editor.contains(queryRange.endContainer))
      ) {
        queryRange = null;
      }
      if (!queryRange) {
        queryRange = findActiveMentionQueryRange(editor);
      }
      if (queryRange && !rangeCrossesMentionChip(queryRange)) {
        trailingSpace = replaceMentionQueryRange(queryRange.cloneRange(), participant.displayName, participant.id);
      } else {
        trailingSpace = insertMentionChipAtCaret(editor, participant.displayName, participant.id);
      }
      normalizeEditorAfterMentionInsert(editor);
    } finally {
      suppressEditorSyncRef.current = false;
    }

    setText(editorText(editor));
    syncMentionedIdsFromEditor(editor);
    setMentionQuery(null);
    mentionQueryRangeRef.current = null;

    if (trailingSpace) {
      focusAfterTrailingSpace(trailingSpace, editor);
    } else {
      placeCaretAtEditorEnd(editor, { preventScroll: true });
    }
    composerCaretOffsetRef.current = caretTextOffset(editor);
    resizeComposerEditor(editor);
    return true;
  };

  const insertAllMention = () => {
    if (!insertMentionChipAtActiveQuery(t("composer.everyone"), "all")) return;
    setMentionedAll(true);
  };

  const focusRoomFileFromMention = (roomFile: TuttiAtRoomFileMeta) => {
    const artifact = props.artifacts.find((item) => item.id === roomFile.artifactId);
    const messageId = roomFile.messageId
      ?? (artifact ? resolveArtifactLinkedMessageId(artifact, props.agentRuns, props.allMessages) : null);
    if (!messageId) return;
    props.onFocusRoomFile?.({
      messageId,
      artifactId: roomFile.artifactId,
    });
    setMentionQuery(null);
  };

  const openFileReferenceFromChip = useCallback((element: HTMLElement) => {
    const parsedMention = parseTuttiAtMentionKey(element.dataset.mentionId ?? "");
    const entityId = parsedMention?.itemId ?? "";
    const guiProvider = parsedMention?.providerId === "workspace-app"
      ? resolveAgentGuiProviderFromAppId(entityId)
      : null;
    if (guiProvider) {
      void openAgentGuiProvider(guiProvider);
      return;
    }

    const href = element instanceof HTMLAnchorElement ? element.href : "";
    const mentionHref = href.startsWith("mention://") ? href : element.dataset.mentionLinkHref?.trim() || "";
    if (mentionHref.startsWith("mention://")) {
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
      openReferenceMentionTarget(mentionHref, element.dataset.mentionLabel?.trim() || "", {
        referenceProviderId: element.dataset.mentionReferenceProvider as MentionTarget["referenceProviderId"],
        referenceEntityId: parseTuttiAtMentionKey(element.dataset.mentionId ?? "")?.itemId,
        referenceInsert,
        referenceScope,
      }, props.artifacts);
      return;
    }
    const label = element.dataset.mentionLabel?.trim();
    const roomFileRaw = element.dataset.mentionRoomFile;
    if (roomFileRaw) {
      try {
        const roomFile = JSON.parse(roomFileRaw) as TuttiAtRoomFileMeta;
        const artifact = props.artifacts.find((item) => item.id === roomFile.artifactId);
        if (artifact) {
          revealArtifactInTuttiFileManager(artifact);
          return;
        }
      } catch {
        // ignore
      }
    }

    const fileHref = element.dataset.mentionLinkHref?.trim();
    if (fileHref && !fileHref.startsWith("mention://")) {
      const locationType = roomFileRaw ? "app-data-relative" : "workspace-relative";
      if (tryOpenFileInTuttiSync({
        path: fileHref,
        location: { type: locationType, path: fileHref },
        name: label || fileHref.split("/").pop() || fileHref,
        mode: "reveal",
      })) {
        return;
      }
    }
  }, [props.artifacts]);

  const selectMentionOption = (option: MentionOption) => {
    const editor = editorRef.current;
    if (editor) captureActiveMentionQueryRange(editor);
    if (option.kind === "all") {
      insertAllMention();
    } else if (option.kind === "reference") {
      const mentionId = tuttiAtMentionKey(option.providerId, option.item.itemId);
      insertMentionChipAtActiveQuery(option.label, mentionId, option.item);
    } else if (option.kind === "local-agent") {
      const reference = buildLocalAgentLauncherReference(option);
      insertMentionChipAtActiveQuery(option.label, tuttiAtMentionKey(reference.providerId, reference.itemId), reference);
    } else {
      insertMention(option.participant);
    }
    setMentionQuery(null);
  };

  const insertWhisperMention = (participant: Participant) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    restoreComposerCaret(editor, mentionSelectionRef.current, composerCaretOffsetRef.current);
    captureActiveMentionQueryRange(editor);

    suppressEditorSyncRef.current = true;
    let trailingSpace: Text | null = null;
    try {
      let queryRange = mentionQueryRangeRef.current;
      if (
        queryRange &&
        (!editor.contains(queryRange.startContainer) || !editor.contains(queryRange.endContainer))
      ) {
        queryRange = null;
      }
      if (!queryRange) {
        restoreMentionSelection(editor);
        queryRange = findActiveMentionQueryRange(editor);
      }
      if (queryRange && !rangeCrossesMentionChip(queryRange)) {
        trailingSpace = replaceMentionQueryRange(queryRange.cloneRange(), participant.displayName, participant.id);
      } else {
        trailingSpace = insertMentionChipAtCaret(editor, participant.displayName, participant.id);
      }
      trailingSpace = attachWhisperChipBeforeTrailingSpace(editor, trailingSpace);
      normalizeEditorAfterMentionInsert(editor);
      focusAfterTrailingSpace(trailingSpace, editor);
    } finally {
      suppressEditorSyncRef.current = false;
    }

    setText(editorText(editor));
    syncMentionedIdsFromEditor(editor);
    setMentionQuery(null);
    mentionSelectionRef.current = null;
    mentionQueryRangeRef.current = null;
  };

  const queueFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
    const queued = fileList.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        id: crypto.randomUUID(),
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        previewUrl,
        status: "pending" as const,
        file,
      };
    });
    setUploadItems((current) => [...current, ...queued]);
    insertUploadItemsAtCaret(editorRef.current, queued);
  };

  const focusComposerAfterAttachmentInsert = () => {
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      placeCaretAtEditorEnd(editor, { preventScroll: true });
      syncEditorText(true);
    });
  };

  const queueExistingArtifacts = (artifacts: Artifact[]) => {
    if (!artifacts.length) return;
    const queued = artifacts.map((artifact) => ({
      id: crypto.randomUUID(),
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      previewUrl: artifact.mimeType.startsWith("image/") ? artifact.publicUrl : null,
      status: "uploaded" as const,
      file: new File([], artifact.filename, { type: artifact.mimeType }),
      artifact,
    }));
    setUploadItems((current) => [...current, ...queued]);
    insertUploadItemsAtCaret(editorRef.current, queued);
  };

  const duplicateComposerUploadItems = (itemIds: string[], sourceItems = uploadItems) => {
    const ids = new Set(itemIds);
    const duplicated = sourceItems
      .filter((item) => ids.has(item.id))
      .map((item): UploadItem => {
        const previewUrl = item.artifact
          ? item.previewUrl
          : item.mimeType.startsWith("image/")
            ? URL.createObjectURL(item.file)
            : null;
        if (previewUrl && !item.artifact) previewUrlsRef.current.add(previewUrl);
        return {
          ...item,
          id: crypto.randomUUID(),
          previewUrl,
          status: item.artifact ? "uploaded" : "pending",
          error: undefined,
        };
      });
    if (!duplicated.length) return false;
    setUploadItems((current) => [...current, ...duplicated]);
    insertUploadItemsAtCaret(editorRef.current, duplicated);
    return true;
  };

  const copyComposerUploads = (event: ClipboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) return;
    const itemIds = selectedUploadItemIds.size > 0
      ? [...selectedUploadItemIds]
      : uploadItemIdsInSelection(editor);
    if (!itemIds.length) return;
    const selectedText = composerTextInSelection(editor);
    const token = crypto.randomUUID();
    storeComposerUploadClipboardSnapshot(
      token,
      uploadItems.filter((item) => itemIds.includes(item.id)).map((item) => ({ ...item })),
    );
    event.preventDefault();
    event.clipboardData.setData(COMPOSER_UPLOAD_CLIPBOARD_MIME, JSON.stringify({ token, itemIds, text: selectedText }));
    event.clipboardData.setData("text/plain", selectedText);
  };

  const resolvePastedArtifacts = (clipboardData: DataTransfer, pastedText: string) => {
    const payload = readArtifactClipboardFromDataTransfer(clipboardData);
    if (payload && (payload.artifactIds.length || payload.parts?.length)) {
      const artifacts = resolveArtifactsByIds(payload.artifactIds, props.allArtifacts);
      if (artifacts.length > 0 || payload.parts?.length) {
        let preferOverClipboardFiles = payload.preferOverClipboardFiles;
        const files = clipboardFiles(clipboardData);
        const onlyClipboardImages = files.length > 0 && files.every((file) => file.type.startsWith("image/"));
        const hasNonImageArtifact = artifacts.some((artifact) => !artifact.mimeType.startsWith("image/"));
        if (!preferOverClipboardFiles && onlyClipboardImages && hasNonImageArtifact) {
          preferOverClipboardFiles = true;
        }
        return {
          artifacts,
          includeText: payload.includeText,
          parts: payload.parts,
          preferOverClipboardFiles,
        };
      }
    }

    return { artifacts: [] as Artifact[], includeText: true, parts: undefined, preferOverClipboardFiles: false };
  };

  const applyPastedArtifacts = (
    pastedArtifactClipboard: ReturnType<typeof resolvePastedArtifacts>,
    pastedText: string,
  ) => {
    const insertText = (content: string) => insertComposerPasteAtCaret(
      content,
      {
        getMessageLabel: (messageIdSegment) => formatMessageLinkLabel(
          messageIdSegment,
          props.allMessages,
          props.allParticipants,
          props.identities,
          props.userDisplayName,
        ),
        getSummaryTask: (taskId) => props.summaryTasks.find((task) => task.id === taskId) ?? null,
      },
      composerPasteContext,
    );
    if (pastedArtifactClipboard.parts?.length) {
      const artifactsById = new Map(pastedArtifactClipboard.artifacts.map((artifact) => [artifact.id, artifact]));
      for (const part of pastedArtifactClipboard.parts) {
        if (part.type === "text") {
          if (part.content) insertText(part.content);
        } else {
          const artifact = artifactsById.get(part.artifactId);
          if (artifact) queueExistingArtifacts([artifact]);
        }
      }
      requestAnimationFrame(() => syncEditorText(true));
      return;
    }
    if (
      pastedArtifactClipboard.includeText
      && pastedText.trim()
      && !isPlaceholderAttachmentText(pastedText)
      && !isArtifactOnlyClipboardPlainText(pastedText)
    ) {
      insertText(pastedText);
      requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (editor) syncMentionedIdsFromEditor(editor);
        syncEditorText(true);
      });
    }
    if (pastedArtifactClipboard.artifacts.length > 0) {
      queueExistingArtifacts(pastedArtifactClipboard.artifacts);
    }
    requestAnimationFrame(() => syncEditorText(true));
  };

  const ensureUploadItemArtifact = (item: UploadItem): Promise<Artifact | null> => {
    if (item.artifact) return Promise.resolve(item.artifact);
    const existingPromise = uploadItemPromisesRef.current.get(item.id);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      try {
        setUploadItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id ? { ...currentItem, status: "uploading" as const, error: undefined } : currentItem,
          ),
        );
        const dataBase64 = await fileToBase64(item.file);
        const result = await props.onUpload(props.conversationId, {
          filename: item.filename,
          mimeType: item.mimeType,
          dataBase64,
        });
        if (removedUploadIdsRef.current.has(item.id)) {
          revokePreviewUrl(item.previewUrl);
          if (item.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
          return null;
        }
        setUploadItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id ? { ...currentItem, status: "uploaded" as const, artifact: result.artifact } : currentItem,
          ),
        );
        return result.artifact;
      } catch (error) {
        if (removedUploadIdsRef.current.has(item.id)) {
          revokePreviewUrl(item.previewUrl);
          if (item.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
          return null;
        }
        setUploadItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  status: "error" as const,
                  error: error instanceof Error ? error.message : "Upload failed",
                }
              : currentItem,
          ),
        );
        throw error;
      } finally {
        uploadItemPromisesRef.current.delete(item.id);
      }
    })();

    uploadItemPromisesRef.current.set(item.id, promise);
    return promise;
  };

  const uploadQueuedItems = async (items: UploadItem[]) => {
    const artifacts: Artifact[] = [];
    for (const item of items) {
      const artifact = await ensureUploadItemArtifact(item);
      if (artifact) artifacts.push(artifact);
    }
    return artifacts;
  };

  const pasteFiles = (event: ClipboardEvent<HTMLDivElement>) => {
    const copiedUploads = readComposerUploadClipboard(event.clipboardData);
    if (copiedUploads.itemIds.length > 0) {
      event.preventDefault();
      if (selectedUploadItemIds.size > 0) removeUploadItems(selectedUploadItemIds);
      duplicateComposerUploadItems(
        copiedUploads.itemIds,
        composerUploadClipboardSnapshots.get(copiedUploads.token) ?? uploadItems,
      );
      if (copiedUploads.text) {
        insertComposerPasteAtCaret(copiedUploads.text, {
          getMessageLabel: (messageIdSegment) => formatMessageLinkLabel(
            messageIdSegment,
            props.allMessages,
            props.allParticipants,
            props.identities,
            props.userDisplayName,
          ),
          getSummaryTask: (taskId) => props.summaryTasks.find((task) => task.id === taskId) ?? null,
        }, composerPasteContext);
      }
      requestAnimationFrame(() => syncEditorText(true));
      return;
    }
    if (selectedUploadItemIds.size > 0) removeUploadItems(selectedUploadItemIds);
    const pastedHtml = event.clipboardData.getData("text/html");
    const pastedText = normalizeComposerPasteText(pastedHtml, event.clipboardData.getData("text/plain"));

    const pastedArtifactClipboard = resolvePastedArtifacts(event.clipboardData, pastedText);
    const summaryLinkFromMime = event.clipboardData.getData(SUMMARY_LINK_MIME).trim();
    const stashedSummaryLink = readStashedSummaryLink();
    const summaryLink = summaryLinkFromMime.startsWith("group-chat://summary/")
      ? summaryLinkFromMime
      : /^【(?:消息总结|Message summary)/.test(pastedText)
        ? stashedSummaryLink
        : null;
    if (summaryLink?.startsWith("group-chat://summary/")) {
      event.preventDefault();
      const taskId = summaryLink.replace("group-chat://summary/", "");
      insertSummaryLinkAtCaret(
        taskId,
        props.summaryTasks.find((task) => task.id === taskId) ?? null,
      );
      requestAnimationFrame(() => syncEditorText(true));
      return;
    }

    if (pastedArtifactClipboard.preferOverClipboardFiles) {
      event.preventDefault();
      applyPastedArtifacts(
        pastedArtifactClipboard,
        pastedArtifactClipboard.includeText ? pastedText : "",
      );
      return;
    }

    const files = clipboardFiles(event.clipboardData);
    if (files.length > 0) {
      event.preventDefault();
      queueFiles(files);
      requestAnimationFrame(() => syncEditorText(true));
      return;
    }

    if (pastedArtifactClipboard.artifacts.length > 0) {
      event.preventDefault();
      applyPastedArtifacts(
        pastedArtifactClipboard,
        pastedArtifactClipboard.includeText ? pastedText : "",
      );
      return;
    }

    if (!pastedText.trim() || isArtifactOnlyClipboardPlainText(pastedText)) return;
    event.preventDefault();
    insertComposerPasteAtCaret(
      pastedText,
      {
        getMessageLabel: (messageIdSegment) => formatMessageLinkLabel(
          messageIdSegment,
          props.allMessages,
          props.allParticipants,
          props.identities,
          props.userDisplayName,
        ),
        getSummaryTask: (taskId) => props.summaryTasks.find((task) => task.id === taskId) ?? null,
      },
      composerPasteContext,
    );
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (editor) syncMentionedIdsFromEditor(editor);
      syncEditorText(true);
    });
  };

  const removeUploadItem = (itemId: string) => {
    removedUploadIdsRef.current.add(itemId);
    const item = uploadItems.find((candidate) => candidate.id === itemId);
    revokePreviewUrl(item?.previewUrl ?? null);
    if (item?.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
    setUploadItems((current) => current.filter((candidate) => candidate.id !== itemId));
    removeUploadItemChip(editorRef.current, itemId);
    setSelectedUploadItemIds((current) => {
      if (!current.has(itemId)) return current;
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
  };

  const removeUploadItems = (itemIds: Iterable<string>) => {
    const ids = new Set(itemIds);
    if (!ids.size) return false;
    for (const itemId of ids) removedUploadIdsRef.current.add(itemId);
    for (const item of uploadItems) {
      if (!ids.has(item.id)) continue;
      revokePreviewUrl(item.previewUrl);
      if (item.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
    }
    setUploadItems((current) => current.filter((candidate) => !ids.has(candidate.id)));
    for (const itemId of ids) removeUploadItemChip(editorRef.current, itemId);
    setSelectedUploadItemIds(new Set());
    return true;
  };

  const selectAllComposerContent = () => {
    const editor = editorRef.current;
    if (!editor) return false;
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setSelectedUploadItemIds(new Set(uploadItems.map((item) => item.id)));
    setMentionQuery(null);
    return true;
  };

  const deleteSelectedComposerContent = () => {
    if (selectedUploadItemIds.size === 0) return false;
    const editor = editorRef.current;
    removeUploadItems(selectedUploadItemIds);
    const selection = window.getSelection();
    if (editor && selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        syncEditorText();
      }
    }
    requestAnimationFrame(() => editor?.focus({ preventScroll: true }));
    return true;
  };

  const openUploadItem = async (item: UploadItem) => {
    if (item.artifact && revealArtifactInTuttiFileManager(item.artifact)) {
      return;
    }
    if (item.mimeType.startsWith("image/") && item.previewUrl) {
      setPreview({ title: item.filename, mimeType: item.mimeType, url: item.previewUrl });
      return;
    }
    if (isTextAttachment(item.mimeType, item.filename)) {
      setPreview({ title: item.filename, mimeType: item.mimeType, loading: true });
      try {
        const text = item.artifact?.publicUrl
          ? await (await fetch(item.artifact.publicUrl)).text()
          : await item.file.text();
        setPreview({ title: item.filename, mimeType: item.mimeType, text });
      } catch {
        setPreview({ title: item.filename, mimeType: item.mimeType, text: t("composer.previewUnreadable") });
      }
      return;
    }
    if (item.previewUrl) window.open(item.previewUrl, "_blank", "noopener,noreferrer");
  };

  const saveCurrentComposerDraft = useCallback((conversationId = activeDraftConversationIdRef.current) => {
    const editor = editorRef.current;
    const html = editor?.innerHTML ?? "";
    const draft: ComposerDraft = {
      html,
      text,
      editingMessageId,
      editingMentions,
      quotes,
      uploadItems,
      mentionedIds: [...mentionedIds],
      mentionedAll,
    };
    if (isEmptyComposerDraft(draft)) {
      composerDraftsRef.current.delete(conversationId);
      return;
    }
    composerDraftsRef.current.set(conversationId, draft);
  }, [editingMentions, editingMessageId, mentionedAll, mentionedIds, quotes, text, uploadItems]);

  useEffect(() => {
    return () => {
      for (const previewUrl of previewUrlsRef.current) revokePreviewUrl(previewUrl);
      previewUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    saveCurrentComposerDraft();
  }, [saveCurrentComposerDraft]);

  useEffect(() => {
    setActiveMentionIndex((current) => (mentionOptions.length ? Math.min(current, mentionOptions.length - 1) : 0));
  }, [mentionOptions.length, activeMentionTab]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMentionTab]);

  useEffect(() => {
    saveCurrentComposerDraft(activeDraftConversationIdRef.current);
    activeDraftConversationIdRef.current = props.conversationId;
    const draft = composerDraftsRef.current.get(props.conversationId) ?? null;
    setText(draft?.text ?? "");
    setEditingMessageId(draft?.editingMessageId ?? null);
    setEditingMentions(draft?.editingMentions ?? []);
    setQuotes(draft?.quotes ?? []);
    setUploadItems(draft?.uploadItems ?? []);
    setMentionedIds(new Set(draft?.mentionedIds ?? []));
    setMentionedAll(draft?.mentionedAll ?? false);
    restoreEditorDraft(editorRef.current, draft);
    handledMentionRequestSeqRef.current = 0;
    setMentionQuery(null);
    setMentionMenuDismissed(false);
    setExternalMentionOptions([]);
    setExternalMentionsLoading(false);
    setActiveMentionIndex(0);
    setActiveMentionTab("members");
    mentionSelectionRef.current = null;
    mentionQueryRangeRef.current = null;
    composerCaretOffsetRef.current = null;
    prefetchedMentionPanelKeysRef.current.clear();
    lastActiveReferenceTabRef.current = null;
  }, [props.conversationId]);

  useLayoutEffect(() => {
    const request = props.mentionRequest;
    if (!request || request.seq === handledMentionRequestSeqRef.current) return;
    const participant = mentionableAgents.find((item) => item.id === request.participantId);
    if (!participant) return;

    let cancelled = false;
    let attempts = 0;

    const tryInsert = () => {
      if (cancelled) return;
      if (insertMentionAtCursor(participant)) {
        handledMentionRequestSeqRef.current = request.seq;
        return;
      }
      attempts += 1;
      if (attempts < 8) {
        requestAnimationFrame(tryInsert);
      }
    };

    tryInsert();
    return () => {
      cancelled = true;
    };
  }, [mentionableAgents, props.mentionRequest]);

  useLayoutEffect(() => {
    const request = props.focusRequest;
    if (!request || request.seq === handledFocusRequestSeqRef.current) return;
    pendingFocusSeqRef.current = request.seq;
    let cancelled = false;
    const cancelFocus = focusComposerWhenReady(() => editorRef.current, {
      preventScroll: true,
      isCancelled: () => cancelled || pendingFocusSeqRef.current !== request.seq,
      onSuccess: () => {
        handledFocusRequestSeqRef.current = request.seq;
      },
    });
    return () => {
      cancelled = true;
      cancelFocus();
    };
  }, [props.focusRequest]);

  useLayoutEffect(() => {
    let cancelled = false;
    const cancelFocus = focusComposerWhenReady(() => editorRef.current, {
      preventScroll: true,
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
      cancelFocus();
    };
  }, [props.conversationId]);

  useEffect(() => {
    const request = props.composerRequest;
    if (!request || request.seq === handledComposerRequestSeqRef.current) return;
    handledComposerRequestSeqRef.current = request.seq;
    if (request.type === "edit") {
      setEditingMessageId(request.messageId);
      setEditingMentions(request.mentions);
      setQuotes([]);
      setText(request.content);
      requestAnimationFrame(() => setEditorText(editorRef.current, request.content, request.content.length));
      return;
    }
    if (request.type === "quote") {
      setQuotes([request.quote]);
      requestAnimationFrame(() => focusEditorAtEnd(editorRef.current));
      return;
    }
    if (request.type === "quotes") {
      setQuotes(request.quotes);
      requestAnimationFrame(() => focusEditorAtEnd(editorRef.current));
      return;
    }
    if (request.type === "insertSummaryLink") {
      const task = props.summaryTasks.find((item) => item.id === request.taskId) ?? null;
      requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (!editor) return;
        focusEditorAtEnd(editor);
        insertSummaryLinkAtCaret(request.taskId, task);
        syncEditorText(true);
      });
      return;
    }
    if (request.type === "insert") {
      requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const labels = {
          getMessageLabel: composerInsertLabels.getMessageLabel,
          getSummaryTask: composerInsertLabels.getSummaryTask,
        };
        if (!text.trim()) {
          insertComposerPasteAtCaret(request.content, labels, composerPasteContext);
        } else {
          focusEditorAtEnd(editor);
          const separator = text.endsWith("\n") ? "" : "\n";
          if (separator) {
            const selection = window.getSelection();
            if (selection?.rangeCount) {
              const range = selection.getRangeAt(0);
              const separatorNode = document.createTextNode(separator);
              range.insertNode(separatorNode);
              range.setStartAfter(separatorNode);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
          insertComposerPasteAtCaret(request.content, labels, composerPasteContext);
        }
        syncEditorText(true);
      });
      return;
    }
  }, [props.composerRequest, text, props.summaryTasks, composerInsertLabels, composerPasteContext]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.querySelectorAll("[data-summary-link-id]").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const taskId = node.dataset.summaryLinkId ?? "";
      if (!taskId) return;
      const task = props.summaryTasks.find((item) => item.id === taskId) ?? null;
      node.replaceWith(createSummaryLinkChipElement(taskId, task));
    });
  }, [props.summaryTasks]);

  const mentionMenuVisible = mentionQuery !== null;
  const mentionMenuOpen = mentionMenuVisible && !mentionMenuDismissed;
  const referenceTabLoading = externalMentionsLoading && activeMentionTab !== "members";

  useLayoutEffect(() => {
    if (!mentionMenuOpen || activeMentionTab !== "members") return;
    mentionMenuListRef.current?.scrollTo({ top: 0 });
  }, [mentionMenuOpen, activeMentionTab, localAgentMentionOptions.length]);

  const updateMentionMenuPosition = useCallback(() => {
    const anchor = footerRef.current;
    const menu = mentionMenuRef.current;
    if (!anchor || !menu || !mentionMenuOpen) return;
    const anchorRect = anchor.getBoundingClientRect();
    const menuHeight = menu.offsetHeight || Math.min(300, window.innerHeight - 180);
    const horizontalPadding = window.innerWidth <= 760 ? 12 : 16;
    const top = Math.max(12, anchorRect.top - menuHeight + 4);
    setMentionMenuStyle({
      position: "fixed",
      top,
      left: anchorRect.left + horizontalPadding,
      width: Math.max(0, anchorRect.width - horizontalPadding * 2),
      zIndex: MENTION_MENU_Z_INDEX,
      maxHeight: "min(360px, calc(100vh - 180px))",
      visibility: "visible",
    });
  }, [mentionMenuOpen]);

  useLayoutEffect(() => {
    if (!mentionMenuOpen) return;
    updateMentionMenuPosition();
    const frame = window.requestAnimationFrame(updateMentionMenuPosition);
    const handleReposition = () => updateMentionMenuPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [mentionMenuOpen, mentionOptions.length, updateMentionMenuPosition]);

  useEffect(() => {
    if (!mentionMenuVisible) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (mentionMenuRef.current?.contains(target)) return;
      if (editorRef.current?.contains(target)) return;
      setMentionMenuDismissed(true);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [mentionMenuVisible]);

  return (
    <footer ref={footerRef} className={"[position:relative] [z-index:50] [border-top:0] [padding:8px_16px_16px] [background:var(--panel)] max-[760px]:[padding-inline:12px]"}>
      {editingMessageId ? (
        <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:10px] [margin-bottom:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:8px_10px] [background:#fff7ed] [color:#9a3412] [font-size:12px] [font-weight:650]"}>
          <span>{t("composer.editingHint")}</span>
          <button
            type="button"
            className={"[display:inline-grid] [width:24px] [height:24px] [place-items:center] [border:0] [border-radius:999px] [color:#9a3412] [background:#fed7aa]"}
            aria-label={t("composer.cancelEdit")}
            onClick={() => {
              setEditingMessageId(null);
              setEditingMentions([]);
              setQuotes([]);
              setText("");
              setMentionedIds(new Set());
              setMentionedAll(false);
              setMentionQuery(null);
              setEditorText(editorRef.current, "", 0);
            }}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      <div
        data-stop={props.activeRuns.length > 0 || undefined}
        className={"[display:grid] [grid-template-columns:40px_minmax(0,_1fr)_40px] [gap:8px] [align-items:end] [border:1px_solid_var(--border)] [border-radius:22px] [padding:8px] [background:#ffffff] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [&[data-stop=true]]:[grid-template-columns:40px_minmax(0,_1fr)_40px_40px] [&:focus-within]:[border-color:var(--border-strong)] [&:focus-within]:[box-shadow:0_0_0_3px_#00000008] max-[760px]:[grid-template-columns:34px_minmax(0,_1fr)_38px] max-[760px]:[&[data-stop=true]]:[grid-template-columns:34px_minmax(0,_1fr)_34px_38px]"}
        onClick={(event) => {
          if (event.target === event.currentTarget) editorRef.current?.focus();
        }}
      >
        <label className={"[display:inline-grid] [place-items:center] [border:0] [width:40px] [height:40px] [border-radius:999px] [color:#17171799] [background:transparent] [transition:background-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000008] [&_input]:[display:none] max-[760px]:[width:34px] max-[760px]:[height:34px]"} title={t("composer.attachFiles")}>
          <Paperclip size={18} />
          <input
            type="file"
            multiple
            onChange={(event) => {
              queueFiles(event.target.files);
              event.currentTarget.value = "";
              focusComposerAfterAttachmentInsert();
            }}
          />
        </label>
        <div className={"[display:grid] [min-height:40px] [align-content:start] [gap:6px] [padding:2px_0]"}>
          {quotes.length ? <QuoteComposerBar quotes={quotes} onRemove={() => setQuotes([])} /> : null}
          <div className={"[display:flex] [min-height:28px] [min-width:0] [flex-wrap:wrap] [align-items:flex-start] [gap:4px_6px]"}>
            <div className={"[position:relative] [min-width:0] [flex:1_1_180px] [min-height:28px] [display:grid] [align-items:start] [overflow:hidden] [&:has([data-upload-item-id])_[data-slot=composer-placeholder]]:[display:none] [&:has([data-mention-chip])_[data-slot=composer-placeholder]]:[display:none] [&:has([data-message-link-id])_[data-slot=composer-placeholder]]:[display:none] [&:has([data-summary-link-id])_[data-slot=composer-placeholder]]:[display:none]"}>
            {!text && uploadItems.length === 0 && t("composer.placeholder").trim() ? (
              <span data-slot="composer-placeholder" className={"[pointer-events:none] [position:absolute] [left:0] [top:4px] [color:#17171755] [font-size:13px] [line-height:20px]"}>
                {t("composer.placeholder")}
              </span>
            ) : null}
            <div
              ref={bindEditorRef}
              role="textbox"
              aria-label={t("composer.input")}
              aria-multiline="true"
              contentEditable
              suppressContentEditableWarning
              className={"[width:100%] [min-width:0] [min-height:28px] [max-height:168px] [overflow-y:hidden] [outline:none] [white-space:pre-wrap] [overflow-wrap:anywhere] [word-break:break-word] [color:var(--text)] [font-size:13px] [line-height:20px] [padding:4px_0] empty:before:[content:'']"}
              onPointerDown={(event) => {
                if (event.button !== 0 || uploadItems.length === 0) return;
                attachmentDragSelectionRef.current = { pointerId: event.pointerId, startX: event.clientX };
                suppressEditorClickClearRef.current = false;
              }}
              onInput={() => {
                setSelectedUploadItemIds((current) => current.size ? new Set() : current);
                const editor = editorRef.current;
                if (editor) {
                  const itemIds = new Set(
                    [...editor.querySelectorAll<HTMLElement>("[data-upload-item-id]")]
                      .map((chip) => chip.dataset.uploadItemId)
                      .filter((itemId): itemId is string => Boolean(itemId)),
                  );
                  setUploadItems((current) => {
                    const removed = current.filter((item) => !itemIds.has(item.id));
                    if (removed.length === 0) return current;
                    for (const item of removed) {
                      revokePreviewUrl(item.previewUrl);
                      if (item.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
                    }
                    return current.filter((item) => itemIds.has(item.id));
                  });
                }
                syncEditorText(true);
              }}
              onMouseDown={(event) => {
                const messageChip = (event.target as Element).closest("[data-message-link-id]");
                if (messageChip) event.preventDefault();
                const summaryChip = (event.target as Element).closest("[data-summary-link-id]");
                if (summaryChip) event.preventDefault();
                const linkChip = (event.target as Element).closest('[data-mention-display-mode="reference-link"]');
                if (linkChip) event.preventDefault();
              }}
              onClick={(event) => {
                const uploadChip = (event.target as Element).closest<HTMLElement>("[data-upload-item-id]");
                if (uploadChip) {
                  event.preventDefault();
                  const itemId = uploadChip.dataset.uploadItemId;
                  if (!itemId) return;
                  if ((event.target as Element).closest("[data-upload-remove]")) {
                    removeUploadItem(itemId);
                    return;
                  }
                  const item = uploadItems.find((candidate) => candidate.id === itemId);
                  if (item) void openUploadItem(item);
                  return;
                }
                const messageChip = (event.target as Element).closest("[data-message-link-id]");
                if (messageChip instanceof HTMLElement) {
                  event.preventDefault();
                  const messageId = primaryMessageLinkId(messageChip.dataset.messageLinkId ?? "");
                  if (messageId) props.onOpenMessageLink?.(messageId);
                  return;
                }
                const summaryChip = (event.target as Element).closest("[data-summary-link-id]");
                if (summaryChip instanceof HTMLElement) {
                  event.preventDefault();
                  const taskId = summaryChip.dataset.summaryLinkId;
                  if (taskId) props.onOpenSummaryLink?.(taskId);
                  return;
                }
                const linkChip = (event.target as Element).closest('[data-mention-display-mode="reference-link"]');
                if (linkChip instanceof HTMLElement) {
                  event.preventDefault();
                  openFileReferenceFromChip(linkChip);
                  return;
                }
                if (suppressEditorClickClearRef.current) {
                  suppressEditorClickClearRef.current = false;
                  syncEditorText(true);
                  return;
                }
                setSelectedUploadItemIds((current) => current.size ? new Set() : current);
                syncEditorText(true);
              }}
              onPaste={pasteFiles}
              onCopy={copyComposerUploads}
              onKeyUp={() => syncEditorText(true)}
              onFocus={() => {
                scheduleLocalAgentProviderRefreshBurst();
                syncEditorText();
                setMentionMenuDismissed(false);
              }}
              onBlur={handleEditorBlur}
              onKeyDown={(event) => {
                if (
                  event.key.length === 1
                  && !event.metaKey
                  && !event.ctrlKey
                  && !event.altKey
                  && insertTextAfterUploadCaretAnchor(editorRef.current, event.key)
                ) {
                  event.preventDefault();
                  syncEditorText(true);
                  return;
                }
                const focusedUploadChip = document.activeElement instanceof HTMLElement
                  ? document.activeElement.closest<HTMLElement>("[data-upload-item-id]")
                  : null;
                if (focusedUploadChip) {
                  const itemId = focusedUploadChip.dataset.uploadItemId;
                  const item = uploadItems.find((candidate) => candidate.id === itemId);
                  if ((event.key === "Enter" || event.key === " ") && item) {
                    event.preventDefault();
                    void openUploadItem(item);
                    return;
                  }
                  if ((event.key === "Backspace" || event.key === "Delete") && itemId) {
                    event.preventDefault();
                    removeUploadItem(itemId);
                    requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }));
                    return;
                  }
                }
                if (
                  event.key.toLowerCase() === "a"
                  && (event.metaKey || event.ctrlKey)
                  && !event.altKey
                  && uploadItems.length > 0
                ) {
                  event.preventDefault();
                  selectAllComposerContent();
                  return;
                }
                if (
                  (event.key === "Backspace" || event.key === "Delete")
                  && !event.metaKey
                  && !event.ctrlKey
                  && !event.altKey
                  && !event.shiftKey
                  && deleteSelectedComposerContent()
                ) {
                  event.preventDefault();
                  return;
                }
                if (shouldReplaceSelectedUploadItems(event, selectedUploadItemIds)) {
                  removeUploadItems(selectedUploadItemIds);
                }
                if (event.key === "Backspace" || event.key === "Delete") {
                  const adjacentUploadItemId = findAdjacentUploadItemId(editorRef.current, event.key);
                  if (adjacentUploadItemId) {
                    event.preventDefault();
                    removeUploadItem(adjacentUploadItemId);
                    syncEditorText();
                    return;
                  }
                }
                if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentMentionChip(editorRef.current, event.key)) {
                  event.preventDefault();
                  syncEditorText();
                  return;
                }
                if (mentionMenuOpen && event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveMentionIndex((current) => (current + 1) % Math.max(mentionOptions.length, 1));
                  return;
                }
                if (mentionMenuOpen && event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveMentionIndex((current) => (current - 1 + Math.max(mentionOptions.length, 1)) % Math.max(mentionOptions.length, 1));
                  return;
                }
                if (mentionMenuOpen && event.key === "ArrowRight") {
                  event.preventDefault();
                  setActiveMentionTab((current) => {
                    const index = MENTION_PANEL_TABS.indexOf(current);
                    return MENTION_PANEL_TABS[(index + 1) % MENTION_PANEL_TABS.length]!;
                  });
                  return;
                }
                if (mentionMenuOpen && event.key === "ArrowLeft") {
                  event.preventDefault();
                  setActiveMentionTab((current) => {
                    const index = MENTION_PANEL_TABS.indexOf(current);
                    return MENTION_PANEL_TABS[(index - 1 + MENTION_PANEL_TABS.length) % MENTION_PANEL_TABS.length]!;
                  });
                  return;
                }
                if (mentionMenuOpen && (event.key === "Enter" || event.key === "Tab") && mentionOptions.length > 0) {
                  event.preventDefault();
                  selectMentionOption(mentionOptions[activeMentionIndex] ?? mentionOptions[0]!);
                  return;
                }
                if (event.key === "Escape") {
                  setMentionQuery(null);
                  return;
                }
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            </div>
          </div>
        </div>
        {props.activeRuns.length > 0 ? (
          <button
            className={"[width:40px] [height:40px] [border:0] [border-radius:999px] [color:var(--danger)] [background:#dc262612] [&:disabled]:[color:var(--muted)] [&:disabled]:[background:#00000008] [&:disabled]:[opacity:0.55]"}
            title={t("composer.stopResponses")}
            aria-label={t("composer.stopResponses")}
            onClick={cancelActiveRuns}
            disabled={cancelling}
          >
            <Square size={16} />
          </button>
        ) : null}
        <button className={"[display:inline-grid] [place-items:center] [border:0] [width:40px] [height:40px] [border-radius:999px] [color:var(--primary-contrast)] [background:var(--primary)] [&:disabled]:[color:var(--muted)] [&:disabled]:[background:#00000008] max-[760px]:[width:38px] max-[760px]:[height:38px]"} aria-label={t("composer.sendMessage")} onClick={send} disabled={sending}>
          {sending ? <Square size={18} /> : <Send size={18} />}
        </button>
      </div>
      {mentionMenuOpen
        ? createPortal(
            <div
              ref={mentionMenuRef}
              style={mentionMenuStyle}
              className={"[display:grid] [grid-template-rows:auto_minmax(0,_1fr)] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:18px] [background:var(--panel)] [box-shadow:0_14px_42px_rgb(0_0_0_/_12%)]"}
              role="listbox"
              aria-label={t("composer.mentionSuggestions")}
            >
              <div
                className={"[display:flex] [gap:4px] [overflow-x:auto] [border-bottom:1px_solid_var(--border)] [padding:6px_6px_0] [scrollbar-width:none] [&::-webkit-scrollbar]:[display:none]"}
                role="tablist"
                aria-label={t("composer.mentionSuggestions")}
              >
                {MENTION_PANEL_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeMentionTab === tab}
                    data-active={activeMentionTab === tab || undefined}
                    className={"[flex:0_0_auto] [border:0] [border-bottom:2px_solid_transparent] [border-radius:10px_10px_0_0] [padding:6px_10px] [color:var(--muted)] [background:transparent] [font-size:11px] [font-weight:600] [line-height:16px] [white-space:nowrap] [cursor:pointer] [transition:color_0.12s_ease,_background-color_0.12s_ease,_border-color_0.12s_ease] [&[data-active=true]]:[color:var(--text)] [&[data-active=true]]:[border-bottom-color:var(--primary)] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000008]"}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setActiveMentionTab(tab)}
                  >
                    {t(mentionTabI18nKey(tab))}
                  </button>
                ))}
              </div>
              <div ref={mentionMenuListRef} className={"[overflow-y:auto] [overflow-anchor:none] [padding:6px]"}>
          {referenceTabLoading ? (
            <div className={"[display:flex] [align-items:center] [gap:8px] [padding:8px_10px] [color:var(--muted)] [font-size:12px]"}>
              <LoaderCircle size={14} className={"animate-spin"} />
              <span>{t("composer.atMentionLoading")}</span>
            </div>
          ) : mentionOptions.length === 0 ? (
            <div className={"[padding:10px_12px] [color:var(--muted)] [font-size:12px] [line-height:18px]"}>
              {t("composer.atTabEmpty")}
            </div>
          ) : null}
          {(() => {
            let localAgentHeaderShown = false;
            let memberDividerShown = false;
            let participantHeaderShown = false;
            return mentionOptions.flatMap((option, index) => {
              const nodes: ReactNode[] = [];
              if (
                activeMentionTab === "members"
                && option.kind === "local-agent"
                && !localAgentHeaderShown
              ) {
                localAgentHeaderShown = true;
                nodes.push(
                  <div
                    key="mention-local-agent-header"
                    role="presentation"
                    className={"[padding:8px_10px_4px] [color:var(--muted)] [font-size:11px] [font-weight:500] [line-height:16px]"}
                  >
                    {t("composer.atSection.agent")}
                  </div>,
                );
              }
              if (
                activeMentionTab === "members"
                && option.kind === "participant"
                && localAgentHeaderShown
                && !memberDividerShown
              ) {
                memberDividerShown = true;
                nodes.push(
                  <div
                    key="mention-member-divider"
                    role="presentation"
                    className={"[margin:6px_6px_4px] [border-top:1px_solid_var(--border)]"}
                  />,
                );
              }
              if (
                activeMentionTab === "members"
                && option.kind === "participant"
                && !participantHeaderShown
              ) {
                participantHeaderShown = true;
                nodes.push(
                  <div
                    key="mention-likely-header"
                    role="presentation"
                    className={"[padding:8px_10px_4px] [color:var(--muted)] [font-size:11px] [font-weight:500] [line-height:16px]"}
                  >
                    {t("composer.likelyMentions")}
                  </div>,
                );
              }
              nodes.push(
                option.kind === "all" ? (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={index === activeMentionIndex}
                data-active={index === activeMentionIndex || undefined}
                className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:9px] [width:100%] [min-width:0] [min-height:38px] [border:0] [border-radius:12px] [padding:0_8px] [color:var(--text)] [text-align:left] [background:transparent] [transition:background-color_0.12s_ease] [&[data-active=true]]:[background:#00000014] [&:hover]:[background:#00000014]"}
                onMouseDown={(event) => {
                  event.preventDefault();
                  saveMentionSelection();
                  selectMentionOption(option);
                }}
                onMouseEnter={() => setActiveMentionIndex(index)}
              >
                <span className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border-radius:999px] [color:#ffffff] [background:var(--primary)] [box-shadow:inset_0_0_0_1px_#ffffff66]"}>
                  <AtSign size={14} />
                </span>
                <span className={"[display:inline-flex] [min-width:0] [align-items:baseline] [gap:6px]"}>
                  <strong className={"[font-size:12px] [font-weight:500] [line-height:16px]"}>{option.label}</strong>
                  <span className={"[color:var(--muted)] [font-size:11px] [line-height:16px] [white-space:nowrap]"}>
                    {t("composer.notifyEveryone")}
                  </span>
                </span>
              </button>
            ) : option.kind === "reference" ? (
              <div
                key={option.key}
                role="option"
                aria-selected={index === activeMentionIndex}
                data-active={index === activeMentionIndex || undefined}
                className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:9px] [width:100%] [min-width:0] [min-height:38px] [border-radius:12px] [padding:0_8px] [color:var(--text)] [transition:background-color_0.12s_ease] [&[data-active=true]]:[background:#00000014] [&:hover]:[background:#00000014]"}
                onMouseEnter={() => setActiveMentionIndex(index)}
              >
                <MentionReferenceFileIcon
                  providerId={option.providerId}
                  label={option.label}
                  roomFile={option.item.roomFile}
                  thumbnailUrl={option.thumbnailUrl}
                  onJump={option.item.roomFile ? () => focusRoomFileFromMention(option.item.roomFile!) : undefined}
                />
                <button
                  type="button"
                  className={"[display:grid] [min-width:0] [gap:1px] [width:100%] [border:0] [padding:0] [color:inherit] [text-align:left] [background:transparent] [&:focus-visible]:[outline:none]"}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    saveMentionSelection();
                    selectMentionOption(option);
                  }}
                >
                  <strong className={"[overflow:hidden] [font-size:12px] [font-weight:500] [line-height:16px] [text-overflow:ellipsis] [white-space:nowrap]"}>{option.label}</strong>
                  <span className={"[overflow:hidden] [color:var(--muted)] [font-size:11px] [line-height:14px] [text-overflow:ellipsis] [white-space:nowrap]"}>
                    {option.subtitle || t(`composer.atProvider.${option.providerId}`)}
                  </span>
                </button>
              </div>
            ) : option.kind === "local-agent" ? (
              <div
                key={option.key}
                role="option"
                aria-selected={index === activeMentionIndex}
                data-active={index === activeMentionIndex || undefined}
                className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:9px] [width:100%] [min-width:0] [height:38px] [border-radius:12px] [padding:0_8px] [color:var(--text)] [transition:background-color_0.12s_ease] [&[data-active=true]]:[background:#00000014] [&:hover]:[background:#00000014]"}
                onMouseEnter={() => setActiveMentionIndex(index)}
              >
                <MentionLocalAgentAvatar runtimeProfile={option.runtimeProfile} />
                <button
                  type="button"
                  className={"[display:grid] [min-width:0] [gap:1px] [width:100%] [border:0] [padding:0] [color:inherit] [text-align:left] [background:transparent] [&:focus-visible]:[outline:none]"}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    saveMentionSelection();
                    selectMentionOption(option);
                  }}
                >
                  <strong className={"[overflow:hidden] [font-size:12px] [font-weight:500] [line-height:16px] [text-overflow:ellipsis] [white-space:nowrap]"}>{option.label}</strong>
                  <span className={"[overflow:hidden] [color:var(--muted)] [font-size:11px] [line-height:14px] [text-overflow:ellipsis] [white-space:nowrap]"}>
                    {option.subtitle}
                  </span>
                </button>
              </div>
            ) : option.kind === "participant" ? (
              <div
                key={option.key}
                role="option"
                aria-selected={index === activeMentionIndex}
                data-active={index === activeMentionIndex || undefined}
                className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:9px] [width:100%] [min-width:0] [height:38px] [border-radius:12px] [padding:0_4px_0_8px] [color:var(--text)] [transition:background-color_0.12s_ease] [&[data-active=true]]:[background:#00000014] [&:hover]:[background:#00000014]"}
                onMouseEnter={() => setActiveMentionIndex(index)}
              >
                <MentionParticipantAvatar
                  participant={option.participant}
                  identities={props.identities}
                  runtimeProfiles={props.runtimeProfiles}
                />
                <div className={"[display:flex] [width:100%] [min-width:0] [align-items:center] [justify-content:flex-start] [gap:6px] [height:100%]"}>
                  <button
                    type="button"
                    className={`[display:inline-flex] [min-width:0] [align-items:center] [gap:6px] [height:100%] [overflow:hidden] [border:0] [padding:0] [color:inherit] [text-align:left] [background:transparent] [&:focus-visible]:[outline:none] [&_strong]:[min-width:0] [&_strong]:[overflow:hidden] [&_strong]:[font-size:12px] [&_strong]:[font-weight:500] [&_strong]:[line-height:16px] [&_strong]:[text-overflow:ellipsis] [&_strong]:[white-space:nowrap] ${WHISPER_FEATURE_ENABLED && option.participant.kind === "ai" ? "[max-width:calc(100%-36px)]" : "[width:100%]"}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      saveMentionSelection();
                      selectMentionOption(option);
                    }}
                  >
                    <strong>{option.label}</strong>
                    {option.participant.status === "muted" ? (
                      <span className={"[display:inline-flex] [flex:0_0_auto] [height:20px] [align-items:center] [border-radius:999px] [padding:0_7px] [color:#b45309] [background:#fef3c7] [font-size:10px] [font-weight:700]"}>
                        {t("composer.muted")}
                      </span>
                    ) : null}
                  </button>
                  {WHISPER_FEATURE_ENABLED && option.participant.kind === "ai" ? (
                    <button
                      type="button"
                      className={"[display:inline-grid] [flex:0_0_auto] [width:30px] [height:30px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [&:hover]:[color:#7c3aed] [&:hover]:[background:#f3e8ff] [&:focus-visible]:[outline:none] [&:focus-visible]:[box-shadow:0_0_0_2px_#ddd6fe]"}
                      aria-label={t("composer.whisperTo", { name: option.label })}
                      title={t("composer.whisper")}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        saveMentionSelection();
                        insertWhisperMention(option.participant);
                      }}
                    >
                      <Ear size={15} />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null,
              );
              return nodes;
            });
          })()}
              </div>
            </div>,
            document.body,
          )
        : null}
      <AttachmentPreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </footer>
  );
}

function MentionReferenceFileIcon(props: {
  providerId: TuttiAtProviderId;
  label: string;
  roomFile?: TuttiAtRoomFileMeta;
  thumbnailUrl?: string | null;
  onJump?: () => void;
}) {
  const size = 14;
  const [imageFailed, setImageFailed] = useState(false);
  const previewSource = props.roomFile?.previewUrl || props.thumbnailUrl;
  const previewUrl = resolveMentionThumbnailUrl(previewSource);
  const category = props.roomFile
    ? getArtifactCategory({
        mimeType: props.roomFile.mimeType,
        filename: props.label,
      } as Artifact)
    : null;

  useEffect(() => {
    setImageFailed(false);
  }, [previewUrl]);

  const fallbackIcon = (
    <span className={"[display:grid] [width:100%] [height:100%] [place-items:center] [color:#6d28d9] [background:#f3e8ff]"}>
      <MentionReferenceProviderIcon providerId={props.providerId} />
    </span>
  );

  const icon = category === "image" && previewUrl && !imageFailed ? (
    <img
      src={previewUrl}
      alt=""
      className={"[width:100%] [height:100%] [object-fit:cover]"}
      onError={() => setImageFailed(true)}
    />
  ) : category === "video" ? (
    <span className={"[display:grid] [width:100%] [height:100%] [place-items:center] [color:#ffffff] [background:#8d96a3]"}>
      <Video size={size} />
    </span>
  ) : props.roomFile ? (
    <span className={"[display:grid] [width:100%] [height:100%] [place-items:center] [color:#ffffff] [background:#8d96a3]"}>
      <FileText size={size} />
    </span>
  ) : previewUrl && !imageFailed ? (
    <img
      src={previewUrl}
      alt=""
      className={"[width:100%] [height:100%] [object-fit:cover]"}
      onError={() => setImageFailed(true)}
    />
  ) : (
    fallbackIcon
  );

  const shellClassName =
    "[display:inline-grid] [width:32px] [height:32px] [overflow:hidden] [border-radius:10px] [background:#f3f4f6]";

  if (!props.onJump) {
    return <span className={shellClassName}>{icon}</span>;
  }

  return (
    <button
      type="button"
      className={`${shellClassName} [border:0] [padding:0] [cursor:pointer] [transition:box-shadow_0.12s_ease,_transform_0.12s_ease] hover:[box-shadow:0_0_0_2px_#dbeafe] [&:focus-visible]:[outline:none] [&:focus-visible]:[box-shadow:0_0_0_2px_#93c5fd]`}
      aria-label={t("files.jumpToMessage")}
      title={t("files.jumpToMessage")}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onJump?.();
      }}
    >
      {icon}
    </button>
  );
}

function MentionReferenceProviderIcon(props: { providerId: TuttiAtProviderId }) {
  const size = 14;
  switch (props.providerId) {
    case "workspace-issue":
      return <LayoutList size={size} />;
    case "workspace-app":
      return <AppWindow size={size} />;
    case "agent-session":
      return <Bot size={size} />;
    case "agent-generated-file":
      return <FileOutput size={size} />;
    case "file":
    default:
      return <FileText size={size} />;
  }
}

function MentionLocalAgentAvatar(props: { runtimeProfile: RuntimeProfile }) {
  const style = getRuntimeProviderAvatarStyle(props.runtimeProfile.provider);
  const usesAppIcon = Boolean(style?.iconUrl);
  return (
    <span
      className={`[display:inline-grid] [width:32px] [height:32px] [overflow:hidden] [border-radius:10px] [place-items:center] ${usesAppIcon ? "[background:transparent]" : "[background:#f3f4f6]"}`}
      style={style && !usesAppIcon ? { background: style.background } : undefined}
    >
      {style?.iconUrl ? (
        <img
          src={style.iconUrl}
          alt=""
          className={usesAppIcon ? "[width:32px] [height:32px] [object-fit:cover]" : "[width:18px] [height:18px] [object-fit:contain]"}
        />
      ) : (
        <Bot size={14} className={"[color:#ffffff]"} />
      )}
    </span>
  );
}

function MentionParticipantAvatar(props: {
  participant: Participant;
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
}) {
  const identity = props.identities.find((item) => item.id === props.participant.identityId);
  const resolvedAvatar = resolveAgentAvatarFromContext({
    avatar: props.participant.avatar,
    icon: identity?.icon,
    runtimeProfileId: props.participant.runtimeProfileId,
    identity,
    runtimeProfiles: props.runtimeProfiles,
  });
  return (
    <AgentAvatar
      title={props.participant.displayName}
      avatar={resolvedAvatar.avatar}
      provider={resolvedAvatar.provider}
      size={32}
    />
  );
}

function clipboardFiles(dataTransfer: DataTransfer) {
  const files = Array.from(dataTransfer.files);
  const itemFiles = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const seen = new Set<string>();
  return [...files, ...itemFiles].filter((file) => {
    const key = `${file.type || "application/octet-stream"}:${file.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isPlaceholderAttachmentText(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return true;
  const label = attachmentLabel();
  return lines.every((line) => line === label);
}

function editorText(editor: HTMLDivElement | null) {
  return editor ? nodeTextValue(editor).replace(/\n$/, "") : "";
}

const COMPOSER_EDITOR_MIN_HEIGHT = 28;
const COMPOSER_EDITOR_MAX_HEIGHT = 168;

function resizeComposerEditor(editor: HTMLDivElement | null) {
  if (!editor) return;
  editor.style.height = "0px";
  const scrollHeight = editor.scrollHeight;
  const nextHeight = Math.min(
    COMPOSER_EDITOR_MAX_HEIGHT,
    Math.max(COMPOSER_EDITOR_MIN_HEIGHT, scrollHeight),
  );
  editor.style.height = `${nextHeight}px`;
  editor.style.overflowY = scrollHeight > COMPOSER_EDITOR_MAX_HEIGHT ? "auto" : "hidden";
}

function setEditorText(editor: HTMLDivElement | null, value: string, cursor: number) {
  if (!editor) return;
  editor.textContent = value;
  editor.focus();
  setCaretTextOffset(editor, cursor);
  resizeComposerEditor(editor);
}

function restoreEditorDraft(editor: HTMLDivElement | null, draft: ComposerDraft | null) {
  if (!editor) return;
  if (!draft) {
    setEditorText(editor, "", 0);
    return;
  }
  editor.innerHTML = draft.html;
  placeCaretAtEditorEnd(editor, { preventScroll: true });
  resizeComposerEditor(editor);
}

function isComposerEditorFocused(editor: HTMLDivElement) {
  const active = document.activeElement;
  return active === editor || (active instanceof Node && editor.contains(active));
}

function focusComposerWhenReady(
  getEditor: () => HTMLDivElement | null,
  options?: {
    preventScroll?: boolean;
    isCancelled?: () => boolean;
    onSuccess?: () => void;
  },
) {
  let attempt = 0;
  let cancelled = false;
  let frameId: number | null = null;
  let timerId: number | null = null;

  const tryFocus = () => {
    frameId = null;
    timerId = null;
    if (cancelled || options?.isCancelled?.()) return;
    const editor = getEditor();
    if (editor?.isConnected) {
      focusEditorAtEnd(editor, { preventScroll: options?.preventScroll });
      if (isComposerEditorFocused(editor)) {
        options?.onSuccess?.();
        return;
      }
    }
    attempt += 1;
    const delay = attempt <= 8 ? 0 : Math.min(80 * (attempt - 8), 500);
    if (delay === 0) {
      frameId = requestAnimationFrame(tryFocus);
    } else {
      timerId = window.setTimeout(tryFocus, delay);
    }
  };

  tryFocus();
  return () => {
    cancelled = true;
    if (frameId !== null) cancelAnimationFrame(frameId);
    if (timerId !== null) window.clearTimeout(timerId);
  };
}

function focusEditorAtEnd(editor: HTMLDivElement | null, options?: { preventScroll?: boolean }) {
  if (!editor) return;
  placeCaretAtEditorEnd(editor, options);
}

function placeCaretAtEditorEnd(editor: HTMLDivElement, options?: { preventScroll?: boolean }) {
  editor.focus({ preventScroll: options?.preventScroll ?? false });
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretTextOffset(editor: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return editorText(editor).length;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return editorText(editor).length;
  const beforeCaret = range.cloneRange();
  beforeCaret.selectNodeContents(editor);
  beforeCaret.setEnd(range.startContainer, range.startOffset);
  return rangeTextValue(beforeCaret).length;
}

function setCaretTextOffset(editor: HTMLDivElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  let remaining = Math.max(0, offset);
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node === editor) return NodeFilter.FILTER_SKIP;
      if (isAtomicEditorChip(node)) return NodeFilter.FILTER_ACCEPT;
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  let node = walker.nextNode();

  while (node) {
    const textLength = nodeTextValue(node).length;
    if (remaining <= textLength) {
      const range = document.createRange();
      if (isAtomicEditorChip(node)) {
        if (remaining === 0) {
          range.setStartBefore(node);
        } else {
          range.setStartAfter(node);
        }
      } else {
        range.setStart(node, Math.min(remaining, node.textContent?.length ?? 0));
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= textLength;
    node = walker.nextNode();
  }

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function replaceMentionQueryRange(queryRange: Range, label: string, mentionId: string, reference?: TuttiAtQueryResult): Text {
  const needsLeadingSpace = needsLeadingSpaceBeforeMentionRange(queryRange);
  const fragment = document.createDocumentFragment();
  if (needsLeadingSpace) fragment.append(document.createTextNode(" "));
  fragment.append(createMentionChip(label, mentionId, reference));
  const trailingSpace = document.createTextNode(" ");
  fragment.append(trailingSpace);
  queryRange.deleteContents();
  queryRange.insertNode(fragment);
  return trailingSpace;
}

function focusAfterTrailingSpace(trailingSpace: Text, editor: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(trailingSpace, trailingSpace.textContent?.length ?? 1);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus({ preventScroll: true });
}

function needsLeadingSpaceBeforeMentionRange(range: Range): boolean {
  const { startContainer, startOffset } = range;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    if (startOffset > 0) {
      return /\S/.test((startContainer.textContent ?? "")[startOffset - 1] ?? "");
    }
    let previous: Node | null = startContainer.previousSibling;
    while (previous) {
      if (isMentionChip(previous)) return true;
      if (previous.nodeType === Node.TEXT_NODE) {
        const value = previous.textContent ?? "";
        return value.length > 0 && !/\s$/.test(value);
      }
      previous = previous.previousSibling;
    }
  }
  return false;
}

function isInsideMentionChip(node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && (isMentionChip(current) || isWhisperChip(current))) return true;
    current = current.parentNode;
  }
  return false;
}

function cursorTextPoint(editor: HTMLDivElement): { node: Text; offset: number; segmentIndex: number } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !range.collapsed) return null;

  const segments = collectEditableTextSegments(editor);
  if (range.startContainer.nodeType === Node.TEXT_NODE && !isInsideMentionChip(range.startContainer)) {
    const index = segments.findIndex((segment) => segment.node === range.startContainer);
    if (index !== -1) {
      return { node: range.startContainer as Text, offset: range.startOffset, segmentIndex: index };
    }
  }

  if (range.startContainer === editor) {
    for (let index = range.startOffset - 1; index >= 0; index -= 1) {
      const child = editor.childNodes.item(index);
      if (!child) continue;
      if (child.nodeType === Node.TEXT_NODE && !isInsideMentionChip(child)) {
        const text = child.textContent ?? "";
        const segmentIndex = segments.findIndex((segment) => segment.node === child);
        if (segmentIndex === -1) return null;
        return { node: child as Text, offset: text.length, segmentIndex };
      }
      if (isMentionChip(child)) break;
    }
  }

  return null;
}

function collectEditableTextSegments(editor: HTMLDivElement): Array<{ node: Text }> {
  const segments: Array<{ node: Text }> = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isInsideMentionChip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    segments.push({ node: node as Text });
    node = walker.nextNode();
  }
  return segments;
}

function findActiveMentionQueryRange(editor: HTMLDivElement): Range | null {
  const cursor = cursorTextPoint(editor);
  if (!cursor) return null;

  const { node: endNode, offset: endOffset } = cursor;
  const endText = endNode.textContent ?? "";
  const before = endText.slice(0, endOffset);
  const atInNode = before.lastIndexOf("@");
  if (atInNode === -1) return null;

  const query = before.slice(atInNode + 1);
  if (/[\s@]/.test(query)) return null;

  const range = document.createRange();
  range.setStart(endNode, atInNode);
  range.setEnd(endNode, endOffset);
  return range;
}

function findActiveMentionQuery(editor: HTMLDivElement): string | null {
  const range = findActiveMentionQueryRange(editor);
  if (!range || rangeCrossesMentionChip(range)) return null;
  const raw = range.toString();
  if (!raw.startsWith("@")) return null;
  const query = raw.slice(1);
  if (/[\s@]/.test(query)) return null;
  return query;
}

function rangeCrossesMentionChip(range: Range): boolean {
  const fragment = range.cloneContents();
  return fragment.querySelector("[data-mention-chip='true']") !== null;
}

function removeTrailingPartialMentionQuery(editor: HTMLDivElement) {
  const range = findActiveMentionQueryRange(editor);
  if (!range) return;
  range.deleteContents();
}

function restoreComposerCaret(editor: HTMLDivElement, savedRange: Range | null, savedOffset: number | null) {
  const selection = window.getSelection();
  if (!selection) return false;
  if (savedRange && editor.contains(savedRange.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
    return true;
  }
  if (savedOffset !== null) {
    const range = textRange(editor, savedOffset, savedOffset);
    if (range) {
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
  }
  return false;
}

function needsLeadingSpaceBeforeCaret(range: Range, editor: HTMLDivElement): boolean {
  if (!range.collapsed) {
    return needsLeadingSpaceBeforeMentionRange(range);
  }
  const { startContainer, startOffset } = range;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    if (startOffset > 0) {
      return /\S/.test((startContainer.textContent ?? "")[startOffset - 1] ?? "");
    }
    let previous: Node | null = startContainer.previousSibling;
    while (previous) {
      if (isMentionChip(previous)) return true;
      if (previous.nodeType === Node.TEXT_NODE) {
        const value = previous.textContent ?? "";
        return value.length > 0 && !/\s$/.test(value);
      }
      previous = previous.previousSibling;
    }
  }
  if (startContainer === editor && startOffset > 0) {
    const previous = editor.childNodes.item(startOffset - 1);
    if (previous && isMentionChip(previous)) return true;
    if (previous?.nodeType === Node.TEXT_NODE) {
      const value = previous.textContent ?? "";
      return value.length > 0 && !/\s$/.test(value);
    }
  }
  return false;
}

function insertMentionChipAtCaret(editor: HTMLDivElement, label: string, mentionId: string): Text | null {
  removeTrailingPartialMentionQuery(editor);
  removeOrphanAtTextNodes(editor);

  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return appendMentionChipToEditor(editor, label, mentionId);
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) {
    return appendMentionChipToEditor(editor, label, mentionId);
  }

  if (!range.collapsed) {
    range.deleteContents();
  }

  const needsLeadingSpace = needsLeadingSpaceBeforeCaret(range, editor);
  const trailingSpace = document.createTextNode(" ");
  const fragment = document.createDocumentFragment();
  if (needsLeadingSpace) fragment.append(document.createTextNode(" "));
  fragment.append(createMentionChip(label, mentionId));
  fragment.append(trailingSpace);
  range.insertNode(fragment);
  return trailingSpace;
}

function appendMentionChipToEditor(editor: HTMLDivElement, label: string, mentionId: string): Text | null {
  removeTrailingPartialMentionQuery(editor);
  removeOrphanAtTextNodes(editor);

  const currentText = editorText(editor);
  const needsLeadingSpace = currentText.length > 0 && !/\s$/.test(currentText);
  const fragment = mentionFragment(label, mentionId, needsLeadingSpace, true);
  editor.appendChild(fragment);
  normalizeEditorAfterMentionInsert(editor);

  const lastChild = editor.lastChild;
  if (lastChild?.nodeType === Node.TEXT_NODE) return lastChild as Text;
  return null;
}

function normalizeEditorAfterMentionInsert(editor: HTMLDivElement) {
  removeOrphanAtTextNodes(editor);
  editor.normalize();
}

function removeOrphanAtTextNodes(editor: HTMLDivElement) {
  for (const node of [...editor.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const value = node.textContent ?? "";
    if (value === "@" || value === " @") {
      node.remove();
      continue;
    }
    if (/^@+$/.test(value.trim())) {
      node.remove();
    }
  }
}

function collectMentionTargetsFromEditor(editor: HTMLDivElement | null, participants: Participant[]): MentionTarget[] {
  if (!editor) return [];
  const byId = new Map(participants.map((participant) => [participant.id, participant]));
  const mentions: MentionTarget[] = [];
  for (const chip of editor.querySelectorAll("[data-mention-chip='true']")) {
    const element = chip as HTMLElement;
    const mentionId = element.dataset.mentionId;
    if (!mentionId) continue;
    if (mentionId === "all") {
      mentions.push({ participantId: "all", displayNameSnapshot: "all", mentionType: "all" });
      continue;
    }
    const parsedReference = parseTuttiAtMentionKey(mentionId);
    if (parsedReference || element.dataset.mentionKind === "reference") {
      const label = element.dataset.mentionLabel?.trim() || element.textContent?.replace(/^@/, "").trim() || parsedReference?.itemId || "reference";
      let referenceInsert: MentionTarget["referenceInsert"];
      if (element.dataset.mentionReferenceInsert) {
        try {
          referenceInsert = JSON.parse(element.dataset.mentionReferenceInsert) as MentionTarget["referenceInsert"];
        } catch {
          referenceInsert = undefined;
        }
      }
      const referenceScope = {
        ...(referenceInsert?.kind === "mention" ? referenceInsert.scope : {}),
        ...(element.dataset.mentionIconUrl?.trim() ? { iconUrl: element.dataset.mentionIconUrl.trim() } : {}),
      };
      mentions.push({
        participantId: mentionId,
        displayNameSnapshot: label,
        mentionType: "reference",
        referenceProviderId: parsedReference?.providerId,
        referenceEntityId: parsedReference?.itemId,
        referenceInsert,
        ...(Object.keys(referenceScope).length ? { referenceScope } : {}),
      });
      continue;
    }
    const participant = byId.get(mentionId);
    if (!participant) continue;
    mentions.push({
      participantId: participant.id,
      displayNameSnapshot: participant.displayName,
      mentionType: "participant",
    });
  }
  return mentions;
}

function insertMentionChipAtTextOffset(
  editor: HTMLDivElement,
  offset: number,
  label: string,
  mentionId: string,
  needsLeadingSpace: boolean,
  needsTrailingSpace: boolean,
) {
  const range = textRange(editor, offset, offset);
  if (!range) return;
  range.insertNode(mentionFragment(label, mentionId, needsLeadingSpace, needsTrailingSpace));
}

function mentionFragment(
  label: string,
  mentionId: string,
  leadingSpace: boolean,
  trailingSpace: boolean,
  reference?: TuttiAtQueryResult,
) {
  const fragment = document.createDocumentFragment();
  if (leadingSpace) fragment.append(document.createTextNode(" "));
  fragment.append(createMentionChip(label, mentionId, reference));
  if (trailingSpace) fragment.append(document.createTextNode(" "));
  return fragment;
}

function isStyledReferenceMention(reference: TuttiAtQueryResult) {
  return (
    reference.providerId === "file"
    || reference.providerId === "agent-generated-file"
    || reference.providerId === "agent-session"
    || reference.providerId === "workspace-app"
    || reference.providerId === "workspace-issue"
  );
}

function referenceLinkHref(reference: TuttiAtQueryResult) {
  if (reference.insert.kind === "markdown-link") return reference.insert.href;
  if (reference.insert.kind === "text") return reference.insert.text;
  if (reference.insert.kind === "mention") return reference.insert.entityId;
  return reference.itemId;
}

function tuttiMentionUrl(reference: TuttiAtQueryResult) {
  if (!isOpenableTuttiReferenceProvider(reference.providerId)) {
    return null;
  }
  return buildTuttiMentionHref(reference.providerId, reference.itemId, {
    referenceInsert: reference.insert,
    referenceScope: reference.insert.kind === "mention" ? reference.insert.scope : undefined,
  });
}

function createReferenceLinkIcon(reference: Pick<TuttiAtQueryResult, "providerId" | "itemId" | "thumbnailUrl">) {
  return createTuttiReferenceIconElement(reference.providerId, {
    appId: reference.itemId,
    iconUrl: resolveMentionThumbnailUrl(reference.thumbnailUrl),
  });
}

function createAgentLauncherLinkIcon(runtimeProvider: string) {
  const iconUrl = getRuntimeProviderAvatarIconUrl(runtimeProvider);
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.width = 14;
    img.height = 14;
    img.style.objectFit = "cover";
    img.style.borderRadius = "3px";
    return img;
  }
  return createTuttiReferenceIconElement("agent-session");
}

function appendStyledReferenceChipContent(chip: HTMLAnchorElement, label: string, reference: TuttiAtQueryResult) {
  chip.className = REFERENCE_MENTION_CHIP_CLASS;
  chip.style.color = "var(--accent)";

  const launcherRuntimeProvider = reference.providerId === "workspace-app"
    ? resolveAgentLauncherRuntimeProvider(reference.itemId)
    : null;
  const displayLabel = launcherRuntimeProvider
    ? splitAgentLauncherMentionLabel(label).name
    : label;

  const labelEl = document.createElement("span");
  labelEl.className = REFERENCE_MENTION_LABEL_CLASS;
  labelEl.style.color = "var(--accent)";
  labelEl.textContent = displayLabel;

  if (launcherRuntimeProvider) {
    const atEl = document.createElement("span");
    atEl.textContent = "@";
    const iconWrap = document.createElement("span");
    iconWrap.className = AGENT_LAUNCHER_MENTION_ICON_CLASS;
    iconWrap.append(createAgentLauncherLinkIcon(launcherRuntimeProvider));
    chip.append(atEl, iconWrap, labelEl);
    return;
  }

  const iconWrap = document.createElement("span");
  iconWrap.className = REFERENCE_MENTION_ICON_CLASS;
  iconWrap.append(createReferenceLinkIcon(reference));
  chip.append(iconWrap, labelEl);
}

function createMentionChip(label: string, mentionId: string, reference?: TuttiAtQueryResult) {
  if (reference && isStyledReferenceMention(reference)) {
    const chip = document.createElement("a");
    const mentionHref = tuttiMentionUrl(reference);
    chip.href = mentionHref ?? "#";
    if (mentionHref) {
      chip.target = "_blank";
      chip.rel = "noreferrer";
    }
    chip.contentEditable = "false";
    chip.dataset.mentionChip = "true";
    chip.dataset.mentionId = mentionId;
    chip.dataset.mentionLabel = label;
    chip.dataset.mentionInstanceId = crypto.randomUUID();
    chip.dataset.mentionKind = "reference";
    chip.dataset.mentionDisplayMode = "reference-link";
    chip.dataset.mentionReferenceProvider = reference.providerId;
    chip.dataset.mentionReferenceInsert = JSON.stringify(reference.insert);
    chip.dataset.mentionLinkHref = referenceLinkHref(reference);
    const iconUrl = resolveMentionThumbnailUrl(reference.thumbnailUrl);
    if (iconUrl) {
      chip.dataset.mentionIconUrl = iconUrl;
    }
    if (reference.roomFile) {
      chip.dataset.mentionRoomFile = JSON.stringify(reference.roomFile);
    }
    appendStyledReferenceChipContent(chip, label, reference);
    return chip;
  }

  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.mentionChip = "true";
  chip.dataset.mentionId = mentionId;
  chip.dataset.mentionLabel = label;
  chip.dataset.mentionInstanceId = crypto.randomUUID();
  chip.textContent = `@${label}`;
  if (reference) {
    chip.dataset.mentionKind = "reference";
    chip.dataset.mentionReferenceInsert = JSON.stringify(reference.insert);
    chip.className = [
      PARTICIPANT_MENTION_CLASS,
      "[color:#7c3aed]",
      "[font-weight:500]",
    ].join(" ");
    return chip;
  }
  chip.className = PARTICIPANT_MENTION_CLASS;
  return chip;
}

function createWhisperChip(label: string) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.whisperChip = "true";
  chip.textContent = label;
  chip.className = [
    "[display:inline-flex]",
    "[align-items:center]",
    "[gap:3px]",
    "[margin-inline:2px]",
    "[border:1px_dashed_#c4b5fd]",
    "[border-radius:999px]",
    "[padding:0_6px]",
    "[color:#7c3aed]",
    "[font-size:11px]",
    "[font-weight:600]",
    "[line-height:18px]",
    "[vertical-align:baseline]",
    "[white-space:nowrap]",
    "[background:#f5f3ff]",
  ].join(" ");
  return chip;
}

function removeWhisperChips(editor: HTMLDivElement) {
  for (const chip of editor.querySelectorAll("[data-whisper-chip='true']")) {
    chip.remove();
  }
}

function hasWhisperChipInEditor(editor: HTMLDivElement | null) {
  return Boolean(editor?.querySelector("[data-whisper-chip='true']"));
}

function attachWhisperChipBeforeTrailingSpace(editor: HTMLDivElement, trailingSpace: Text | null): Text {
  removeWhisperChips(editor);
  const whisper = createWhisperChip(t("composer.whisper"));
  if (trailingSpace?.parentNode) {
    trailingSpace.parentNode.insertBefore(whisper, trailingSpace);
    return trailingSpace;
  }
  const space = document.createTextNode(" ");
  editor.appendChild(whisper);
  editor.appendChild(space);
  return space;
}

function textRange(editor: HTMLDivElement, start: number, end: number) {
  const range = document.createRange();
  const startPoint = textPosition(editor, start);
  const endPoint = textPosition(editor, end);
  if (!startPoint || !endPoint) return null;
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function textPosition(editor: HTMLDivElement, offset: number) {
  let remaining = Math.max(0, offset);
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node === editor) return NodeFilter.FILTER_SKIP;
      if (isAtomicEditorChip(node)) return NodeFilter.FILTER_ACCEPT;
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  let node = walker.nextNode();
  let lastNode: Node = editor;

  while (node) {
    lastNode = node;
    const textLength = nodeTextValue(node).length;
    if (remaining <= textLength) {
      if (isAtomicEditorChip(node)) {
        return remaining === 0
          ? { node: node.parentNode ?? editor, offset: childIndex(node) }
          : { node: node.parentNode ?? editor, offset: childIndex(node) + 1 };
      }
      return { node, offset: Math.min(remaining, node.textContent?.length ?? 0) };
    }
    remaining -= textLength;
    node = walker.nextNode();
  }

  if (lastNode !== editor && lastNode.parentNode) {
    return { node: lastNode.parentNode, offset: childIndex(lastNode) + 1 };
  }
  return { node: editor, offset: editor.childNodes.length };
}

function nodeTextValue(node: Node) {
  if (isUploadItemChip(node)) return "";
  if (isWhisperChip(node)) return "";
  if (isMentionChip(node)) {
    if (node.dataset.mentionDisplayMode === "reference-link") {
      return serializeReferenceMentionChip(node);
    }
    return `@${node.dataset.mentionLabel ?? node.textContent?.replace(/^@/, "") ?? ""}`;
  }
  if (isMessageLinkChip(node)) return formatMessageLink(...parseMessageLinkIds(node.dataset.messageLinkId ?? ""));
  if (isSummaryLinkChip(node)) return formatSummaryLink(node.dataset.summaryLinkId ?? "");
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replaceAll("\u200b", "");
  let text = "";
  node.childNodes.forEach((child) => {
    text += nodeTextValue(child);
  });
  return text;
}

function rangeTextValue(range: Range) {
  const fragment = range.cloneContents();
  return nodeTextValue(fragment);
}

function isWhisperChip(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.whisperChip === "true";
}

function isMentionChip(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.mentionChip === "true";
}

function isMessageLinkChip(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && typeof node.dataset.messageLinkId === "string";
}

function isSummaryLinkChip(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && typeof node.dataset.summaryLinkId === "string";
}

function isUploadItemChip(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && typeof node.dataset.uploadItemId === "string";
}

function isAtomicEditorChip(node: Node): node is HTMLElement {
  return isMentionChip(node)
    || isWhisperChip(node)
    || isMessageLinkChip(node)
    || isSummaryLinkChip(node)
    || isUploadItemChip(node);
}

function childIndex(node: Node) {
  let index = 0;
  let current = node.previousSibling;
  while (current) {
    index += 1;
    current = current.previousSibling;
  }
  return index;
}

function isEmptyTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE && (node.textContent ?? "") === "";
}

function skipEmptyTextBackward(node: Node | null) {
  let current = node;
  while (current && isEmptyTextNode(current)) {
    current = current.previousSibling;
  }
  return current;
}

function skipEmptyTextForward(node: Node | null) {
  let current = node;
  while (current && isEmptyTextNode(current)) {
    current = current.nextSibling;
  }
  return current;
}

function deleteAdjacentMentionChip(editor: HTMLDivElement | null, key: "Backspace" | "Delete") {
  if (!editor) return false;
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return false;
  const candidate = key === "Backspace"
    ? previousEditableNode(range.startContainer, range.startOffset, editor)
    : nextEditableNode(range.startContainer, range.startOffset, editor);
  if (!candidate || !isAtomicEditorChip(candidate)) return false;
  const nextCaretParent = candidate.parentNode ?? editor;
  const nextCaretOffset = childIndex(candidate);
  const trailingEmpty = candidate.nextSibling;
  candidate.remove();
  if (trailingEmpty && isEmptyTextNode(trailingEmpty)) trailingEmpty.remove();
  const nextRange = document.createRange();
  nextRange.setStart(nextCaretParent, Math.min(nextCaretOffset, nextCaretParent.childNodes.length));
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function findAdjacentUploadItemId(editor: HTMLDivElement | null, key: "Backspace" | "Delete") {
  if (!editor) return null;
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return null;
  const candidate = key === "Backspace"
    ? previousEditableNode(range.startContainer, range.startOffset, editor)
    : nextEditableNode(range.startContainer, range.startOffset, editor);
  return candidate && isUploadItemChip(candidate) ? candidate.dataset.uploadItemId ?? null : null;
}

function previousEditableNode(container: Node, offset: number, editor: HTMLDivElement) {
  if (container.nodeType === Node.TEXT_NODE && offset > 0) return null;
  let node: Node | null = null;
  if (container.nodeType === Node.TEXT_NODE) {
    node = skipEmptyTextBackward(container.previousSibling);
  } else {
    node = skipEmptyTextBackward(container.childNodes[offset - 1] ?? null);
  }
  if (!node) {
    let parent: Node | null = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
    while (parent && parent !== editor) {
      node = skipEmptyTextBackward(parent.previousSibling);
      if (node) break;
      parent = parent.parentNode;
    }
  }
  if (!node || !editor.contains(node)) return null;
  return deepestRight(node);
}

function nextEditableNode(container: Node, offset: number, editor: HTMLDivElement) {
  if (container.nodeType === Node.TEXT_NODE && offset < (container.textContent?.length ?? 0)) return null;
  let node: Node | null = null;
  if (container.nodeType === Node.TEXT_NODE) {
    node = skipEmptyTextForward(container.nextSibling);
  } else {
    node = skipEmptyTextForward(container.childNodes[offset] ?? null);
  }
  if (!node) {
    let parent: Node | null = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
    while (parent && parent !== editor) {
      node = skipEmptyTextForward(parent.nextSibling);
      if (node) break;
      parent = parent.parentNode;
    }
  }
  if (!node || !editor.contains(node)) return null;
  return deepestLeft(node);
}

function deepestRight(node: Node): Node {
  let current = node;
  while (!isAtomicEditorChip(current) && current.lastChild) current = current.lastChild;
  return current;
}

function deepestLeft(node: Node): Node {
  let current = node;
  while (!isAtomicEditorChip(current) && current.firstChild) current = current.firstChild;
  return current;
}

function insertPlainTextAtCaret(value: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(value.replace(/\r\n?/g, "\n"));
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertComposerPasteAtCaret(
  value: string,
  labels: {
    getMessageLabel: (messageId: string) => string;
    getSummaryTask?: (taskId: string) => BackgroundTask | null;
  },
  context: ComposerPasteContext,
) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const segments = splitComposerPasteContent(value, context);
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  const inserted: Node[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      if (!segment.text) continue;
      const textNode = document.createTextNode(segment.text);
      fragment.append(textNode);
      inserted.push(textNode);
      continue;
    }
    if (segment.kind === "message") {
      const linkChip = createMessageLinkChip(segment.id, labels.getMessageLabel(segment.id));
      fragment.append(linkChip);
      inserted.push(linkChip);
      continue;
    }
    if (segment.kind === "summary") {
      const task = labels.getSummaryTask?.(segment.id) ?? null;
      const linkChip = createSummaryLinkChipElement(segment.id, task);
      fragment.append(linkChip);
      inserted.push(linkChip);
      continue;
    }
    if (segment.kind === "participant") {
      const chip = createMentionChip(segment.label, segment.participantId);
      fragment.append(chip);
      inserted.push(chip);
      continue;
    }
    const referenceTarget = buildReferencePasteTarget(segment.href, segment.label);
    if (referenceTarget) {
      const chip = createMentionChip(
        referenceTarget.chipLabel,
        referenceTarget.mentionId,
        referenceTarget.reference,
      );
      fragment.append(chip);
      inserted.push(chip);
      continue;
    }
    const fallbackText = document.createTextNode(segment.label);
    fragment.append(fallbackText);
    inserted.push(fallbackText);
  }
  if (!inserted.length) return;
  const trailingText = document.createTextNode("");
  fragment.append(trailingText);
  inserted.push(trailingText);
  range.insertNode(fragment);
  range.setStartAfter(inserted[inserted.length - 1]!);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertSummaryLinkAtCaret(taskId: string, task: BackgroundTask | null) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const chip = createSummaryLinkChipElement(taskId, task);
  range.insertNode(chip);
  const trailingText = document.createTextNode("");
  chip.after(trailingText);
  range.setStartAfter(trailingText);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function createMessageLinkChip(messageId: string, label: string) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.messageLinkId = messageId;
  chip.className = [
    "[display:inline-flex]",
    "[max-width:min(360px,_100%)]",
    "[align-items:center]",
    "[gap:6px]",
    "[border:1px_solid_var(--border)]",
    "[border-radius:10px]",
    "[padding:6px_10px]",
    "[color:#2563eb]",
    "[background:#ffffff]",
    "[font-size:13px]",
    "[font-weight:650]",
    "[line-height:18px]",
    "[vertical-align:middle]",
    "[white-space:nowrap]",
    "[box-shadow:0_1px_2px_rgb(0_0_0_/_4%)]",
  ].join(" ");
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  chip.append(createTuttiMessageLinkIconElement(), labelEl);
  return chip;
}

function insertUploadItemsAtCaret(editor: HTMLDivElement | null, items: UploadItem[]) {
  if (!editor || items.length === 0) return;
  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  } else {
    range = normalizeUploadCaretRange(range);
    range.deleteContents();
  }
  const fragment = document.createDocumentFragment();
  let lastCaretAnchor: HTMLElement | null = null;
  for (const item of items) {
    const chip = createUploadItemChip(item);
    const caretAnchor = createUploadCaretAnchor();
    fragment.append(chip, caretAnchor);
    lastCaretAnchor = caretAnchor;
  }
  range.insertNode(fragment);
  if (lastCaretAnchor) {
    const caretText = lastCaretAnchor.firstChild;
    if (caretText?.nodeType === Node.TEXT_NODE) {
      range.setStart(caretText, caretText.textContent?.length ?? 0);
    } else {
      range.setStart(lastCaretAnchor, lastCaretAnchor.childNodes.length);
    }
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  resizeComposerEditor(editor);
}

function normalizeUploadCaretRange(range: Range) {
  if (!range.collapsed) return range;
  const startElement = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  const caretAnchor = startElement?.closest<HTMLElement>("[data-upload-caret-anchor]");
  if (!caretAnchor) return range;
  const nextRange = document.createRange();
  nextRange.setStartAfter(caretAnchor);
  nextRange.collapse(true);
  return nextRange;
}

function createUploadItemChip(item: UploadItem) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.uploadItemId = item.id;
  chip.dataset.uploadMimeType = item.mimeType;
  chip.setAttribute("role", "button");
  chip.setAttribute("tabindex", "0");
  chip.setAttribute("aria-label", t("composer.previewFile", { filename: item.filename }));
  chip.title = item.filename;
  chip.className = item.mimeType.startsWith("image/") && item.previewUrl
    ? "group [position:relative] [display:inline-grid] [width:58px] [height:44px] [margin:2px_3px] [overflow:hidden] [vertical-align:bottom] [border:1px_solid_var(--border)] [border-radius:10px] [background:#00000008] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] [outline:none] [&[data-selected]]:[border-color:var(--primary)] [&[data-selected]]:[box-shadow:0_0_0_3px_#2563eb33] [&[data-error]]:[border-color:var(--danger)]"
    : "group [position:relative] [display:inline-flex] [max-width:220px] [height:32px] [margin:2px_3px] [align-items:center] [gap:7px] [vertical-align:bottom] [border:1px_solid_var(--border)] [border-radius:10px] [padding:4px_24px_4px_8px] [background:var(--panel)] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] [outline:none] [&[data-selected]]:[border-color:var(--primary)] [&[data-selected]]:[box-shadow:0_0_0_3px_#2563eb33] [&[data-error]]:[border-color:var(--danger)]";

  if (item.mimeType.startsWith("image/") && item.previewUrl) {
    const image = document.createElement("img");
    image.src = item.previewUrl;
    image.alt = "";
    image.draggable = false;
    image.className = "[width:100%] [height:100%] [object-fit:cover]";
    chip.append(image);
  } else {
    const label = document.createElement("span");
    label.className = "[min-width:0] [overflow:hidden] [font-size:12px] [font-weight:650] [line-height:16px] [text-overflow:ellipsis] [white-space:nowrap]";
    label.textContent = item.filename;
    const size = document.createElement("small");
    size.className = "[flex:0_0_auto] [color:var(--muted)] [font-size:11px] [line-height:14px]";
    size.textContent = formatBytes(item.sizeBytes);
    chip.append(label, size);
  }

  const remove = document.createElement("span");
  remove.dataset.uploadRemove = "true";
  remove.setAttribute("role", "button");
  remove.setAttribute("aria-label", `Remove ${item.filename}`);
  remove.title = `Remove ${item.filename}`;
  remove.textContent = "×";
  remove.className = "[position:absolute] [right:3px] [top:3px] [display:inline-grid] [width:18px] [height:18px] [place-items:center] [border-radius:999px] [color:var(--text)] [background:#fffffff0] [opacity:0] [font-size:14px] [line-height:18px] group-hover:[opacity:1]";
  chip.append(remove);
  return chip;
}

function createUploadCaretAnchor() {
  const anchor = document.createElement("span");
  anchor.dataset.uploadCaretAnchor = "true";
  anchor.className = "[display:inline-block] [min-width:1px] [height:20px] [line-height:20px] [vertical-align:bottom] [overflow:visible] [white-space:nowrap]";
  anchor.textContent = "\u200b";
  return anchor;
}

function insertTextAfterUploadCaretAnchor(editor: HTMLDivElement | null, text: string) {
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount) return false;
  const selectionRange = selection.getRangeAt(0);
  if (!selectionRange.collapsed) return false;
  const startElement = selectionRange.startContainer instanceof Element
    ? selectionRange.startContainer
    : selectionRange.startContainer.parentElement;
  const anchor = startElement?.closest<HTMLElement>("[data-upload-caret-anchor]");
  if (!anchor || !editor.contains(anchor)) return false;
  const textNode = document.createTextNode(text);
  anchor.after(textNode);
  const range = document.createRange();
  range.setStart(textNode, text.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}


function ensureUploadCaretAnchorAfter(chip: HTMLElement) {
  if (chip.nextSibling instanceof HTMLElement && chip.nextSibling.dataset.uploadCaretAnchor === "true") return;
  chip.after(createUploadCaretAnchor());
}

function syncUploadItemChips(editor: HTMLDivElement | null, items: UploadItem[]) {
  if (!editor) return;
  const itemsById = new Map(items.map((item) => [item.id, item]));
  for (const chip of editor.querySelectorAll<HTMLElement>("[data-upload-item-id]")) {
    const itemId = chip.dataset.uploadItemId;
    const item = itemId ? itemsById.get(itemId) : null;
    if (!itemId || !item) {
      chip.remove();
    } else {
      chip.dataset.uploadStatus = item.status;
      chip.toggleAttribute("data-error", item.status === "error");
      itemsById.delete(itemId);
      ensureUploadCaretAnchorAfter(chip);
    }
  }
  if (itemsById.size === 0) return;
  const missingItems = items.filter((item) => itemsById.has(item.id));
  const fragment = document.createDocumentFragment();
  for (const item of missingItems) fragment.append(createUploadItemChip(item), createUploadCaretAnchor());
  editor.append(fragment);
}

function uploadItemsInEditorOrder(editor: HTMLDivElement | null, items: UploadItem[]) {
  if (!editor || items.length < 2) return items;
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const ordered: UploadItem[] = [];
  for (const chip of editor.querySelectorAll<HTMLElement>("[data-upload-item-id]")) {
    const itemId = chip.dataset.uploadItemId;
    const item = itemId ? itemsById.get(itemId) : null;
    if (!item) continue;
    ordered.push(item);
    itemsById.delete(item.id);
  }
  for (const item of items) {
    if (itemsById.has(item.id)) ordered.push(item);
  }
  return ordered;
}

function serializeComposerMessageParts(
  editor: HTMLDivElement | null,
  artifactsByUploadItemId: Map<string, Artifact>,
): NonNullable<import("@group-chat/shared").SendMessageRequest["parts"]> {
  if (!editor) return [];
  const parts: NonNullable<import("@group-chat/shared").SendMessageRequest["parts"]> = [];
  let text = "";
  const flushText = () => {
    const content = text.replaceAll("\u200b", "");
    text = "";
    if (content.trim()) parts.push({ type: "text", content });
  };
  const visit = (node: Node) => {
    if (node instanceof HTMLElement && node.dataset.uploadItemId) {
      flushText();
      const artifact = artifactsByUploadItemId.get(node.dataset.uploadItemId);
      if (artifact) parts.push({ type: "artifact", artifactId: artifact.id });
      return;
    }
    if (node instanceof Text) {
      text += node.textContent ?? "";
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of editor.childNodes) visit(child);
  flushText();
  return parts;
}

function uploadItemIdsInSelection(editor: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return [];
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return [];
  return [...editor.querySelectorAll<HTMLElement>("[data-upload-item-id]")]
    .filter((chip) => selection.containsNode(chip, true))
    .map((chip) => chip.dataset.uploadItemId)
    .filter((itemId): itemId is string => Boolean(itemId));
}

function storeComposerUploadClipboardSnapshot(token: string, items: UploadItem[]) {
  composerUploadClipboardSnapshots.set(token, items);
  while (composerUploadClipboardSnapshots.size > COMPOSER_UPLOAD_CLIPBOARD_CACHE_LIMIT) {
    const oldestToken = composerUploadClipboardSnapshots.keys().next().value;
    if (typeof oldestToken !== "string") break;
    composerUploadClipboardSnapshots.delete(oldestToken);
  }
}

function composerTextInSelection(editor: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return "";
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return "";
  const container = document.createElement("div");
  container.append(range.cloneContents());
  container.querySelectorAll("[data-upload-item-id]").forEach((node) => node.remove());
  container.querySelectorAll<HTMLElement>("[data-upload-caret-anchor]").forEach((anchor) => {
    anchor.replaceWith(document.createTextNode((anchor.textContent ?? "").replaceAll("\u200b", "")));
  });
  return (container.textContent ?? "").replaceAll("\u200b", "");
}

function readComposerUploadClipboard(clipboardData: DataTransfer) {
  const raw = clipboardData.getData(COMPOSER_UPLOAD_CLIPBOARD_MIME).trim();
  if (!raw) return { token: "", itemIds: [] as string[], text: "" };
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; itemIds?: unknown; text?: unknown };
    return {
      token: typeof parsed.token === "string" ? parsed.token : "",
      itemIds: Array.isArray(parsed.itemIds)
        ? parsed.itemIds.filter((itemId): itemId is string => typeof itemId === "string" && itemId.length > 0)
        : [],
      text: typeof parsed.text === "string" ? parsed.text : "",
    };
  } catch {
    return { token: "", itemIds: [] as string[], text: "" };
  }
}

function removeUploadItemChip(editor: HTMLDivElement | null, itemId: string) {
  const chip = editor?.querySelector<HTMLElement>(`[data-upload-item-id="${CSS.escape(itemId)}"]`);
  const caretAnchor = chip?.nextSibling;
  chip?.remove();
  if (
    caretAnchor instanceof HTMLElement
    && caretAnchor.dataset.uploadCaretAnchor === "true"
    && !(caretAnchor.textContent ?? "").replaceAll("\u200b", "")
  ) {
    caretAnchor.remove();
  }
  resizeComposerEditor(editor);
}

interface UploadItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string | null;
  status: "pending" | "uploading" | "uploaded" | "error";
  file: File;
  artifact?: Artifact;
  error?: string;
}

interface ComposerQuote {
  messageId: string;
  sender: string;
  content: string;
}

interface ComposerDraft {
  html: string;
  text: string;
  editingMessageId: string | null;
  editingMentions: MentionTarget[];
  quotes: ComposerQuote[];
  uploadItems: UploadItem[];
  mentionedIds: string[];
  mentionedAll: boolean;
}

function isEmptyComposerDraft(draft: ComposerDraft) {
  return !draft.text.trim()
    && !draft.html.trim()
    && !draft.editingMessageId
    && draft.editingMentions.length === 0
    && draft.quotes.length === 0
    && draft.uploadItems.length === 0
    && draft.mentionedIds.length === 0
    && !draft.mentionedAll;
}

function shouldReplaceSelectedUploadItems(
  event: ReactKeyboardEvent<HTMLDivElement>,
  selectedUploadItemIds: Set<string>,
) {
  return (
    selectedUploadItemIds.size > 0
    && event.key.length === 1
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.nativeEvent.isComposing
  );
}

function QuoteComposerBar(props: { quotes: ComposerQuote[]; onRemove: () => void }) {
  const { t } = useTranslation();
  const [firstQuote, ...restQuotes] = props.quotes;
  if (!firstQuote) return null;
  return (
    <div className={"[display:grid] [grid-template-columns:24px_minmax(0,_1fr)] [align-items:start] [gap:6px] [border-radius:8px] [padding:6px_8px] [background:#00000008] [color:#8a8f98] [font-size:13px] [line-height:20px]"}>
      <button
        type="button"
        className={"[display:inline-grid] [width:20px] [height:20px] [place-items:center] [border:0] [border-radius:4px] [color:#8a8f98] [background:transparent] [&:hover]:[color:var(--text)] [&:hover]:[background:#0000000c]"}
        aria-label={t("composer.removeQuote")}
        title={t("composer.removeQuote")}
        onClick={props.onRemove}
      >
        <X size={14} />
      </button>
      <span className={"[display:grid] [min-width:0] [gap:2px]"}>
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {props.quotes.length > 1
            ? t("composer.quoteCount", { count: props.quotes.length })
            : t("composer.replyTo", { sender: firstQuote.sender, content: compactQuoteContent(firstQuote.content) })}
        </span>
        {props.quotes.length > 1 ? (
          <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap] [color:#9aa1ad] [font-size:12px]"}>
            {firstQuote.sender}: {compactQuoteContent(firstQuote.content)}
            {restQuotes.length ? t("composer.quoteMore", { count: restQuotes.length + 1 }) : ""}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function formatQuotesForMessage(quotes: ComposerQuote[]) {
  return quotes
    .map((quote) => t("composer.replyQuoteBlock", { sender: quote.sender, content: compactQuoteContent(quote.content) }))
    .join("\n");
}

function compactQuoteContent(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 120);
}

function uploadItemIdsCrossedByLeftDrag(
  container: HTMLElement,
  startX: number,
  currentX: number,
  currentY: number,
) {
  const selectedIds = new Set<string>();
  if (currentX >= startX) return selectedIds;
  for (const element of container.querySelectorAll<HTMLElement>("[data-upload-item-id]")) {
    const rect = element.getBoundingClientRect();
    const crossesHorizontally = rect.left <= startX && currentX <= rect.right;
    const staysOnRow = currentY >= rect.top - 4 && currentY <= rect.bottom + 4;
    if (!crossesHorizontally || !staysOnRow) continue;
    const itemId = element.dataset.uploadItemId;
    if (itemId) selectedIds.add(itemId);
  }
  return selectedIds;
}

function revokePreviewUrl(previewUrl: string | null) {
  if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
}

type MentionOption =
  | { kind: "all"; key: "all"; label: string }
  | { kind: "participant"; key: string; label: string; participant: Participant }
  | LocalAgentMentionOption
  | {
      kind: "reference";
      key: string;
      label: string;
      subtitle?: string;
      thumbnailUrl?: string | null;
      providerId: TuttiAtProviderId;
      item: TuttiAtQueryResult;
    };

function buildParticipantMentionOptions(
  participants: Participant[],
  query: string | null,
  mentionedIds: Set<string>,
  mentionedAll: boolean,
  options?: { includeEveryone?: boolean },
): MentionOption[] {
  if (query === null) return [];
  const normalizedQuery = query.toLowerCase();
  const results: MentionOption[] = [];
  const everyoneLabel = t("composer.everyone");
  if (
    options?.includeEveryone
    && !mentionedAll
    && (everyoneLabel.toLowerCase().includes(normalizedQuery) || "所有人".includes(normalizedQuery) || "all".includes(normalizedQuery))
  ) {
    results.push({ kind: "all", key: "all", label: everyoneLabel });
  }
  const matchingParticipants = participants
    .filter((participant) => !mentionedIds.has(participant.id) && participant.displayName.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      return right.sortOrder - left.sortOrder;
    });
  for (const participant of matchingParticipants) {
    results.push({
      kind: "participant",
      key: participant.id,
      label: participant.displayName,
      participant,
    });
  }
  return results;
}
