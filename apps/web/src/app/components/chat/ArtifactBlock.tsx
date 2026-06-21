import type { Artifact } from "@group-chat/shared";
import { FileText } from "lucide-react";
import { formatBytes } from "../../formatting.js";
import { t } from "../../i18n/index.js";

export function ArtifactBlock(props: { artifact: Artifact; onOpen: () => void }) {
  const isImage = props.artifact.mimeType.startsWith("image/");
  if (isImage) {
    return (
      <button
        type="button"
        data-slot="artifact-block"
        data-artifact-id={props.artifact.id}
        className={"[display:block] [width:min(180px,_100%)] [height:120px] [margin-top:6px] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:10px] [padding:0] [background:var(--panel)] [cursor:pointer] [transition:box-shadow_0.2s_ease] [&[data-flash=true]]:[box-shadow:0_0_0_2px_#facc15]"}
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

  return (
    <button
      type="button"
      data-slot="artifact-block"
      data-artifact-id={props.artifact.id}
      className={"[display:grid] [width:min(300px,_100%)] [min-height:40px] [grid-template-columns:28px_minmax(0,_1fr)] [align-items:center] [gap:9px] [margin-top:6px] [border:1px_solid_var(--border)] [border-radius:10px] [padding:6px_10px] [color:var(--text)] [background:#ffffff] [cursor:pointer] [box-shadow:0_1px_2px_rgb(0_0_0_/_3%)] [transition:border-color_0.12s_ease,_background-color_0.12s_ease,_box-shadow_0.12s_ease] hover:[border-color:#d4d4d8] hover:[background:#fbfbfc] hover:[box-shadow:0_3px_10px_rgb(0_0_0_/_5%)] focus-visible:[outline:none] focus-visible:[border-color:var(--border-strong)] [&[data-flash=true]]:[box-shadow:0_0_0_2px_#facc15] [&[data-flash=true]]:[border-color:#facc15]"}
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
