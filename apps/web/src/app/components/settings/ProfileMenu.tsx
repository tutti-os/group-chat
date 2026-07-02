import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { X } from "lucide-react";
import type { LocalUserProfile } from "../../user-profile.js";
import { useTranslation } from "../../i18n/index.js";
import { AvatarPicker } from "../ui/AvatarPicker.js";
import { AvatarUploadButton } from "../ui/AvatarUploadButton.js";

export function ProfileMenu(props: {
  menuRef?: RefObject<HTMLDivElement | null>;
  profile: LocalUserProfile;
  anchor?: "rail" | "mobile" | "chat";
  anchorEl?: HTMLElement | null;
  onSave: (profile: LocalUserProfile) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<LocalUserProfile>(props.profile);
  const [chatPosition, setChatPosition] = useState<CSSProperties | undefined>();
  const localMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(props.profile);
  }, [props.profile]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  useLayoutEffect(() => {
    if (props.anchor !== "chat" || !props.anchorEl) {
      setChatPosition(undefined);
      return;
    }

    const updatePosition = () => {
      const anchorRect = props.anchorEl!.getBoundingClientRect();
      const menuNode = localMenuRef.current;
      const menuWidth = menuNode?.offsetWidth ?? 340;
      const menuHeight = menuNode?.offsetHeight ?? 420;
      const gutter = 10;
      const viewportPadding = 12;

      let left = anchorRect.right + gutter;
      let top = anchorRect.top;

      if (left + menuWidth > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, anchorRect.left - menuWidth - gutter);
      }
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding);
      }

      setChatPosition({ position: "fixed", top, left, zIndex: 70 });
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchor, props.anchorEl]);

  const positionClass =
    props.anchor === "mobile"
      ? "[position:fixed] [top:12px] [left:12px] [z-index:60]"
      : props.anchor === "chat"
        ? ""
        : "[position:absolute] [top:0] [left:calc(100%+10px)] [z-index:60]";
  const menuStyle = useMemo<CSSProperties | undefined>(() => {
    if (props.anchor !== "chat") return undefined;
    return chatPosition ?? { position: "fixed", top: 0, left: 0, zIndex: 70, visibility: "hidden" };
  }, [chatPosition, props.anchor]);

  const save = () => {
    const next: LocalUserProfile = {
      ...draft,
      displayName: draft.displayName.trim() || props.profile.displayName,
    };
    props.onSave(next);
  };

  return (
    <div
      ref={(node) => {
        localMenuRef.current = node;
        if (props.menuRef) props.menuRef.current = node;
      }}
      style={menuStyle}
      className={`${positionClass} [width:min(340px,_calc(100vw_-_24px))] [overflow:hidden] [border:1px_solid_var(--border-1)] [border-radius:18px] [background:var(--white-stationary)] [box-shadow:0_20px_56px_color-mix(in_srgb,var(--black-stationary)_16%,transparent),_0_2px_8px_color-mix(in_srgb,var(--black-stationary)_6%,transparent)]`}
      role="dialog"
      aria-label={t("profileMenu.editProfile")}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:12px] [padding:14px_16px_0]"}>
        <h2 className={"[margin:0] [color:var(--text-primary)] [font-size:15px] [font-weight:680] [line-height:1.2]"}>{t("profileMenu.title")}</h2>
        <button
          type="button"
          className={"dialog-close-button [display:grid] [width:30px] [height:30px] [flex-shrink:0] [place-items:center] [border:0] [border-radius:999px] [color:var(--text-secondary)] [background:transparent] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--transparency-hover)]"}
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={props.onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className={"[display:flex] [align-items:center] [gap:14px] [padding:14px_16px_0]"}>
        <AvatarUploadButton
          size={58}
          preset={draft.avatarPreset}
          customAvatarUrl={draft.customAvatarUrl}
          onUpload={(customAvatarUrl) => setDraft((current) => ({ ...current, customAvatarUrl }))}
        />
        <div className={"[display:grid] [gap:6px] [min-width:0] [flex:1]"}>
          <label className={"[color:var(--text-secondary)] [font-size:11px] [font-weight:650] [line-height:1]"} htmlFor="profile-display-name">
            {t("profileMenu.name")}
          </label>
          <input
            id="profile-display-name"
            className={"[width:100%] [height:38px] [border:1px_solid_var(--border-1)] [border-radius:11px] [padding:0_11px] [color:var(--text-primary)] [background:var(--white-stationary)] [font-size:13px] [font-weight:620] [outline:none] focus:[border-color:var(--line-focus-window)] focus:[box-shadow:0_0_0_3px_var(--transparency-hover)]"}
            value={draft.displayName}
            maxLength={32}
            placeholder={t("profileMenu.namePlaceholder")}
            onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
          />
        </div>
      </div>

      <section className={"[padding:16px_16px_0]"}>
        <h3 className={"[margin:0_0_10px] [color:var(--text-secondary)] [font-size:11px] [font-weight:650] [line-height:1] [letter-spacing:0.02em]"}>
          {t("profileMenu.pickAvatar")}
        </h3>
        <AvatarPicker
          compact
          profile={draft}
          onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
        />
      </section>

      <footer className={"[display:flex] [justify-content:flex-end] [gap:8px] [margin-top:16px] [padding:12px_16px_14px] [border-top:1px_solid_var(--border-1)]"}>
        <button
          type="button"
          className={"[display:inline-flex] [height:34px] [align-items:center] [justify-content:center] [border:1px_solid_var(--border-1)] [border-radius:10px] [padding:0_14px] [color:var(--text-primary)] [background:var(--white-stationary)] [font-size:13px] [font-weight:650] [&:hover]:[background:var(--background-panel)]"}
          onClick={props.onClose}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={"[display:inline-flex] [height:34px] [align-items:center] [justify-content:center] [border:0] [border-radius:10px] [padding:0_14px] [color:var(--white-stationary)] [background:var(--black-stationary)] [font-size:13px] [font-weight:700] [&:hover]:[background:var(--accent-codex)]"}
          onClick={save}
        >
          {t("common.save")}
        </button>
      </footer>
    </div>
  );
}
