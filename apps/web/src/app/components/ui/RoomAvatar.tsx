import {
  getRoomAvatarInitial,
  isRoomEmojiAvatar,
  isRoomImageAvatar,
} from "../../room-avatar.js";
import { getRuntimeProviderAvatarStyle } from "../../identity-avatar.js";

export type RoomAvatarSize = 32 | 34 | 40 | 56 | 72;

function initialFontSize(size: RoomAvatarSize): number {
  if (size <= 34) return 12;
  if (size <= 40) return 14;
  if (size <= 56) return 18;
  return 24;
}

function emojiFontSize(size: RoomAvatarSize): number {
  if (size <= 34) return 18;
  if (size <= 40) return 20;
  if (size <= 56) return 26;
  return 34;
}

export function RoomAvatar(props: {
  title: string;
  avatar?: string | null;
  provider?: string | null;
  size?: RoomAvatarSize;
  className?: string;
}) {
  const size = props.size ?? 34;
  const trimmedAvatar = props.avatar?.trim() ?? "";
  const emoji = isRoomEmojiAvatar(props.avatar);
  const image = isRoomImageAvatar(props.avatar);
  const providerStyle = !emoji && !image ? getRuntimeProviderAvatarStyle(props.provider) : null;
  const providerIconUrl = providerStyle?.iconUrl ?? null;
  const initial = getRoomAvatarInitial(props.title);

  return (
    <span
      className={`[display:inline-grid] [place-items:center] [flex:0_0_auto] [border-radius:999px] [overflow:hidden] [line-height:1] [box-shadow:inset_0_0_0_1px_#00000012] ${
        emoji
          ? "[color:var(--text)] [background:#f3f4f6]"
          : image || providerIconUrl
            ? "[background:#ffffff]"
            : providerStyle
              ? "[font-weight:750] [box-shadow:inset_0_0_0_1px_#ffffff22]"
              : "[color:#ffffff] [background:#171717] [font-weight:750] [box-shadow:inset_0_0_0_1px_#ffffff22]"
      } ${props.className ?? ""}`}
      style={{
        width: size,
        height: size,
        fontSize: emoji ? emojiFontSize(size) : providerStyle && !providerIconUrl ? (size <= 34 ? 11 : size <= 40 ? 12 : 14) : initialFontSize(size),
        background: providerIconUrl ? undefined : providerStyle?.background,
        color: providerStyle?.color,
      }}
      aria-hidden
    >
      {image ? (
        <img
          key={props.avatar ?? "default"}
          src={props.avatar ?? undefined}
          alt=""
          className={"[width:100%] [height:100%] [object-fit:cover]"}
        />
      ) : providerIconUrl ? (
        <img
          key={providerIconUrl}
          src={providerIconUrl}
          alt=""
          className={"[width:100%] [height:100%] [object-fit:cover]"}
        />
      ) : emoji ? (
        trimmedAvatar
      ) : providerStyle ? (
        providerStyle.label
      ) : (
        initial
      )}
    </span>
  );
}
