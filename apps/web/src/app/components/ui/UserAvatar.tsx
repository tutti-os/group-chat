import { avatarPresetUrl, type AvatarPresetId, type LocalUserProfile } from "../../user-profile.js";

export type UserAvatarSize = 34 | 40 | 48 | 58 | 68;

export function UserAvatar(props: {
  size?: UserAvatarSize;
  preset: AvatarPresetId;
  customAvatarUrl?: string | null;
  selected?: boolean;
  className?: string;
}) {
  const size = props.size ?? 40;
  const ringClass = props.selected ? "[box-shadow:0_0_0_3px_var(--white-stationary),_0_0_0_5px_var(--black-stationary)]" : "";

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
    <img
      src={avatarPresetUrl(props.preset)}
      alt=""
      className={`[display:block] [overflow:hidden] [border-radius:999px] [object-fit:cover] [flex:0_0_auto] ${ringClass} ${props.className ?? ""}`}
      style={{ width: size, height: size }}
    />
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
