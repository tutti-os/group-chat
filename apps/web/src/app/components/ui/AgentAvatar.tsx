import { Bot } from "lucide-react";
import { isRoomEmojiAvatar, isRoomImageAvatar } from "../../room-avatar.js";
import { RoomAvatar, type RoomAvatarSize } from "./RoomAvatar.js";

function normalizeEmoji(value: string) {
  return value.normalize("NFC");
}

function resolveAgentCenterAvatar(avatar?: string | null) {
  const trimmed = avatar?.trim() ?? "";
  if (isRoomImageAvatar(trimmed)) return trimmed;
  if (isRoomEmojiAvatar(trimmed) && normalizeEmoji(trimmed) !== normalizeEmoji("🤖")) {
    return trimmed;
  }
  return null;
}

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
  const centerAvatar = resolveAgentCenterAvatar(props.avatar);

  return (
    <span
      className={`[position:relative] [display:inline-flex] [flex:0_0_auto] [overflow:visible] ${props.className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <RoomAvatar title={props.title} avatar={centerAvatar} provider={null} size={size} className={"[relative] [z-index:0]"} />
      <span
        className={"[position:absolute] [top:-2px] [right:-2px] [z-index:1] [display:grid] [place-items:center] [border-radius:999px] [color:#525252] [background:#ffffff] [box-shadow:0_0_0_1px_#e5e7eb]"}
        style={{ width: badgeSize, height: badgeSize }}
        aria-hidden
      >
        <Bot
          className={size <= 34 ? "size-[9px]" : "size-2.5"}
          size={iconSize}
          strokeWidth={2}
        />
      </span>
    </span>
  );
}
