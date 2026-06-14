import { createPortal } from "react-dom";

export function ToastTip(props: { message: string | null }) {
  if (!props.message) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={"[position:fixed] [top:20px] [left:50%] [z-index:90] [translate:-50%_0] [border-radius:999px] [padding:8px_14px] [color:#ffffff] [background:rgb(17_24_39_/_88%)] [box-shadow:0_10px_30px_rgb(0_0_0_/_18%)] [font-size:13px] [font-weight:650] [pointer-events:none]"}
    >
      {props.message}
    </div>,
    document.body,
  );
}
