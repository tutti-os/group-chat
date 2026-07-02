import { createPortal } from "react-dom";

export function ToastTip(props: { message: string | null }) {
  if (!props.message) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={"[position:fixed] [top:20px] [left:50%] [z-index:90] [translate:-50%_0] [border-radius:999px] [padding:8px_14px] [color:var(--white-stationary)] [background:color-mix(in_srgb,var(--toast-neutral-bg)_88%,transparent)] [box-shadow:0_10px_30px_color-mix(in_srgb,var(--black-stationary)_18%,transparent)] [font-size:13px] [font-weight:650] [pointer-events:none]"}
    >
      {props.message}
    </div>,
    document.body,
  );
}
