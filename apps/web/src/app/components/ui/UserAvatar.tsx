import type { AvatarPresetId, LocalUserProfile } from "../../user-profile.js";
import { SAIYAN_AVATAR_ART, SaiyanAvatarSvg } from "./saiyan-avatar-art.js";

export type UserAvatarSize = 34 | 40 | 48 | 58 | 68;

export function UserAvatar(props: {
  size?: UserAvatarSize;
  preset: AvatarPresetId;
  customAvatarUrl?: string | null;
  selected?: boolean;
  className?: string;
}) {
  const size = props.size ?? 40;
  const ringClass = props.selected ? "[box-shadow:0_0_0_3px_#ffffff,_0_0_0_5px_#171717]" : "";

  if (props.customAvatarUrl) {
    return (
      <img
        src={props.customAvatarUrl}
        alt=""
        className={`[display:block] [border-radius:999px] [object-fit:cover] [flex:0_0_auto] ${ringClass} ${props.className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`[display:inline-grid] [place-items:center] [overflow:hidden] [border-radius:999px] [flex:0_0_auto] ${ringClass} ${props.className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <SaiyanAvatarSvg art={SAIYAN_AVATAR_ART[props.preset]} size={size} clipId={`avatar-${props.preset}-${size}`} />
    </span>
  );
}

export function userAvatarFromProfile(
  profile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">,
  size?: UserAvatarSize,
  selected?: boolean,
) {
  return (
    <UserAvatar
      size={size}
      preset={profile.avatarPreset}
      customAvatarUrl={profile.customAvatarUrl}
      selected={selected}
    />
  );
}
