import {
  AVATAR_PRESET_IDS,
  avatarPresetLabel,
  type AvatarPresetId,
  type LocalUserProfile,
} from "../../user-profile.js";
import { useTranslation } from "../../i18n/index.js";
import { UserAvatar } from "./UserAvatar.js";

export function AvatarPicker(props: {
  profile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">;
  onChange: (next: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const usingCustom = Boolean(props.profile.customAvatarUrl);
  const selectedPreset = usingCustom ? null : props.profile.avatarPreset;
  const buttonSize: 34 | 40 = props.compact ? 34 : 40;
  const cellSize = buttonSize + 6;

  const pickPreset = (preset: AvatarPresetId) => {
    props.onChange({ avatarPreset: preset, customAvatarUrl: null });
  };

  return (
    <div
      className={"[display:grid] [grid-template-columns:repeat(5,_minmax(0,_1fr))] [gap:8px] [width:100%]"}
      aria-label={t("upload.defaultAvatar")}
    >
      {AVATAR_PRESET_IDS.map((preset) => {
        const selected = !usingCustom && selectedPreset === preset;
        return (
          <button
            key={preset}
            type="button"
            className={`[position:relative] [display:inline-grid] [justify-self:center] [place-items:center] [border:1px_solid_var(--border)] [border-radius:999px] [padding:0] [background:#ffffff] [&:hover]:[border-color:#0000002a] ${selected ? "![border-color:#171717] ![box-shadow:0_0_0_2px_#ffffff,_0_0_0_4px_#171717]" : ""}`}
            style={{ width: cellSize, height: cellSize }}
            aria-label={avatarPresetLabel(preset)}
            aria-pressed={selected}
            title={avatarPresetLabel(preset)}
            onClick={() => pickPreset(preset)}
          >
            <UserAvatar size={buttonSize} preset={preset} />
          </button>
        );
      })}
    </div>
  );
}
