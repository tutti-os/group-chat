import { FileText, X } from "lucide-react";
import type { Ref } from "react";
import { useTranslation } from "../../i18n/index.js";

export interface AttachmentPreview {
  title: string;
  mimeType: string;
  url?: string | null;
  text?: string | null;
  loading?: boolean;
}

export function AttachmentPreviewDialog(props: {
  preview: AttachmentPreview | null;
  onClose: () => void;
  overlayRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  if (!props.preview) return null;
  const isImage = props.preview.mimeType.startsWith("image/");
  const isVideo = props.preview.mimeType.startsWith("video/");

  return (
    <div
      ref={props.overlayRef}
      className={"[position:fixed] [inset:0] [z-index:80] [display:grid] [place-items:center] [padding:24px] [background:rgb(15_23_42_/_52%)]"}
      role="dialog"
      aria-modal="true"
      aria-label={props.preview.title}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className={"[display:grid] [width:min(920px,_calc(100vw_-_32px))] [max-height:calc(100vh_-_48px)] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:18px] [background:var(--panel)] [box-shadow:0_24px_80px_rgb(0_0_0_/_24%)]"}>
        <header className={"[display:grid] [grid-template-columns:minmax(0,_1fr)_34px] [align-items:center] [gap:12px] [border-bottom:1px_solid_var(--border)] [padding:12px_14px] [&_strong]:[min-width:0] [&_strong]:[overflow:hidden] [&_strong]:[text-overflow:ellipsis] [&_strong]:[white-space:nowrap] [&_strong]:[font-size:13px]"}>
          <strong>{props.preview.title}</strong>
          <button
            type="button"
            className={"[display:inline-grid] [width:34px] [height:34px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012]"}
            aria-label={t("preview.close")}
            onClick={props.onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className={"[min-height:0] [overflow:auto] [padding:14px] [background:#00000005]"}>
          {isImage && props.preview.url ? (
            <img className={"[display:block] [max-width:100%] [max-height:calc(100vh_-_150px)] [margin:0_auto] [border-radius:12px] [object-fit:contain]"} src={props.preview.url} alt={props.preview.title} />
          ) : isVideo && props.preview.url ? (
            <video
              className={"[display:block] [width:100%] [max-height:calc(100vh_-_150px)] [margin:0_auto] [border-radius:12px] [background:#000000]"}
              src={props.preview.url}
              controls
              playsInline
            />
          ) : props.preview.loading ? (
            <div className={"[display:grid] [min-height:260px] [place-items:center] [color:var(--muted)] [font-size:13px]"}>{t("preview.loading")}</div>
          ) : typeof props.preview.text === "string" ? (
            <pre className={"[min-height:260px] [margin:0] [overflow:auto] [border:1px_solid_var(--border)] [border-radius:12px] [padding:14px] [color:var(--text)] [background:#ffffff] [font-size:13px] [line-height:1.6] [white-space:pre-wrap]"}>{props.preview.text || " "}</pre>
          ) : (
            <div className={"[display:grid] [min-height:260px] [place-items:center] [gap:8px] [color:var(--muted)] [font-size:13px] [text-align:center]"}>
              <FileText size={24} />
              <span>{t("preview.unsupported")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function canPreviewInApp(mimeType: string, filename = "") {
  return mimeType.startsWith("image/") || mimeType.startsWith("video/") || isTextAttachment(mimeType, filename);
}

export function isTextAttachment(mimeType: string, filename = "") {
  const lower = filename.toLowerCase();
  return (
    mimeType.startsWith("text/") ||
    [
      ".txt",
      ".md",
      ".markdown",
      ".json",
      ".csv",
      ".log",
      ".xml",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
    ].some((extension) => lower.endsWith(extension))
  );
}
