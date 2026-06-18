import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AppWindow, Bot, Ear, FileOutput, FileText, ImageIcon, LayoutList, LoaderCircle, Paperclip, Send, Square, Users, Video, X } from "lucide-react";
import type { AgentRun, Artifact, Conversation, Identity, LocalAgentProviderStatus, MentionTarget, Message, Participant, Room, RuntimeProfile, TuttiAtProviderId } from "@group-chat/shared";
import { resolveArtifactLinkedMessageId } from "@group-chat/shared";
import { cancelRun, sendMessage, updateMessage, uploadArtifact } from "../../../api/client.js";
import { getArtifactCategory, revealArtifactInTuttiFileManager, resolveArtifactPublicUrl } from "../../artifact-actions.js";
import { formatBytes, fileToBase64 } from "../../formatting.js";
import {
  clearArtifactClipboardStash,
  findEmbeddedLinks,
  formatMessageLink,
  formatMessageLinkLabel,
  formatSummaryLink,
  parseMessageLinkIds,
  readArtifactClipboardFromDataTransfer,
  readStashedSummaryLink,
  SUMMARY_LINK_MIME,
  summaryLinkLabel,
} from "../../chat-links.js";
import { resolveArtifactsByIds } from "../../message-artifacts.js";
import type { BackgroundTask } from "../../background-tasks.js";
import { markMessageGroupBreak, MESSAGE_GROUP_IDLE_MS } from "../../message-group-breaks.js";
import { AttachmentPreviewDialog, isTextAttachment, type AttachmentPreview } from "./AttachmentPreviewDialog.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";
import { resolveAgentAvatarFromContext } from "../../identity-avatar.js";
import { WHISPER_FEATURE_ENABLED } from "../../feature-flags.js";
import { attachmentLabel, useTranslation, t } from "../../i18n/index.js";
import { tryOpenArtifactInTutti, tryOpenFileInTuttiSync, buildTuttiMentionHref, isOpenableTuttiReferenceProvider } from "../../tutti-bridge.js";
import { openReferenceMentionTarget } from "../../reference-mention-open.js";
import {
  parseTuttiAtMentionKey,
  queryTuttiAtMentions,
  readCachedTuttiAtMentions,
  isTuttiAtMentionCacheReady,
  roomFileMentionCacheFingerprint,
  resolveMentionThumbnailUrl,
  tuttiAtMentionKey,
  type TuttiAtQueryResult,
  type TuttiAtRoomFileMeta,
} from "../../tutti-at-mentions.js";
import { serializeReferenceMentionChip } from "../../reference-mentions.js";
import { mentionTabProviders } from "../../mention-panel-tabs.js";
import { REFERENCE_MENTION_CHIP_CLASS, REFERENCE_MENTION_COLOR } from "./reference-mention-chip.js";
import {
  MENTION_PANEL_TABS,
  mentionTabI18nKey,
  referenceProviderToMentionTab,
  type MentionPanelTab,
} from "../../mention-panel-tabs.js";

const MENTION_MENU_Z_INDEX = 90;

