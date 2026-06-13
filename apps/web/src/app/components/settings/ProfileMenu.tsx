import { useEffect, useRef, useState, type RefObject } from "react";
import type { LocalUserProfile } from "../../user-profile.js";
import { AvatarPicker } from "../ui/AvatarPicker.js";
import { AvatarUploadButton } from "../ui/AvatarUploadButton.js";

export function ProfileMenu(props: {
  menuRef?: RefObject<HTMLDivElement | null>;
  profile: LocalUserProfile;
  anchor?: "rail" | "mobile";
  onSave: (profile: LocalUserProfile) => void;
}) {
  const [draft, setDraft] = useState<LocalUserProfile>(props.profile);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(props.profile);
  }, [props.profile]);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const positionClass =
    props.anchor === "mobile"
      ? "[position:fixed] [top:12px] [left:12px] [z-index:60]"
      : "[position:absolute] [top:0] [left:calc(100%+8px)] [z-index:60]";

  const save = () => {
    const next: LocalUserProfile = {
      ...draft,
      displayName: draft.displayName.trim() || props.profile.displayName,
    };
    props.onSave(next);
  };

  return (
    <div
      ref={props.menuRef}
      className={`${positionClass} [width:min(320px,_calc(100vw_-_24px))] [border-radius:20px] [padding:14px] [background:#ffffff] [box-shadow:0_18px_60px_rgb(0_0_0_/_18%)]`}
      role="dialog"
      aria-label="编辑个人资料"
    >
      <div className={"[display:flex] [align-items:flex-start] [gap:12px] [margin-bottom:12px]"}>
        <AvatarUploadButton
          size={58}
          preset={draft.avatarPreset}
          customAvatarUrl={draft.customAvatarUrl}
          onUpload={(customAvatarUrl) => setDraft((current) => ({ ...current, customAvatarUrl }))}
        />
        <div className={"[display:grid] [gap:4px] [min-width:0] [flex:1]"}>
          <label className={"[color:var(--muted)] [font-size:11px] [font-weight:680]"} htmlFor="profile-display-name">
            名称
          </label>
          <input
            id="profile-display-name"
            ref={nameRef}
            className={"[width:100%] [height:36px] [border:1px_solid_var(--border-strong)] [border-radius:10px] [padding:0_10px] [color:var(--text)] [background:#f7f7f8] [font-size:14px] [font-weight:650] [outline:none] focus:[border-color:var(--primary)]"}
            value={draft.displayName}
            maxLength={32}
            onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
          />
          <span className={"[color:var(--muted)] [font-size:11px]"}>Local workspace</span>
        </div>
      </div>

      <AvatarPicker
        compact
        profile={draft}
        onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
      />

      <div className={"[display:flex] [justify-content:flex-end] [gap:8px] [margin-top:14px] [padding-top:12px] [border-top:1px_solid_var(--border)]"}>
        <button
          type="button"
          className={"[display:inline-flex] [height:34px] [align-items:center] [justify-content:center] [border:0] [border-radius:10px] [padding:0_14px] [color:var(--primary-contrast)] [background:var(--primary)] [font-size:13px] [font-weight:700]"}
          onClick={save}
        >
          保存
        </button>
      </div>
    </div>
  );
}
