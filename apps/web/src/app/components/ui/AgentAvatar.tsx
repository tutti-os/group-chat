import { Bot } from "lucide-react";
import { RoomAvatar, type RoomAvatarSize } from "./RoomAvatar.js";

export function AgentAvatar(props: {
  title: string;
  avatar?: string | null;
  provider?: string | null;
  size?: RoomAvatarSize;
  className?: string;
}) {
  const size = props.size ?? 34;
  const badgeSize = size <= 34 ? 14 : 16;
  const iconSize = size <= 34 ? 9 : 10;

  return (
    <span
      className={`[position:relative] [display:inline-flex] [flex:0_0_auto] ${props.className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <RoomAvatar title={props.title} avatar={props.avatar} provider={props.provider} size={size} />
      <span
        className={"[position:absolute] [top:-2px] [right:-2px] [z-index:1] [display:grid] [place-items:center] [border-radius:999px] [color:#525252] [background:#ffffff] [box-shadow:0_0_0_1px_#e5e7eb]"}
        style={{ width: badgeSize, height: badgeSize }}
        aria-hidden
      >
        <Bot size={iconSize} strokeWidth={2} />
      </span>
    </span>
  );
}
