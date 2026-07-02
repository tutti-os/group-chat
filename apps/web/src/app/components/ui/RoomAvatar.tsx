import {
  getDefaultRoomAvatarBackground,
  getRoomAvatarInitial,
  isRoomEmojiAvatar,
  isRoomImageAvatar,
} from "../../room-avatar.js";
import { getRuntimeProviderAvatarStyle } from "../../identity-avatar.js";

export type RoomAvatarSize = 32 | 34 | 36 | 40 | 56 | 72;

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
  seed?: string;
  size?: RoomAvatarSize;
  contentSizeOffset?: number;
  className?: string;
}) {
  const size = props.size ?? 34;
  const contentSizeOffset = props.contentSizeOffset ?? 0;
  const trimmedAvatar = props.avatar?.trim() ?? "";
  const emoji = isRoomEmojiAvatar(props.avatar);
  const image = isRoomImageAvatar(props.avatar);
  const providerStyle = !emoji && !image ? getRuntimeProviderAvatarStyle(props.provider) : null;
  const providerIconUrl = providerStyle?.iconUrl ?? null;
  const defaultBackground = !emoji && !image && !providerStyle
    ? getDefaultRoomAvatarBackground(props.seed ?? props.title)
    : undefined;
  const initial = getRoomAvatarInitial(props.title);

  return (
    <span
      className={`[display:inline-grid] [place-items:center] [flex:0_0_auto] [border-radius:999px] [overflow:hidden] [line-height:1] [box-shadow:inset_0_0_0_1px_var(--line-focus-window)] ${
        emoji
          ? "[color:var(--text-primary)] [background:var(--background-panel)]"
          : providerIconUrl
            ? "[border-radius:0] [background:var(--white-stationary)] [box-shadow:none]"
            : image
              ? "[background:var(--white-stationary)] [box-shadow:none]"
            : providerStyle
              ? "[font-weight:750] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--white-stationary)_13%,transparent)]"
              : "[color:var(--white-stationary)] [background:var(--black-stationary)] [font-weight:750] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--white-stationary)_13%,transparent)]"
      } ${props.className ?? ""}`}
      style={{
        width: size,
        height: size,
        fontSize: emoji ? emojiFontSize(size) : providerStyle && !providerIconUrl ? (size <= 34 ? 11 : size <= 40 ? 12 : 14) : initialFontSize(size),
        background: providerIconUrl ? undefined : providerStyle?.background ?? defaultBackground,
        color: providerStyle?.color,
      }}
      aria-hidden
    >
      {image ? (
        <img
          key={props.avatar ?? "default"}
          src={props.avatar ?? undefined}
          alt=""
          className={"[display:block] [width:100%] [height:100%] [object-fit:cover]"}
          style={{ width: size + contentSizeOffset, height: size + contentSizeOffset }}
        />
      ) : providerIconUrl ? (
        <img
          key={providerIconUrl}
          src={providerIconUrl}
          alt=""
          className={"[display:block] [width:100%] [height:100%] [object-fit:cover]"}
          style={{ width: size + contentSizeOffset, height: size + contentSizeOffset }}
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
