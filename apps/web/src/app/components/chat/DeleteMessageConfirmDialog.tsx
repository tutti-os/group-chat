import { AlertCircle } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../i18n/index.js";

const DELETE_MESSAGE_DIALOG_Z_INDEX = 2147483010;

export function DeleteMessageConfirmDialog(props: {
  count: number;
  deleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return createPortal(
    <div
      className={"[position:fixed] [inset:0] [display:grid] [place-items:center] [padding:24px] [background:rgb(15_23_42_/_52%)]"}
      style={{ zIndex: DELETE_MESSAGE_DIALOG_Z_INDEX }}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !props.deleting) props.onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-message-title"
        aria-describedby="delete-message-desc"
        className={"[width:min(420px,_calc(100vw_-_32px))] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:18px] [background:var(--panel)] [box-shadow:0_24px_80px_rgb(0_0_0_/_24%)]"}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={"[display:flex] [gap:12px] [padding:20px_20px_16px]"}>
          <div
            aria-hidden="true"
            className={"[display:grid] [width:28px] [height:28px] [flex-shrink:0] [place-items:center] [border-radius:999px] [background:#f97316] [color:#ffffff]"}
          >
            <AlertCircle size={16} strokeWidth={2.4} />
          </div>
          <div className={"[min-width:0]"}>
            <h3 id="delete-message-title" className={"[margin:0] [color:var(--text)] [font-size:16px] [font-weight:720] [line-height:1.35]"}>
              {t("deleteMessage.title")}
            </h3>
            <p id="delete-message-desc" className={"[margin:10px_0_0] [color:var(--muted)] [font-size:13px] [line-height:1.55]"}>
              {t("deleteMessage.desc")}
            </p>
          </div>
        </div>
        <div className={"[display:flex] [justify-content:flex-end] [gap:8px] [padding:0_20px_20px]"}>
          <button
            type="button"
            className={"[display:inline-flex] [height:36px] [align-items:center] [border:1px_solid_var(--border)] [border-radius:10px] [padding:0_14px] [color:var(--text)] [background:var(--panel)] [font-size:13px] [font-weight:650] [&:disabled]:[opacity:0.5]"}
            disabled={props.deleting}
            onClick={props.onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={"[display:inline-flex] [height:36px] [align-items:center] [border:0] [border-radius:10px] [padding:0_14px] [color:#ffffff] [background:#2563eb] [font-size:13px] [font-weight:650] [&:disabled]:[opacity:0.5]"}
            disabled={props.deleting}
            onClick={props.onConfirm}
          >
            {props.deleting ? t("deleteMessage.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
