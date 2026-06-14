import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from "react";
import { Ear, FileText, ImageIcon, Paperclip, Send, Square, Users, X, Zap } from "lucide-react";
import type { AgentRun, Artifact, Conversation, Identity, MentionTarget, Message, Participant, Room, RuntimeProfile } from "@group-chat/shared";
import { cancelRun, sendMessage, updateMessage, uploadArtifact } from "../../../api/client.js";
import { formatBytes, fileToBase64 } from "../../formatting.js";
import {
  findEmbeddedLinks,
  formatMessageLink,
  formatSummaryLink,
  messageSenderLabel,
  SUMMARY_LINK_MIME,
  readStashedSummaryLink,
  summaryLinkLabel,
} from "../../chat-links.js";
import type { BackgroundTask } from "../../background-tasks.js";
import { AttachmentPreviewDialog, isTextAttachment, type AttachmentPreview } from "./AttachmentPreviewDialog.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";
import { resolveAgentAvatarFromContext } from "../../identity-avatar.js";

export function Composer(props: {
  conversation: Conversation;
  conversationId: string;
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  allMessages: Message[];
  allParticipants: Participant[];
  conversations: Conversation[];
  rooms: Room[];
  activeRuns: AgentRun[];
  onSend: typeof sendMessage;
  onUpdateMessage: typeof updateMessage;
  onUpload: typeof uploadArtifact;
  onCancelRun: typeof cancelRun;
  mentionRequest: { participantId: string; seq: number } | null;
  summaryTasks: BackgroundTask[];
  composerRequest:
    | { type: "insert"; seq: number; content: string }
    | { type: "quote"; seq: number; quote: ComposerQuote }
    | { type: "quotes"; seq: number; quotes: ComposerQuote[] }
    | { type: "edit"; seq: number; messageId: string; content: string; mentions: MentionTarget[] }
    | null;
}) {
  const [text, setText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMentions, setEditingMentions] = useState<MentionTarget[]>([]);
  const [quotes, setQuotes] = useState<ComposerQuote[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionedIds, setMentionedIds] = useState<Set<string>>(new Set());
  const [mentionedAll, setMentionedAll] = useState(false);
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
  const mentionableParticipants = props.participants.filter(
    (participant) => participant.kind === "ai" && participant.status !== "removed",
  );
  const mentionOptions = buildMentionOptions(mentionableParticipants, mentionQuery, mentionedIds, mentionedAll);
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
      const editorMentions = collectMentionTargetsFromEditor(editorRef.current, mentionableParticipants);
      const isWhisper = hasWhisperChipInEditor(editorRef.current);
      await props.onSend(props.conversationId, {
        content: quotes.length ? `${formatQuotesForMessage(quotes)}\n\n${text}` : text,
        artifactIds: artifacts.map((artifact) => artifact.id),
        parentMessageId: quotes.length === 1 ? quotes[0]!.messageId : null,
        mentions: editorMentions,
        visibility: isWhisper ? "whisper" : "public",
      });
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
      for (const participant of mentionableParticipants) {
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
    }
  };

  const restoreMentionSelection = (editor: HTMLDivElement) => {
    const saved = mentionSelectionRef.current;
    const selection = window.getSelection();
    if (!saved || !editor.contains(saved.startContainer) || !selection) return;
    selection.removeAllRanges();
    selection.addRange(saved);
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

  const updateMentionQuery = (value: string, cursor: number) => {
    const editor = editorRef.current;
    const nextQuery = editor
      ? readMentionQueryFromRange(mentionQueryRangeRef.current ?? findActiveMentionQueryRange(editor))
      : (() => {
          const beforeCursor = value.slice(0, cursor);
          const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
          return match?.[1] ?? null;
        })();
    setMentionQuery((current) => {
      if (current !== nextQuery) setActiveMentionIndex(0);
      if (nextQuery !== null) saveMentionSelection();
      else {
        mentionSelectionRef.current = null;
        mentionQueryRangeRef.current = null;
      }
      return nextQuery;
    });
  };

  const suppressEditorSyncRef = useRef(false);

  const syncEditorText = () => {
    if (suppressEditorSyncRef.current) return;
    const editor = editorRef.current;
    const nextText = editorText(editor);
    const cursor = editor ? caretTextOffset(editor) : nextText.length;
    setText(nextText);
    syncMentionedIds(nextText);
    if (editor) captureActiveMentionQueryRange(editor);
    updateMentionQuery(nextText, cursor);
  };

  const insertMentionChipAtActiveQuery = (label: string, mentionId: string): boolean => {
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
      const trailingSpace = replaceMentionQueryRange(queryRange.cloneRange(), label, mentionId);
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
    return true;
  };

  const insertMention = (participant: Participant) => {
    insertMentionChipAtActiveQuery(participant.displayName, participant.id);
  };

  const insertMentionAtCursor = (participant: Participant): boolean => {
    setMentionQuery(null);
    const currentEditor = editorRef.current;
    if (!currentEditor) return false;

    suppressEditorSyncRef.current = true;
    let trailingSpace: Text | null = null;
    try {
      trailingSpace = appendMentionChipToEditor(currentEditor, participant.displayName, participant.id);
      normalizeEditorAfterMentionInsert(currentEditor);
    } finally {
      suppressEditorSyncRef.current = false;
    }

    setText(editorText(currentEditor));
    syncMentionedIdsFromEditor(currentEditor);
    setMentionQuery(null);
    mentionQueryRangeRef.current = null;

    if (trailingSpace) {
      focusAfterTrailingSpace(trailingSpace, currentEditor);
    } else {
      placeCaretAtEditorEnd(currentEditor, { preventScroll: true });
    }
    return true;
  };

  const insertAllMention = () => {
    if (!insertMentionChipAtActiveQuery("所有人", "all")) return;
    setMentionedAll(true);
  };

  const selectMentionOption = (option: MentionOption) => {
    const editor = editorRef.current;
    if (editor) captureActiveMentionQueryRange(editor);
    if (option.kind === "all") {
      insertAllMention();
    } else {
      insertMention(option.participant);
    }
    setMentionQuery(null);
  };

  const insertWhisperMention = (participant: Participant) => {
    const editor = editorRef.current;
    if (!editor) return;
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
        trailingSpace = appendMentionChipToEditor(editor, participant.displayName, participant.id);
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
    const files = clipboardFiles(event.clipboardData);
    if (files.length === 0) {
      const pastedText = event.clipboardData.getData("text/plain");
      const summaryLinkFromMime = event.clipboardData.getData(SUMMARY_LINK_MIME).trim();
      const stashedSummaryLink = readStashedSummaryLink();
      const summaryLink = summaryLinkFromMime.startsWith("group-chat://summary/")
        ? summaryLinkFromMime
        : pastedText.startsWith("【消息总结】")
          ? stashedSummaryLink
          : null;
      if (summaryLink?.startsWith("group-chat://summary/")) {
        event.preventDefault();
        const taskId = summaryLink.replace("group-chat://summary/", "");
        insertSummaryLinkAtCaret(taskId, summaryLinkLabel(
          props.summaryTasks.find((task) => task.id === taskId),
        ));
        requestAnimationFrame(syncEditorText);
        return;
      }
      if (!pastedText) return;
      event.preventDefault();
      insertTextOrLinkChipsAtCaret(pastedText, {
        getMessageLabel: (messageId) => messageLinkLabel(messageId, props.allMessages, props.allParticipants),
        getSummaryLabel: (taskId) => summaryLinkLabel(props.summaryTasks.find((task) => task.id === taskId)),
      });
      requestAnimationFrame(syncEditorText);
      return;
    }
    event.preventDefault();
    queueFiles(files);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const removeUploadItem = (itemId: string) => {
    removedUploadIdsRef.current.add(itemId);
    const item = uploadItems.find((candidate) => candidate.id === itemId);
    revokePreviewUrl(item?.previewUrl ?? null);
    if (item?.previewUrl) previewUrlsRef.current.delete(item.previewUrl);
    setUploadItems((current) => current.filter((candidate) => candidate.id !== itemId));
  };

  const openUploadItem = async (item: UploadItem) => {
    if (item.mimeType.startsWith("image/") && item.previewUrl) {
      setPreview({ title: item.filename, mimeType: item.mimeType, url: item.previewUrl });
      return;
    }
    if (isTextAttachment(item.mimeType, item.filename)) {
      setPreview({ title: item.filename, mimeType: item.mimeType, loading: true });
      try {
        setPreview({ title: item.filename, mimeType: item.mimeType, text: await item.file.text() });
      } catch {
        setPreview({ title: item.filename, mimeType: item.mimeType, text: "无法读取文本预览。" });
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
  }, [mentionOptions.length]);

  useEffect(() => {
    handledMentionRequestSeqRef.current = 0;
  }, [props.conversationId]);

  useLayoutEffect(() => {
    const request = props.mentionRequest;
    if (!request || request.seq === handledMentionRequestSeqRef.current) return;
    const participant = mentionableParticipants.find((item) => item.id === request.participantId);
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
  }, [mentionableParticipants, props.mentionRequest]);

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

  const mentionMenuOpen = mentionQuery !== null && mentionOptions.length > 0;

  return (
    <footer className={"[position:relative] [border-top:0] [padding:8px_16px_16px] [background:var(--panel)] max-[760px]:[padding-inline:12px]"}>
      {editingMessageId ? (
        <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:10px] [margin-bottom:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:8px_10px] [background:#fff7ed] [color:#9a3412] [font-size:12px] [font-weight:650]"}>
          <span>正在编辑消息，发送后会让被 @ 的 Agent 重新回复。</span>
          <button
            type="button"
            className={"[display:inline-grid] [width:24px] [height:24px] [place-items:center] [border:0] [border-radius:999px] [color:#9a3412] [background:#fed7aa]"}
            aria-label="取消编辑"
            onClick={() => {
              setEditingMessageId(null);
              setEditingMentions([]);
              setQuotes([]);
              setText("");
              setEditorText(editorRef.current, "", 0);
            }}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      <div
        data-stop={props.activeRuns.length > 0 || undefined}
        className={"[display:grid] [grid-template-columns:40px_minmax(0,_1fr)_40px] [gap:8px] [align-items:end] [border-radius:22px] [padding:8px] [background:#00000008] [&[data-stop=true]]:[grid-template-columns:40px_minmax(0,_1fr)_40px_40px] [&:focus-within]:[box-shadow:inset_0_0_0_1px_var(--border-strong)] max-[760px]:[grid-template-columns:34px_minmax(0,_1fr)_38px] max-[760px]:[&[data-stop=true]]:[grid-template-columns:34px_minmax(0,_1fr)_34px_38px]"}
        onClick={(event) => {
          if (event.target === event.currentTarget) editorRef.current?.focus();
        }}
      >
        <label className={"[display:inline-grid] [place-items:center] [border:0] [width:40px] [height:40px] [border-radius:999px] [color:#17171799] [background:transparent] [transition:background-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000008] [&_input]:[display:none] max-[760px]:[width:34px] max-[760px]:[height:34px]"} title="Attach files">
          <Paperclip size={18} />
          <input
            type="file"
            multiple
            onChange={(event) => {
              queueFiles(event.target.files);
              event.currentTarget.value = "";
              requestAnimationFrame(() => editorRef.current?.focus());
            }}
          />
        </label>
        <div className={"[display:grid] [min-height:40px] [align-content:start] [gap:8px] [padding:2px_0]"}>
          {quotes.length ? <QuoteComposerBar quotes={quotes} onRemove={() => setQuotes([])} /> : null}
          <PendingAttachmentTray
            uploadItems={uploadItems}
            onRemoveUpload={removeUploadItem}
            onOpenUpload={openUploadItem}
          />
          <div className={"[position:relative] [height:28px] [display:grid] [align-items:start]"}>
            {!text ? (
              <span className={"[pointer-events:none] [position:absolute] [left:0] [top:4px] [color:#17171755] [font-size:13px] [line-height:20px]"}>
                发送消息，输入 / 使用命令...
              </span>
            ) : null}
            <div
              ref={editorRef}
              role="textbox"
              aria-label="消息输入框"
              aria-multiline="true"
              contentEditable
              suppressContentEditableWarning
              className={"[height:28px] [max-height:28px] [overflow-y:auto] [outline:none] [white-space:pre-wrap] [overflow-wrap:anywhere] [color:var(--text)] [font-size:13px] [line-height:20px] [padding:4px_0] empty:before:[content:'']"}
              onInput={syncEditorText}
              onClick={syncEditorText}
              onPaste={pasteFiles}
              onKeyUp={syncEditorText}
              onBlur={syncEditorText}
              onKeyDown={(event) => {
                if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentMentionChip(editorRef.current, event.key)) {
                  event.preventDefault();
                  syncEditorText();
                  return;
                }
                if (mentionMenuOpen && event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveMentionIndex((current) => (current + 1) % mentionOptions.length);
                  return;
                }
                if (mentionMenuOpen && event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
                  return;
                }
                if (mentionMenuOpen && (event.key === "Enter" || event.key === "Tab")) {
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
        {props.activeRuns.length > 0 ? (
          <button
            className={"[width:40px] [height:40px] [border:0] [border-radius:999px] [color:var(--danger)] [background:#dc262612] [&:disabled]:[color:var(--muted)] [&:disabled]:[background:#00000008] [&:disabled]:[opacity:0.55]"}
            title="Stop responses"
            aria-label="Stop responses"
            onClick={cancelActiveRuns}
            disabled={cancelling}
          >
            <Square size={16} />
          </button>
        ) : null}
        <button className={"[display:inline-grid] [place-items:center] [border:0] [width:40px] [height:40px] [border-radius:999px] [color:var(--primary-contrast)] [background:var(--primary)] [&:disabled]:[color:var(--muted)] [&:disabled]:[background:#00000008] max-[760px]:[width:38px] max-[760px]:[height:38px]"} aria-label="Send message" onClick={send} disabled={sending}>
          {sending ? <Square size={18} /> : <Send size={18} />}
        </button>
      </div>
      {mentionMenuOpen ? (
        <div
          className={"[position:absolute] [z-index:20] [left:16px] [right:16px] [bottom:calc(100%_-_4px)] [max-height:min(300px,_calc(100vh_-_180px))] [overflow-y:auto] [border:1px_solid_var(--border)] [border-radius:18px] [padding:6px] [background:var(--panel)] [box-shadow:0_14px_42px_rgb(0_0_0_/_12%)] max-[760px]:[left:12px] max-[760px]:[right:12px]"}
          role="listbox"
          aria-label="Mention suggestions"
        >
          {mentionOptions.map((option, index) => (
            option.kind === "all" ? (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={index === activeMentionIndex}
                data-active={index === activeMentionIndex || undefined}
                className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:9px] [width:100%] [min-width:0] [height:38px] [border:0] [border-radius:12px] [padding:0_8px] [color:var(--text)] [text-align:left] [background:transparent] [transition:background-color_0.12s_ease] [&[data-active=true]]:[background:#00000008] [&:hover]:[background:#00000008] [&_strong]:[display:block] [&_strong]:[min-width:0] [&_strong]:[overflow:hidden] [&_strong]:[font-size:12px] [&_strong]:[font-weight:500] [&_strong]:[line-height:16px] [&_strong]:[text-overflow:ellipsis] [&_strong]:[white-space:nowrap]"}
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
            ) : (
              <div
                key={option.key}
                role="option"
                aria-selected={index === activeMentionIndex}
                data-active={index === activeMentionIndex || undefined}
                className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)_30px] [align-items:center] [gap:9px] [width:100%] [min-width:0] [height:38px] [border-radius:12px] [padding:0_4px_0_8px] [color:var(--text)] [transition:background-color_0.12s_ease] [&[data-active=true]]:[background:#00000008] [&:hover]:[background:#00000008]"}
                onMouseEnter={() => setActiveMentionIndex(index)}
              >
                <MentionParticipantAvatar
                  participant={option.participant}
                  identities={props.identities}
                  runtimeProfiles={props.runtimeProfiles}
                />
                <button
                  type="button"
                  className={"[display:inline-flex] [min-width:0] [align-items:center] [gap:6px] [height:100%] [border:0] [padding:0] [color:inherit] [text-align:left] [background:transparent] [&:focus-visible]:[outline:none] [&_strong]:[display:block] [&_strong]:[min-width:0] [&_strong]:[overflow:hidden] [&_strong]:[font-size:12px] [&_strong]:[font-weight:500] [&_strong]:[line-height:16px] [&_strong]:[text-overflow:ellipsis] [&_strong]:[white-space:nowrap]"}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    saveMentionSelection();
                    selectMentionOption(option);
                  }}
                >
                  <strong>{option.label}</strong>
                  <Zap size={13} fill="currentColor" className={"[flex:0_0_auto] [color:#111111]"} />
                </button>
                <button
                  type="button"
                  className={"[display:inline-grid] [width:30px] [height:30px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [&:hover]:[color:#7c3aed] [&:hover]:[background:#f3e8ff] [&:focus-visible]:[outline:none] [&:focus-visible]:[box-shadow:0_0_0_2px_#ddd6fe]"}
                  aria-label={`跟 ${option.label} 说悄悄话`}
                  title="悄悄话"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    saveMentionSelection();
                    insertWhisperMention(option.participant);
                  }}
                >
                  <Ear size={15} />
                </button>
              </div>
            )
          ))}
        </div>
      ) : null}
      <AttachmentPreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </footer>
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

function editorText(editor: HTMLDivElement | null) {
  return editor ? nodeTextValue(editor).replace(/\n$/, "") : "";
}

function setEditorText(editor: HTMLDivElement | null, value: string, cursor: number) {
  if (!editor) return;
  editor.textContent = value;
  editor.focus();
  setCaretTextOffset(editor, cursor);
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

function replaceMentionQueryRange(queryRange: Range, label: string, mentionId: string): Text {
  const needsLeadingSpace = needsLeadingSpaceBeforeMentionRange(queryRange);
  const fragment = document.createDocumentFragment();
  if (needsLeadingSpace) fragment.append(document.createTextNode(" "));
  fragment.append(createMentionChip(label, mentionId));
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

function mentionFragment(label: string, mentionId: string, leadingSpace: boolean, trailingSpace: boolean) {
  const fragment = document.createDocumentFragment();
  if (leadingSpace) fragment.append(document.createTextNode(" "));
  fragment.append(createMentionChip(label, mentionId));
  if (trailingSpace) fragment.append(document.createTextNode(" "));
  return fragment;
}

function createMentionChip(label: string, mentionId: string) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.mentionChip = "true";
  chip.dataset.mentionId = mentionId;
  chip.dataset.mentionLabel = label;
  chip.dataset.mentionInstanceId = crypto.randomUUID();
  chip.textContent = `@${label}`;
  chip.className = [
    "[display:inline]",
    "[color:#2563eb]",
    "[font-weight:400]",
    "[vertical-align:baseline]",
    "[white-space:nowrap]",
  ].join(" ");
  return chip;
}

function createWhisperChip() {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.whisperChip = "true";
  chip.textContent = "悄悄话";
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
  const whisper = createWhisperChip();
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
  if (isMentionChip(node)) return `@${node.dataset.mentionLabel ?? node.textContent?.replace(/^@/, "") ?? ""}`;
  if (isMessageLinkChip(node)) return formatMessageLink(node.dataset.messageLinkId ?? "");
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

function messageLinkLabel(messageId: string, messages: Message[], participants: Participant[]) {
  const message = messages.find((item) => item.id === messageId) ?? null;
  if (!message) return "消息链接";
  return `来自 ${messageSenderLabel(message, participants)} 的消息链接`;
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
  const [firstQuote, ...restQuotes] = props.quotes;
  if (!firstQuote) return null;
  return (
    <div className={"[display:grid] [grid-template-columns:24px_minmax(0,_1fr)] [align-items:start] [gap:6px] [border-radius:8px] [padding:6px_8px] [background:#00000008] [color:#8a8f98] [font-size:13px] [line-height:20px]"}>
      <button
        type="button"
        className={"[display:inline-grid] [width:20px] [height:20px] [place-items:center] [border:0] [border-radius:4px] [color:#8a8f98] [background:transparent] [&:hover]:[color:var(--text)] [&:hover]:[background:#0000000c]"}
        aria-label="移除引用"
        title="移除引用"
        onClick={props.onRemove}
      >
        <X size={14} />
      </button>
      <span className={"[display:grid] [min-width:0] [gap:2px]"}>
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {props.quotes.length > 1 ? `引用 ${props.quotes.length} 条消息` : `回复 ${firstQuote.sender}: ${compactQuoteContent(firstQuote.content)}`}
        </span>
        {props.quotes.length > 1 ? (
          <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap] [color:#9aa1ad] [font-size:12px]"}>
            {firstQuote.sender}: {compactQuoteContent(firstQuote.content)}
            {restQuotes.length ? ` 等 ${restQuotes.length + 1} 条` : ""}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function formatQuotesForMessage(quotes: ComposerQuote[]) {
  return quotes
    .map((quote) => `> 回复 ${quote.sender}: ${compactQuoteContent(quote.content)}`)
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
    <div className={"[display:flex] [flex-wrap:wrap] [align-items:center] [gap:8px]"} aria-label="Pending attachments">
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
  const hasStatus = props.status !== "已添加";
  if (isImage && props.previewUrl) {
    return (
      <div
        className={`group [position:relative] [width:128px] [height:96px] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:18px] [background:#00000008] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] ${props.failed ? "[border-color:#ef444455]" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`预览 ${props.filename}`}
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
          className={"[position:absolute] [right:7px] [top:7px] [display:inline-grid] [width:22px] [height:22px] [place-items:center] [border:0] [border-radius:999px] [color:var(--text)] [background:#ffffffd9] [opacity:0] [box-shadow:0_1px_4px_rgb(0_0_0_/_12%)] [transition:opacity_0.12s_ease,_background-color_0.12s_ease,_color_0.12s_ease] group-hover:[opacity:1] focus-visible:[opacity:1] [&:hover]:[background:#ffffff]"}
          type="button"
          aria-label={`Remove ${props.filename}`}
          title={`Remove ${props.filename}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemove();
          }}
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group [position:relative] [display:grid] [grid-template-columns:60px_minmax(0,_1fr)] [align-items:center] [gap:12px] [width:min(330px,_100%)] [height:86px] [border:1px_solid_var(--border)] [border-radius:22px] [padding:12px_34px_12px_12px] [background:var(--panel)] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] ${props.failed ? "[border-color:#ef444455] [background:#ef44440a]" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`预览 ${props.filename}`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
    >
      <span className={"[display:inline-grid] [width:60px] [height:60px] [overflow:hidden] [place-items:center] [border-radius:14px] [color:var(--muted)] [background:#00000008]"}>
        {isImage && props.previewUrl ? (
          <img className={"[width:100%] [height:100%] [object-fit:cover]"} src={props.previewUrl} alt="" />
        ) : isImage ? (
          <ImageIcon size={19} />
        ) : (
          <FileText size={19} />
        )}
      </span>
      <span className={"[display:grid] [min-width:0] [gap:3px]"}>
        <strong className={"[overflow:hidden] [color:var(--text)] [font-size:15px] [font-weight:650] [line-height:20px] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {props.filename}
        </strong>
        <small className={`[overflow:hidden] [font-size:13px] [font-weight:450] [line-height:18px] [text-overflow:ellipsis] [white-space:nowrap] ${props.failed ? "[color:var(--danger)]" : "[color:var(--muted)]"}`}>
          {hasStatus ? `${props.status} · ` : ""}
          {formatBytes(props.sizeBytes)}
        </small>
      </span>
      <button
        className={"[position:absolute] [right:9px] [top:9px] [display:inline-grid] [width:22px] [height:22px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#ffffffd9] [opacity:0] [box-shadow:0_1px_4px_rgb(0_0_0_/_8%)] [transition:opacity_0.12s_ease,_background-color_0.12s_ease,_color_0.12s_ease] group-hover:[opacity:1] focus-visible:[opacity:1] [&:hover]:[color:var(--text)] [&:hover]:[background:#ffffff]"}
        type="button"
        aria-label={`Remove ${props.filename}`}
        title={`Remove ${props.filename}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onRemove();
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function attachmentStatusLabel(status: UploadItem["status"]) {
  if (status === "pending") return "待发送";
  if (status === "uploading") return "上传中";
  if (status === "error") return "上传失败";
  return "已添加";
}

function revokePreviewUrl(previewUrl: string | null) {
  if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
}

type MentionOption =
  | { kind: "all"; key: "all"; label: string }
  | { kind: "participant"; key: string; label: string; participant: Participant };

function buildMentionOptions(
  participants: Participant[],
  query: string | null,
  mentionedIds: Set<string>,
  mentionedAll: boolean,
): MentionOption[] {
  if (query === null) return [];
  const normalizedQuery = query.toLowerCase();
  const options: MentionOption[] = [];
  if (
    !mentionedAll
    && ("所有人".includes(normalizedQuery) || "all".includes(normalizedQuery) || "all agents".includes(normalizedQuery))
  ) {
    options.push({ kind: "all", key: "all", label: "所有人" });
  }
  const matchingParticipants = participants
    .filter((participant) => !mentionedIds.has(participant.id) && participant.displayName.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      return right.sortOrder - left.sortOrder;
    });
  for (const participant of matchingParticipants) {
    options.push({
      kind: "participant",
      key: participant.id,
      label: participant.displayName,
      participant,
    });
  }
  return options;
}
