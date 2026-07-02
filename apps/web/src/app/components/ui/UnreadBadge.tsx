import { formatUnreadCount } from "../../conversation-read-state.js";
import { UNREAD_FEATURE_ENABLED } from "../../feature-flags.js";
import { useTranslation } from "../../i18n/index.js";

export function UnreadBadge(props: {
  count: number;
  className?: string;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  if (!UNREAD_FEATURE_ENABLED) return null;
  const label = formatUnreadCount(props.count);
  if (!label) return null;
  const compact = label.length > 1;
  const size = props.size ?? "sm";

  return (
    <span
      className={`[position:absolute] [display:inline-grid] [place-items:center] [border:2px_solid_var(--background-fronted)] [border-radius:999px] [color:var(--white-stationary)] [background:var(--state-danger)] [font-weight:700] [line-height:1] [pointer-events:none] [box-shadow:0_1px_4px_color-mix(in_srgb,var(--state-danger)_35%,transparent)] ${size === "sm" ? "[top:-4px] [left:-4px] [min-width:16px] [height:16px] [padding:0_4px] [font-size:11px]" : "[top:-6px] [right:-6px] [left:auto] [min-width:18px] [height:18px] [padding:0_5px] [font-size:11px]"} ${compact ? "" : "[width:16px]"} ${props.className ?? ""}`}
      aria-label={t("unread.count", { count: props.count })}
    >
      {label}
    </span>
  );
}