export function Composer(props: {
  conversation: Conversation;
  conversationId: string;
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
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
  summaryTasks: BackgroundTask[];
  userDisplayName: string;
  artifacts: Artifact[];
  onFocusRoomFile?: (input: { messageId: string; artifactId: string }) => void;
  composerRequest:
    | { type: "insert"; seq: number; content: string }
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
  const [activeMentionTab, setActiveMentionTab] = useState<MentionPanelTab>("members");
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const handledMentionRequestSeqRef = useRef(0);
  const handledComposerRequestSeqRef = useRef(0);
  const removedUploadIdsRef = useRef<Set<string>>(new Set());
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const mentionSelectionRef = useRef<Range | null>(null);
  const mentionQueryRangeRef = useRef<Range | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const [mentionMenuStyle, setMentionMenuStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const composerCaretOffsetRef = useRef<number | null>(null);
  const lastComposerInputAtRef = useRef(Date.now());
  const composerIdleBreakPendingRef = useRef(false);
  const roomMembers = props.participants.filter((participant) => participant.status !== "removed");
  const mentionableAgents = roomMembers.filter((participant) => participant.kind === "ai");
  const allMentionableParticipants = useMemo(() => roomMembers, [roomMembers]);
  const memberMentionOptions = useMemo(
    () => buildParticipantMentionOptions(roomMembers, mentionQuery, mentionedIds, mentionedAll, { includeEveryone: true }),
    [roomMembers, mentionQuery, mentionedIds, mentionedAll],
  );
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
    return {
      members: memberMentionOptions,
      files: referencesByTab.files,
      sessions: referencesByTab.sessions,
      apps: referencesByTab.apps,
      tasks: referencesByTab.tasks,
    };
  }, [memberMentionOptions, referenceMentionOptions]);
  const mentionOptions = mentionOptionsByTab[activeMentionTab] ?? [];
  const roomArtifacts = useMemo(
    () => props.artifacts.filter((artifact) => artifact.roomId === props.conversation.roomId),
    [props.artifacts, props.conversation.roomId],
  );
  const roomFileFingerprint = useMemo(
    () => roomFileMentionCacheFingerprint(roomArtifacts, props.conversation.roomId),
    [roomArtifacts, props.conversation.roomId],
  );

  useEffect(() => {
    if (mentionQuery === null) {
      setExternalMentionOptions([]);
      setExternalMentionsLoading(false);
      return;
    }
    const tabProviders = mentionTabProviders(activeMentionTab);
    if (tabProviders === null) {
      setExternalMentionOptions([]);
      setExternalMentionsLoading(false);
      return;
    }
    let cancelled = false;
    const cacheReady = isTuttiAtMentionCacheReady(tabProviders, {
      roomId: props.conversation.roomId,
      roomFileFingerprint,
    });
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
    setExternalMentionsLoading(!cacheReady);
    if (cacheReady && cachedItems) return;
    void queryTuttiAtMentions({
      keyword: mentionQuery,
      roomId: props.conversation.roomId,
      maxResults: 20,
      providers: tabProviders,
      roomArtifacts,
    }).then((items) => {
      if (cancelled) return;
      setExternalMentionOptions(items);
      setExternalMentionsLoading(false);
      setActiveMentionIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionQuery, props.conversation.roomId, activeMentionTab, roomArtifacts, roomFileFingerprint]);
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
      const artifacts = await uploadQueuedItems(uploadItems);
      const editorMentions = collectMentionTargetsFromEditor(editorRef.current, allMentionableParticipants);
      const isWhisper = WHISPER_FEATURE_ENABLED && hasWhisperChipInEditor(editorRef.current);
      const result = await props.onSend(props.conversationId, {
        content: quotes.length ? `${formatQuotesForMessage(quotes)}\n\n${text}` : text,
        artifactIds: artifacts.map((artifact) => artifact.id),
        parentMessageId: quotes.length === 1 ? quotes[0]!.messageId : null,
        mentions: editorMentions,
        visibility: isWhisper ? "whisper" : "public",
        senderName: props.userDisplayName.trim() || undefined,
      });
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
  };

  const resolvePastedArtifacts = (clipboardData: DataTransfer) => {
    const payload = readArtifactClipboardFromDataTransfer(clipboardData);
    if (!payload?.artifactIds.length) {
      return { artifacts: [] as Artifact[], includeText: true, preferOverClipboardFiles: false };
    }
    const artifacts = resolveArtifactsByIds(payload.artifactIds, props.artifacts);
    let preferOverClipboardFiles = payload.preferOverClipboardFiles;
    if (!preferOverClipboardFiles && artifacts.length > 0) {
      const files = clipboardFiles(clipboardData);
      const onlyClipboardImages = files.length > 0 && files.every((file) => file.type.startsWith("image/"));
      const hasNonImageArtifact = artifacts.some((artifact) => !artifact.mimeType.startsWith("image/"));
      if (onlyClipboardImages && hasNonImageArtifact) {
        preferOverClipboardFiles = true;
      }
    }
    return {
      artifacts,
      includeText: payload.includeText,
      preferOverClipboardFiles,
    };
  };

  const applyPastedArtifacts = (
    pastedArtifactClipboard: ReturnType<typeof resolvePastedArtifacts>,
    pastedText: string,
  ) => {
    if (pastedArtifactClipboard.artifacts.length > 0) {
      queueExistingArtifacts(pastedArtifactClipboard.artifacts);
      clearArtifactClipboardStash();
    }
    if (
      pastedArtifactClipboard.includeText
      && pastedText.trim()
      && !isPlaceholderAttachmentText(pastedText)
    ) {
      insertTextOrLinkChipsAtCaret(pastedText, {
        getMessageLabel: (messageIdSegment) => formatMessageLinkLabel(
          messageIdSegment,
          props.allMessages,
          props.allParticipants,
          props.identities,
          props.userDisplayName,
        ),
        getSummaryLabel: (taskId) => summaryLinkLabel(props.summaryTasks.find((task) => task.id === taskId)),
      });
      requestAnimationFrame(() => syncEditorText(true));
    }
    focusComposerAfterAttachmentInsert();
  };

  const uploadQueuedItems = async (items: UploadItem[]) => {
    const artifacts: Artifact[] = [];
    for (const item of items) {
      if (item.artifact) {
        artifacts.push(item.artifact);
        continue;
      }
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
          continue;
        }
        artifacts.push(result.artifact);
        setUploadItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id ? { ...currentItem, status: "uploaded" as const, artifact: result.artifact } : currentItem,
          ),
        );
      } catch (error) {
        if (removedUploadIdsRef.current.has(item.id)) {
          revokePreviewUrl(item.previewUrl);
          if (item.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
          continue;
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
      }
    }
    return artifacts;
  };

  const pasteFiles = (event: ClipboardEvent<HTMLDivElement>) => {
    const pastedArtifactClipboard = resolvePastedArtifacts(event.clipboardData);
    const pastedText = event.clipboardData.getData("text/plain");
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
      insertSummaryLinkAtCaret(taskId, summaryLinkLabel(
        props.summaryTasks.find((task) => task.id === taskId),
      ));
      requestAnimationFrame(() => syncEditorText(true));
      return;
    }

    if (pastedArtifactClipboard.preferOverClipboardFiles) {
      event.preventDefault();
      applyPastedArtifacts(pastedArtifactClipboard, pastedText);
      return;
    }

    const files = clipboardFiles(event.clipboardData);
    if (files.length > 0) {
      event.preventDefault();
      queueFiles(files);
      focusComposerAfterAttachmentInsert();
      return;
    }

    if (pastedArtifactClipboard.artifacts.length > 0) {
      event.preventDefault();
      applyPastedArtifacts(pastedArtifactClipboard, pastedText);
      return;
    }

    if (!pastedText) return;
    event.preventDefault();
    insertTextOrLinkChipsAtCaret(pastedText, {
      getMessageLabel: (messageIdSegment) => formatMessageLinkLabel(
        messageIdSegment,
        props.allMessages,
        props.allParticipants,
        props.identities,
        props.userDisplayName,
      ),
      getSummaryLabel: (taskId) => summaryLinkLabel(props.summaryTasks.find((task) => task.id === taskId)),
    });
    requestAnimationFrame(() => syncEditorText(true));
  };

  const removeUploadItem = (itemId: string) => {
    removedUploadIdsRef.current.add(itemId);
    const item = uploadItems.find((candidate) => candidate.id === itemId);
    revokePreviewUrl(item?.previewUrl ?? null);
    if (item?.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
    setUploadItems((current) => current.filter((candidate) => candidate.id !== itemId));
  };

  const openUploadItem = async (item: UploadItem) => {
    if (item.artifact && await tryOpenArtifactInTutti(item.artifact)) {
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

  useEffect(() => {
    return () => {
      for (const previewUrl of previewUrlsRef.current) revokePreviewUrl(previewUrl);
      previewUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setActiveMentionIndex((current) => (mentionOptions.length ? Math.min(current, mentionOptions.length - 1) : 0));
  }, [mentionOptions.length, activeMentionTab]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMentionTab]);

  useEffect(() => {
    handledMentionRequestSeqRef.current = 0;
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
    const nextText = text ? `${text}${text.endsWith("\n") ? "" : "\n"}${request.content}` : request.content;
    setText(nextText);
    setMentionQuery(null);
    requestAnimationFrame(() => setEditorText(editorRef.current, nextText, nextText.length));
  }, [props.composerRequest, text]);

  const mentionMenuVisible = mentionQuery !== null;
  const mentionMenuOpen = mentionMenuVisible && !mentionMenuDismissed;
  const referenceTabLoading = externalMentionsLoading && activeMentionTab !== "members";

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
            <PendingAttachmentTray
              uploadItems={uploadItems}
              onRemoveUpload={removeUploadItem}
              onOpenUpload={openUploadItem}
            />
            <div className={"[position:relative] [min-width:160px] [flex:1_1_180px] [min-height:28px] [display:grid] [align-items:start]"}>
            {!text && t("composer.placeholder").trim() ? (
              <span className={"[pointer-events:none] [position:absolute] [left:0] [top:4px] [color:#17171755] [font-size:13px] [line-height:20px]"}>
                {t("composer.placeholder")}
              </span>
            ) : null}
            <div
              ref={editorRef}
              role="textbox"
              aria-label={t("composer.input")}
              aria-multiline="true"
              contentEditable
              suppressContentEditableWarning
              className={"[min-height:28px] [max-height:168px] [overflow-y:hidden] [outline:none] [white-space:pre-wrap] [overflow-wrap:anywhere] [color:var(--text)] [font-size:13px] [line-height:20px] [padding:4px_0] empty:before:[content:'']"}
              onInput={() => syncEditorText(true)}
              onMouseDown={(event) => {
                const linkChip = (event.target as Element).closest('[data-mention-display-mode="reference-link"]');
                if (linkChip) event.preventDefault();
              }}
              onClick={(event) => {
                const linkChip = (event.target as Element).closest('[data-mention-display-mode="reference-link"]');
                if (linkChip instanceof HTMLElement) {
                  event.preventDefault();
                  openFileReferenceFromChip(linkChip);
                  return;
                }
                syncEditorText(true);
              }}
              onPaste={pasteFiles}
              onKeyUp={() => syncEditorText(true)}
              onFocus={() => {
                syncEditorText();
                setMentionMenuDismissed(false);
              }}
              onBlur={handleEditorBlur}
              onKeyDown={(event) => {
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
              <div className={"[overflow-y:auto] [padding:6px]"}>
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
          {mentionOptions.map((option, index) => (
            option.kind === "all" ? (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={index === activeMentionIndex}
                data-active={index === activeMentionIndex || undefined}
                className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:9px] [width:100%] [min-width:0] [height:38px] [border:0] [border-radius:12px] [padding:0_8px] [color:var(--text)] [text-align:left] [background:transparent] [transition:background-color_0.12s_ease] [&[data-active=true]]:[background:#00000014] [&:hover]:[background:#00000014] [&_strong]:[display:block] [&_strong]:[min-width:0] [&_strong]:[overflow:hidden] [&_strong]:[font-size:12px] [&_strong]:[font-weight:500] [&_strong]:[line-height:16px] [&_strong]:[text-overflow:ellipsis] [&_strong]:[white-space:nowrap]"}
                onMouseDown={(event) => {
                  event.preventDefault();
                  saveMentionSelection();
                  selectMentionOption(option);
                }}
                onMouseEnter={() => setActiveMentionIndex(index)}
              >
                <span className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border-radius:999px] [color:#ffffff] [background:var(--primary)] [box-shadow:inset_0_0_0_1px_#ffffff66]"}>
                  <Users size={14} />
                </span>
                <span className={"[display:inline-flex] [min-width:0] [align-items:center] [gap:6px]"}>
                  <strong>{option.label}</strong>
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
            ) : null
            ))}
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

function editorHasExplicitLineBreak(editor: HTMLDivElement) {
  if (editorText(editor).includes("\n")) return true;
  return editor.querySelector("br") !== null;
}

function resizeComposerEditor(editor: HTMLDivElement | null) {
  if (!editor) return;
  if (!editorHasExplicitLineBreak(editor)) {
    editor.style.height = `${COMPOSER_EDITOR_MIN_HEIGHT}px`;
    editor.style.overflowY = "hidden";
    return;
  }
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

function focusEditorAtEnd(editor: HTMLDivElement | null) {
  if (!editor) return;
  placeCaretAtEditorEnd(editor);
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
      mentions.push({
        participantId: mentionId,
        displayNameSnapshot: label,
        mentionType: "reference",
        referenceProviderId: parsedReference?.providerId,
        referenceEntityId: parsedReference?.itemId,
        referenceInsert,
        ...(referenceInsert?.kind === "mention" ? { referenceScope: referenceInsert.scope } : {}),
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

function createFileReferenceLinkIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("aria-hidden", "true");

  const body = document.createElementNS("http://www.w3.org/2000/svg", "path");
  body.setAttribute(
    "d",
    "M3.25 1.75h4.75l2.75 2.75v7a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75V2.5a.75.75 0 0 1 .75-.75Z",
  );
  body.setAttribute("fill", REFERENCE_MENTION_COLOR);

  const fold = document.createElementNS("http://www.w3.org/2000/svg", "path");
  fold.setAttribute("d", "M8 1.75V4.5H10.75");
  fold.setAttribute("fill", "#7dd3fc");

  const line = (y: number, width: number) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M4.25 ${y}h${width}`);
    path.setAttribute("stroke", "#ffffff");
    path.setAttribute("stroke-width", "1");
    path.setAttribute("stroke-linecap", "round");
    return path;
  };

  svg.append(body, fold, line(6.75, 5.5), line(8.75, 5.5), line(10.75, 3.5));
  return svg;
}

function createReferenceLinkIcon(providerId: TuttiAtProviderId) {
  if (providerId === "file" || providerId === "agent-generated-file") {
    return createFileReferenceLinkIcon();
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("aria-hidden", "true");

  const stroke = (d: string) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", REFERENCE_MENTION_COLOR);
    path.setAttribute("stroke-width", "1.2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("fill", "none");
    return path;
  };

  switch (providerId) {
    case "agent-session":
      svg.append(
        stroke("M4.5 4.75a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0Z"),
        stroke("M2.75 11.25c0-1.75 1.9-2.75 4.25-2.75s4.25 1 4.25 2.75"),
      );
      break;
    case "workspace-app":
      svg.append(
        stroke("M3 3.25h8v7.5H3z"),
        stroke("M3 5.75h8"),
        stroke("M5.25 3.25V2.25h3.5v1"),
      );
      break;
    case "workspace-issue":
      svg.append(
        stroke("M3.25 2.75h7.5"),
        stroke("M3.25 5.75h7.5"),
        stroke("M3.25 8.75h5"),
        stroke("M3.25 11.25h7.5"),
      );
      break;
    default:
      return createFileReferenceLinkIcon();
  }

  return svg;
}

function appendStyledReferenceChipContent(chip: HTMLAnchorElement, label: string, reference: TuttiAtQueryResult) {
  chip.className = REFERENCE_MENTION_CHIP_CLASS;
  chip.style.color = "var(--accent)";

  const iconWrap = document.createElement("span");
  iconWrap.className = "[display:inline-flex] [flex:0_0_auto] [align-items:center] [justify-content:center]";
  iconWrap.append(createReferenceLinkIcon(reference.providerId));

  const labelEl = document.createElement("span");
  labelEl.className = "[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]";
  labelEl.style.color = "var(--accent)";
  labelEl.textContent = label;

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
      "[display:inline]",
      "[color:#7c3aed]",
      "[font-weight:500]",
      "[vertical-align:baseline]",
      "[white-space:nowrap]",
    ].join(" ");
    return chip;
  }
  chip.className = [
    "[display:inline]",
    "[color:#2563eb]",
    "[font-weight:400]",
    "[vertical-align:baseline]",
    "[white-space:nowrap]",
  ].join(" ");
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
  if (isWhisperChip(node)) return "";
  if (isMentionChip(node)) {
    if (node.dataset.mentionDisplayMode === "reference-link") {
      return serializeReferenceMentionChip(node);
    }
    return `@${node.dataset.mentionLabel ?? node.textContent?.replace(/^@/, "") ?? ""}`;
  }
  if (isMessageLinkChip(node)) return formatMessageLink(...parseMessageLinkIds(node.dataset.messageLinkId ?? ""));
  if (isSummaryLinkChip(node)) return formatSummaryLink(node.dataset.summaryLinkId ?? "");
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
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

function isAtomicEditorChip(node: Node): node is HTMLElement {
  return isMentionChip(node) || isWhisperChip(node) || isMessageLinkChip(node) || isSummaryLinkChip(node);
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
  candidate.remove();
  const nextRange = document.createRange();
  nextRange.setStart(nextCaretParent, Math.min(nextCaretOffset, nextCaretParent.childNodes.length));
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function previousEditableNode(container: Node, offset: number, editor: HTMLDivElement) {
  if (container.nodeType === Node.TEXT_NODE && offset > 0) return null;
  let node: Node | null = container.nodeType === Node.TEXT_NODE ? container : container.childNodes[offset - 1] ?? null;
  if (node) return deepestRight(node);
  node = container;
  while (node && node !== editor) {
    if (node.previousSibling) return deepestRight(node.previousSibling);
    node = node.parentNode;
  }
  return null;
}

function nextEditableNode(container: Node, offset: number, editor: HTMLDivElement) {
  if (container.nodeType === Node.TEXT_NODE && offset < (container.textContent?.length ?? 0)) return null;
  let node: Node | null = container.nodeType === Node.TEXT_NODE ? container.nextSibling : container.childNodes[offset] ?? null;
  if (node) return deepestLeft(node);
  node = container;
  while (node && node !== editor) {
    if (node.nextSibling) return deepestLeft(node.nextSibling);
    node = node.parentNode;
  }
  return null;
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

function insertTextOrLinkChipsAtCaret(
  value: string,
  labels: {
    getMessageLabel: (messageId: string) => string;
    getSummaryLabel: (taskId: string) => string;
  },
) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const normalized = value.replace(/\r\n?/g, "\n");
  const matches = findEmbeddedLinks(normalized);
  if (matches.length === 0) {
    insertPlainTextAtCaret(normalized);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  const inserted: Node[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) {
      const textNode = document.createTextNode(normalized.slice(cursor, match.index));
      fragment.append(textNode);
      inserted.push(textNode);
    }
    if (match.kind === "message") {
      const linkChip = createMessageLinkChip(match.id, labels.getMessageLabel(match.id));
      fragment.append(linkChip);
      inserted.push(linkChip);
    } else {
      const linkChip = createSummaryLinkChip(match.id, labels.getSummaryLabel(match.id));
      fragment.append(linkChip);
      inserted.push(linkChip);
    }
    cursor = match.index + match.length;
  }
  if (cursor < normalized.length) {
    const textNode = document.createTextNode(normalized.slice(cursor));
    fragment.append(textNode);
    inserted.push(textNode);
  }
  const trailingText = document.createTextNode("");
  fragment.append(trailingText);
  inserted.push(trailingText);
  range.insertNode(fragment);
  range.setStartAfter(inserted[inserted.length - 1]!);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertSummaryLinkAtCaret(taskId: string, label: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const chip = createSummaryLinkChip(taskId, label);
  range.insertNode(chip);
  const trailingText = document.createTextNode("");
  chip.after(trailingText);
  range.setStartAfter(trailingText);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function createSummaryLinkChip(taskId: string, label: string) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.summaryLinkId = taskId;
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
  chip.textContent = label;
  return chip;
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
  chip.textContent = label;
  return chip;
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

function PendingAttachmentTray(props: {
  uploadItems: UploadItem[];
  onRemoveUpload: (itemId: string) => void;
  onOpenUpload: (item: UploadItem) => void;
}) {
  if (props.uploadItems.length === 0) return null;

  return (
    <div className={"[display:contents]"} aria-label="Pending attachments">
      {props.uploadItems.map((item) => (
        <AttachmentPill
          key={item.id}
          filename={item.filename}
          mimeType={item.mimeType}
          sizeBytes={item.sizeBytes}
          previewUrl={item.previewUrl ?? item.artifact?.publicUrl ?? null}
          status={attachmentStatusLabel(item.status)}
          failed={item.status === "error"}
          onRemove={() => props.onRemoveUpload(item.id)}
          onOpen={() => props.onOpenUpload(item)}
        />
      ))}
    </div>
  );
}

function AttachmentPill(props: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string | null;
  status: string;
  failed?: boolean;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const isImage = props.mimeType.startsWith("image/");
  const addedLabel = t("composer.uploadAdded");
  const hasStatus = props.status !== addedLabel;
  if (isImage && props.previewUrl) {
    return (
      <div
        className={`group [position:relative] [width:58px] [height:44px] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:10px] [background:#00000008] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] ${props.failed ? "[border-color:#ef444455]" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={t("composer.previewFile", { filename: props.filename })}
        onClick={props.onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onOpen();
          }
        }}
      >
        <img className={"[width:100%] [height:100%] [object-fit:cover]"} src={props.previewUrl} alt="" />
        <button
          className={"[position:absolute] [right:3px] [top:3px] [display:inline-grid] [width:18px] [height:18px] [place-items:center] [border:0] [border-radius:999px] [color:var(--text)] [background:#fffffff0] [opacity:0] [box-shadow:0_1px_4px_rgb(0_0_0_/_12%)] [transition:opacity_0.12s_ease,_background-color_0.12s_ease,_color_0.12s_ease] group-hover:[opacity:1] focus-visible:[opacity:1] [&:hover]:[background:#ffffff]"}
          type="button"
          aria-label={`Remove ${props.filename}`}
          title={`Remove ${props.filename}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemove();
          }}
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group [position:relative] [display:grid] [grid-template-columns:24px_minmax(0,_1fr)] [align-items:center] [gap:7px] [width:min(220px,_100%)] [height:32px] [border:1px_solid_var(--border)] [border-radius:10px] [padding:4px_24px_4px_5px] [background:var(--panel)] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] ${props.failed ? "[border-color:#ef444455] [background:#ef44440a]" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={t("composer.previewFile", { filename: props.filename })}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
    >
      <span className={"[display:inline-grid] [width:24px] [height:24px] [overflow:hidden] [place-items:center] [border-radius:7px] [color:var(--muted)] [background:#00000008]"}>
        {isImage && props.previewUrl ? (
          <img className={"[width:100%] [height:100%] [object-fit:cover]"} src={props.previewUrl} alt="" />
        ) : isImage ? (
          <ImageIcon size={14} />
        ) : (
          <FileText size={14} />
        )}
      </span>
      <span className={"[display:flex] [min-width:0] [align-items:baseline] [gap:5px]"}>
        <strong className={"[min-width:0] [overflow:hidden] [color:var(--text)] [font-size:12px] [font-weight:650] [line-height:16px] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {props.filename}
        </strong>
        <small className={`[flex:0_0_auto] [overflow:hidden] [font-size:11px] [font-weight:450] [line-height:14px] [text-overflow:ellipsis] [white-space:nowrap] ${props.failed ? "[color:var(--danger)]" : "[color:var(--muted)]"}`}>
          {hasStatus ? `${props.status} ` : ""}
          {formatBytes(props.sizeBytes)}
        </small>
      </span>
      <button
        className={"[position:absolute] [right:4px] [top:6px] [display:inline-grid] [width:18px] [height:18px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#ffffffd9] [opacity:0] [box-shadow:0_1px_4px_rgb(0_0_0_/_8%)] [transition:opacity_0.12s_ease,_background-color_0.12s_ease,_color_0.12s_ease] group-hover:[opacity:1] focus-visible:[opacity:1] [&:hover]:[color:var(--text)] [&:hover]:[background:#ffffff]"}
        type="button"
        aria-label={`Remove ${props.filename}`}
        title={`Remove ${props.filename}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onRemove();
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
}

function attachmentStatusLabel(status: UploadItem["status"]) {
  if (status === "pending") return t("composer.uploadPending");
  if (status === "uploading") return t("composer.uploadUploading");
  if (status === "error") return t("composer.uploadError");
  return t("composer.uploadAdded");
}

function revokePreviewUrl(previewUrl: string | null) {
  if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
}

type MentionOption =
  | { kind: "all"; key: "all"; label: string }
  | { kind: "participant"; key: string; label: string; participant: Participant }
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
    && (everyoneLabel.toLowerCase().includes(normalizedQuery) || "所有人".includes(normalizedQuery) || "all".includes(normalizedQuery) || "all agents".includes(normalizedQuery))
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
