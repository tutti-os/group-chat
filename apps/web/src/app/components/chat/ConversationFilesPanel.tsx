import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Download, FileText, FolderOpen, Search, Video, X } from "lucide-react";
import type { Artifact, AgentRun, Identity, Message, MessageBlock, Participant } from "@group-chat/shared";
import { resolveArtifactLinkedMessageId } from "@group-chat/shared";
import {
  downloadArtifactFile,
  filterGroupChatFiles,
  getArtifactCategory,
  matchesArtifactCategory,
  revealArtifactInTuttiFileManager,
  type ArtifactFilterCategory,
} from "../../artifact-actions.js";
import { formatBytes, formatMessageTime } from "../../formatting.js";
import { messageSenderLabel } from "../../chat-links.js";
import { t, useTranslation } from "../../i18n/index.js";

const PAGE_SIZE = 30;
const SINGLE_CLICK_DELAY_MS = 250;

function getCategoryTabs() {
  return [
    { id: "all" as const, label: t("files.all") },
    { id: "image" as const, label: t("files.image") },
    { id: "video" as const, label: t("files.video") },
    { id: "file" as const, label: t("files.file") },
  ];
}

export function ConversationFilesPanel(props: {
  open: boolean;
  conversationId: string;
  artifacts: Artifact[];
  messages: Message[];
  messageBlocks: MessageBlock[];
  agentRuns: AgentRun[];
  participants: Participant[];
  identities: Identity[];
  userDisplayName: string;
  onClose: () => void;
  onFocusMessage: (input: { messageId: string; artifactId: string }) => void;
}) {
  useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ArtifactFilterCategory>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const panelRef = useRef<HTMLElement | null>(null);
  const pendingClickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setCategory("all");
    setVisibleCount(PAGE_SIZE);
  }, [props.conversationId, props.open]);

  useEffect(() => {
    return () => {
      if (pendingClickTimerRef.current) window.clearTimeout(pendingClickTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!props.open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [props.onClose, props.open]);

  const normalizedQuery = query.trim().toLowerCase();

  const groupChatArtifacts = useMemo(
    () => filterGroupChatFiles(props.artifacts, props.messages, props.messageBlocks, props.agentRuns, props.conversationId),
    [props.agentRuns, props.artifacts, props.conversationId, props.messageBlocks, props.messages],
  );

  const filteredArtifacts = useMemo(() => {
    return groupChatArtifacts
      .filter((artifact) => matchesArtifactCategory(artifact, category))
      .filter((artifact) => {
        if (!normalizedQuery) return true;
        return artifact.filename.toLowerCase().includes(normalizedQuery);
      })
      .slice()
      .sort((left, right) => artifactChatSortMs(right, props.messages, props.agentRuns) - artifactChatSortMs(left, props.messages, props.agentRuns));
  }, [category, groupChatArtifacts, normalizedQuery, props.agentRuns, props.messages]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [normalizedQuery, category]);

  const visibleArtifacts = filteredArtifacts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredArtifacts.length;

  const loadMore = () => {
    if (!hasMore) return;
    setVisibleCount((current) => Math.min(current + PAGE_SIZE, filteredArtifacts.length));
  };

  const openSourceMessage = (artifact: Artifact) => {
    const messageId = resolveArtifactLinkedMessageId(artifact, props.agentRuns, props.messages);
    if (!messageId) {
      window.alert(t("files.noLinkedMessage"));
      return;
    }
    props.onFocusMessage({ messageId, artifactId: artifact.id });
    props.onClose();
  };

  const revealInTuttiFileManager = (artifact: Artifact) => {
    revealArtifactInTuttiFileManager(artifact);
  };

  const scheduleOpenSourceMessage = (artifact: Artifact) => {
    if (pendingClickTimerRef.current) window.clearTimeout(pendingClickTimerRef.current);
    pendingClickTimerRef.current = window.setTimeout(() => {
      openSourceMessage(artifact);
      pendingClickTimerRef.current = null;
    }, SINGLE_CLICK_DELAY_MS);
  };

  const handleFileRowClick = (artifact: Artifact) => {
    scheduleOpenSourceMessage(artifact);
  };

  const handleFileRowDoubleClick = (artifact: Artifact, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (pendingClickTimerRef.current) {
      window.clearTimeout(pendingClickTimerRef.current);
      pendingClickTimerRef.current = null;
    }
    revealInTuttiFileManager(artifact);
  };

  const stopPanelPointerBubble = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  const handleReveal = (artifact: Artifact, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (pendingClickTimerRef.current) {
      window.clearTimeout(pendingClickTimerRef.current);
      pendingClickTimerRef.current = null;
    }
    revealInTuttiFileManager(artifact);
  };

  const handleDownload = async (artifact: Artifact, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await downloadArtifactFile(artifact);
  };

  if (!props.open) return null;

  const categoryTabs = getCategoryTabs();
  const emptyLabel = normalizedQuery
    ? t("files.noMatch")
    : category === "all"
      ? t("files.emptyAll")
      : t("files.emptyCategory", { category: categoryTabs.find((tab) => tab.id === category)?.label ?? t("files.file") });

  return (
    <aside
      ref={panelRef}
      className={"[position:absolute] [top:56px] [right:0] [bottom:0] [z-index:36] [display:grid] [width:min(360px,_calc(100vw_-_24px))] [grid-template-rows:auto_auto_auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:var(--panel)] [box-shadow:-18px_0_40px_rgb(0_0_0_/_8%)]"}
    >
      <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:10px] [padding:14px] [border-bottom:1px_solid_var(--border)]"}>
        <div className={"[min-width:0] [&_h3]:[margin:0] [&_h3]:[font-size:15px] [&_h3]:[font-weight:720] [&_h3]:[line-height:1.2] [&_span]:[display:block] [&_span]:[margin-top:3px] [&_span]:[color:var(--muted)] [&_span]:[font-size:12px]"}>
          <h3>{t("files.title")}</h3>
          <span>{t("files.count", { count: filteredArtifacts.length })}</span>
        </div>
        <button
          className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
          type="button"
          aria-label={t("files.close")}
          title={t("common.close")}
          onClick={props.onClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className={"[display:flex] [gap:8px] [padding:12px_12px_0] [overflow-x:auto]"}>
        {categoryTabs.map((tab) => {
          const active = category === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`[display:inline-flex] [height:32px] [flex:0_0_auto] [align-items:center] [border:0] [border-radius:999px] [padding:0_14px] [font-size:13px] [font-weight:650] [transition:background-color_0.12s_ease,_color_0.12s_ease] ${active ? "[color:#ffffff] [background:#171717]" : "[color:var(--muted)] [background:#f2f3f5] hover:[color:var(--text)] hover:[background:#eceef1]"}`}
              aria-pressed={active}
              onClick={() => setCategory(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className={"[padding:12px_12px_0]"}>
        <label className={"[display:flex] [height:38px] [align-items:center] [gap:8px] [border-radius:12px] [padding:0_12px] [color:var(--muted)] [background:#f2f3f5] [&_input]:[width:100%] [&_input]:[min-width:0] [&_input]:[border:0] [&_input]:[color:var(--text)] [&_input]:[background:transparent] [&_input]:[font-size:13px] [&_input]:[outline:none] [&_input::placeholder]:[color:#7a7d82]"}>
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("files.searchPlaceholder")}
            aria-label={t("files.searchAria")}
          />
        </label>
      </div>

      <div
        className={"[min-height:0] [overflow-y:auto] [padding:12px] [display:grid] [align-content:start] [gap:8px]"}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollTop + element.clientHeight >= element.scrollHeight - 48) {
            loadMore();
          }
        }}
      >
        {visibleArtifacts.length === 0 ? (
          <div className={"[padding:28px_12px] [color:var(--muted)] [font-size:13px] [line-height:1.5] [text-align:center]"}>
            {emptyLabel}
          </div>
        ) : null}
        {visibleArtifacts.map((artifact) => {
          const linkedMessageId = resolveArtifactLinkedMessageId(artifact, props.agentRuns, props.messages);
          const message = linkedMessageId
            ? props.messages.find((item) => item.id === linkedMessageId) ?? null
            : null;
          const canJumpToMessage = Boolean(linkedMessageId);
          const artifactCategory = getArtifactCategory(artifact);
          return (
            <article
              key={artifact.id}
              className={"[display:grid] [grid-template-columns:40px_minmax(0,_1fr)_auto] [align-items:center] [gap:8px] [border:1px_solid_var(--border)] [border-radius:12px] [padding:8px] [background:#ffffff] [transition:border-color_0.12s_ease,_background-color_0.12s_ease] hover:[border-color:#d4d4d8] hover:[background:#fbfbfc]"}
            >
              <button
                type="button"
                className={"[display:grid] [grid-column:1_/_3] [grid-template-columns:40px_minmax(0,_1fr)] [align-items:center] [gap:8px] [border:0] [padding:0] [text-align:left] [color:inherit] [background:transparent] [&:focus-visible]:[outline:none]"}
                title={canJumpToMessage ? t("files.jumpToMessage") : t("files.noLinkedMessageShort")}
                onClick={() => handleFileRowClick(artifact)}
                onDoubleClick={(event) => handleFileRowDoubleClick(artifact, event)}
              >
                <span className={"[display:grid] [width:40px] [height:40px] [place-items:center] [overflow:hidden] [border-radius:8px] [background:#f3f4f6]"}>
                  {artifactCategory === "image" ? (
                    <img
                      src={artifact.publicUrl}
                      alt=""
                      className={"[width:100%] [height:100%] [object-fit:cover]"}
                    />
                  ) : (
                    <span className={"[display:grid] [width:30px] [height:34px] [place-items:center] [border-radius:6px] [color:#ffffff] [background:#8d96a3]"}>
                      {artifactCategory === "video" ? <Video size={16} /> : <FileText size={16} />}
                    </span>
                  )}
                </span>
                <span className={"[display:grid] [min-width:0] [gap:2px]"}>
                  <strong className={"[overflow:hidden] [font-size:13px] [font-weight:650] [line-height:1.25] [text-overflow:ellipsis] [white-space:nowrap]"}>
                    {artifact.filename}
                  </strong>
                  <span className={"[overflow:hidden] [color:var(--muted)] [font-size:11px] [line-height:1.3] [text-overflow:ellipsis] [white-space:nowrap]"}>
                    {formatFileCreatorMeta(artifact, message, {
                      participants: props.participants,
                      identities: props.identities,
                      userDisplayName: props.userDisplayName,
                    })}
                  </span>
                </span>
              </button>
              <div className={"[display:flex] [align-items:center] [gap:2px]"}>
                <button
                  type="button"
                  className={"[display:inline-grid] [width:28px] [height:28px] [place-items:center] [border:0] [border-radius:8px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
                  aria-label={t("files.revealFile", { filename: artifact.filename })}
                  title={t("files.revealInFileManager")}
                  onPointerDown={stopPanelPointerBubble}
                  onClick={(event) => handleReveal(artifact, event)}
                >
                  <FolderOpen size={13} />
                </button>
                <button
                  type="button"
                  className={"[display:inline-grid] [width:28px] [height:28px] [place-items:center] [border:0] [border-radius:8px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
                  aria-label={t("files.downloadFile", { filename: artifact.filename })}
                  title={t("files.download")}
                  onPointerDown={stopPanelPointerBubble}
                  onClick={(event) => void handleDownload(artifact, event)}
                >
                  <Download size={13} />
                </button>
              </div>
            </article>
          );
        })}
        {hasMore ? (
          <div className={"[padding:8px_0_4px] [color:var(--muted)] [font-size:12px] [text-align:center]"}>
            {t("files.loadMore")}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function formatFileCreatorMeta(
  artifact: Artifact,
  message: Message | null,
  context: { participants: Participant[]; identities: Identity[]; userDisplayName: string },
) {
  const details = `${formatBytes(artifact.sizeBytes)} · ${formatMessageTime(message?.createdAt ?? artifact.createdAt)}`;
  if (!message) return details;
  const creator = messageSenderLabel(message, context.participants, context.identities, context.userDisplayName).trim();
  return creator ? `${creator} · ${details}` : details;
}

function artifactChatSortMs(artifact: Artifact, messages: Message[], agentRuns: AgentRun[]) {
  const messageId = resolveArtifactLinkedMessageId(artifact, agentRuns, messages);
  const message = messageId ? messages.find((item) => item.id === messageId) : undefined;
  const messageMs = message?.createdAt ? Date.parse(message.createdAt) : Number.NaN;
  if (Number.isFinite(messageMs)) return messageMs;
  const artifactMs = Date.parse(artifact.createdAt);
  return Number.isFinite(artifactMs) ? artifactMs : 0;
}
