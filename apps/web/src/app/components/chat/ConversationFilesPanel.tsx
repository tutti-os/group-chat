import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Download, Eye, FileText, Search, Video, X } from "lucide-react";
import type { Artifact, Message } from "@group-chat/shared";
import {
  downloadArtifactFile,
  getArtifactCategory,
  matchesArtifactCategory,
  openArtifactPreview,
  type ArtifactFilterCategory,
} from "../../artifact-actions.js";
import { formatBytes, formatShortDate } from "../../formatting.js";
import { AttachmentPreviewDialog, type AttachmentPreview } from "./AttachmentPreviewDialog.js";

const PAGE_SIZE = 30;

const CATEGORY_TABS: Array<{ id: ArtifactFilterCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "file", label: "文件" },
];

export function ConversationFilesPanel(props: {
  open: boolean;
  conversationId: string;
  artifacts: Artifact[];
  messages: Message[];
  onClose: () => void;
  onFocusMessage: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ArtifactFilterCategory>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const previewOverlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setCategory("all");
    setVisibleCount(PAGE_SIZE);
    setPreview(null);
  }, [props.conversationId, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (previewOverlayRef.current?.contains(target)) return;
      if (preview) return;
      props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (preview) {
          setPreview(null);
          return;
        }
        props.onClose();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [preview, props.onClose, props.open]);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredArtifacts = useMemo(() => {
    return props.artifacts
      .filter((artifact) => artifact.conversationId === props.conversationId)
      .filter((artifact) => matchesArtifactCategory(artifact, category))
      .filter((artifact) => {
        if (!normalizedQuery) return true;
        const message = artifact.messageId
          ? props.messages.find((item) => item.id === artifact.messageId) ?? null
          : null;
        const sender = message ? formatMessageSender(message) : "";
        return [artifact.filename, artifact.mimeType, artifact.textPreview, sender]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedQuery));
      })
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [category, normalizedQuery, props.artifacts, props.conversationId, props.messages]);

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
    if (!artifact.messageId) {
      window.alert("这条文件没有关联消息，暂时无法定位。");
      return;
    }
    props.onFocusMessage(artifact.messageId);
    props.onClose();
  };

  const stopPanelPointerBubble = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  const handlePreview = (artifact: Artifact, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void openArtifactPreview(artifact, setPreview);
  };

  const handleDownload = (artifact: Artifact, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void downloadArtifactFile(artifact);
  };

  if (!props.open) return null;

  const emptyLabel = normalizedQuery
    ? "没有找到匹配的文件"
    : category === "all"
      ? "这个群还没有文件"
      : `这个群还没有${CATEGORY_TABS.find((tab) => tab.id === category)?.label ?? "文件"}`;

  return (
    <>
      <aside
        ref={panelRef}
        className={"[position:absolute] [top:56px] [right:0] [bottom:0] [z-index:36] [display:grid] [width:min(360px,_calc(100vw_-_24px))] [grid-template-rows:auto_auto_auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:var(--panel)] [box-shadow:-18px_0_40px_rgb(0_0_0_/_8%)]"}
      >
        <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:10px] [padding:14px] [border-bottom:1px_solid_var(--border)]"}>
          <div className={"[min-width:0] [&_h3]:[margin:0] [&_h3]:[font-size:15px] [&_h3]:[font-weight:720] [&_h3]:[line-height:1.2] [&_span]:[display:block] [&_span]:[margin-top:3px] [&_span]:[color:var(--muted)] [&_span]:[font-size:12px]"}>
            <h3>群文件</h3>
            <span>{filteredArtifacts.length} 个文件</span>
          </div>
          <button
            className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
            type="button"
            aria-label="关闭群文件"
            title="关闭"
            onClick={props.onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className={"[display:flex] [gap:8px] [padding:12px_12px_0] [overflow-x:auto]"}>
          {CATEGORY_TABS.map((tab) => {
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
              placeholder="搜索文件名、类型或发送者"
              aria-label="搜索群文件"
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
            const message = artifact.messageId
              ? props.messages.find((item) => item.id === artifact.messageId) ?? null
              : null;
            const artifactCategory = getArtifactCategory(artifact);
            return (
              <article
                key={artifact.id}
                className={"[display:grid] [grid-template-columns:52px_minmax(0,_1fr)_auto] [align-items:center] [gap:10px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px] [background:#ffffff] [transition:border-color_0.12s_ease,_background-color_0.12s_ease] hover:[border-color:#d4d4d8] hover:[background:#fbfbfc]"}
              >
                <button
                  type="button"
                  className={"[display:grid] [grid-column:1_/_3] [grid-template-columns:52px_minmax(0,_1fr)] [align-items:center] [gap:10px] [border:0] [padding:0] [text-align:left] [color:inherit] [background:transparent] [&:focus-visible]:[outline:none]"}
                  title={artifact.messageId ? "定位到原消息" : "暂无关联消息"}
                  onClick={() => openSourceMessage(artifact)}
                >
                  <span className={"[display:grid] [width:52px] [height:52px] [place-items:center] [overflow:hidden] [border-radius:12px] [background:#f3f4f6]"}>
                    {artifactCategory === "image" ? (
                      <img
                        src={artifact.publicUrl}
                        alt=""
                        className={"[width:100%] [height:100%] [object-fit:cover]"}
                      />
                    ) : (
                      <span className={"[display:grid] [width:40px] [height:46px] [place-items:center] [border-radius:7px] [color:#ffffff] [background:#8d96a3]"}>
                        {artifactCategory === "video" ? <Video size={20} /> : <FileText size={20} />}
                      </span>
                    )}
                  </span>
                  <span className={"[display:grid] [min-width:0] [gap:4px]"}>
                    <strong className={"[overflow:hidden] [font-size:13px] [font-weight:650] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]"}>
                      {artifact.filename}
                    </strong>
                    <span className={"[display:flex] [min-width:0] [align-items:center] [gap:6px] [color:var(--muted)] [font-size:11px] [line-height:1.35]"}>
                      <span>{formatBytes(artifact.sizeBytes)}</span>
                      <span>·</span>
                      <span>{formatShortDate(artifact.createdAt)}</span>
                    </span>
                    <span className={"[overflow:hidden] [color:var(--muted)] [font-size:11px] [text-overflow:ellipsis] [white-space:nowrap]"}>
                      {message ? `${formatMessageSender(message)} 发送` : "未关联消息"}
                    </span>
                  </span>
                </button>
                <div className={"[display:flex] [align-items:center] [gap:4px]"}>
                  <button
                    type="button"
                    className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
                    aria-label={`预览 ${artifact.filename}`}
                    title="预览"
                    onPointerDown={stopPanelPointerBubble}
                    onClick={(event) => handlePreview(artifact, event)}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    type="button"
                    className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
                    aria-label={`下载 ${artifact.filename}`}
                    title="下载"
                    onPointerDown={stopPanelPointerBubble}
                    onClick={(event) => handleDownload(artifact, event)}
                  >
                    <Download size={14} />
                  </button>
                </div>
              </article>
            );
          })}
          {hasMore ? (
            <div className={"[padding:8px_0_4px] [color:var(--muted)] [font-size:12px] [text-align:center]"}>
              继续滚动加载更多
            </div>
          ) : null}
        </div>
        <AttachmentPreviewDialog
          overlayRef={previewOverlayRef}
          preview={preview}
          onClose={() => setPreview(null)}
        />
      </aside>
    </>
  );
}

function formatMessageSender(message: Message) {
  if (message.role === "user") return "我";
  return message.senderName || message.role;
}
