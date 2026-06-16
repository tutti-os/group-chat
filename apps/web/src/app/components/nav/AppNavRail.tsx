import type { RefObject, ReactNode } from "react";
import { Settings } from "lucide-react";
import type { LocalUserProfile } from "../../user-profile.js";
import { useTranslation } from "../../i18n/index.js";
import { ProfileMenu } from "../settings/ProfileMenu.js";
import { UnreadBadge } from "../ui/UnreadBadge.js";
import { UserAvatar } from "../ui/UserAvatar.js";
import { ChatsNavIcon } from "./NavSectionIcons.js";

function NavIconButton(props: {
  active: boolean;
  title: string;
  ariaLabel: string;
  onClick?: () => void;
  unreadCount?: number;
  colorful?: boolean;
  children: ReactNode;
}) {
  const colorful = props.colorful ?? false;
  return (
    <button
      type="button"
      className={`[position:relative] [display:inline-grid] [place-items:center] [border:0] [width:38px] [height:38px] [border-radius:12px] [transition:background-color_0.12s_ease,_color_0.12s_ease,_transform_0.12s_ease] ${colorful
        ? "[background:transparent] [&:hover]:[transform:scale(1.04)]"
        : `[color:var(--muted)] [background:transparent] [&:hover]:[color:var(--text)] [&:hover]:[background:var(--sidebar-hover)] ${props.active ? "[color:var(--text)] [background:var(--accent-soft)]" : ""}`
      }`}
      title={props.title}
      aria-label={props.ariaLabel}
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
    >
      {!colorful && props.active ? (
        <span
          className={"[position:absolute] [left:0] [top:50%] [width:3px] [height:20px] [transform:translateY(-50%)] [border-radius:0_3px_3px_0] [background:var(--primary)]"}
          aria-hidden
        />
      ) : null}
      {props.children}
      {props.unreadCount && props.unreadCount > 0 ? (
        <UnreadBadge count={props.unreadCount} size="md" className={"[top:-5px] [right:-5px] [border-color:var(--panel)]"} />
      ) : null}
    </button>
  );
}

export function AppNavRail(props: {
  profileMenuOpen: boolean;
  onToggleProfileMenu: () => void;
  onOpenSettings: () => void;
  profileButtonRef: RefObject<HTMLButtonElement | null>;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  userProfile: LocalUserProfile;
  onSaveProfile: (profile: LocalUserProfile) => void;
  onCloseProfileMenu: () => void;
  totalUnreadCount?: number;
}) {
  const { t } = useTranslation();
  return (
    <aside className={"[position:relative] [display:flex] [flex-direction:column] [align-items:center] [gap:8px] [padding:12px_10px] [border-right:1px_solid_var(--border)] [background:var(--panel)] max-[760px]:[display:none]"}>
      <div className={"[position:relative] [margin-bottom:10px]"}>
        <button
          ref={props.profileButtonRef}
          type="button"
          className={`[display:grid] [width:40px] [height:40px] [place-items:center] [border:0] [border-radius:999px] [padding:0] [background:transparent] [transition:transform_0.12s_ease,_box-shadow_0.12s_ease] [&:hover]:[transform:scale(1.04)] [&:hover]:[box-shadow:0_0_0_2px_var(--border-strong)] ${props.profileMenuOpen ? "[box-shadow:0_0_0_2px_var(--border-strong)]" : ""}`}
          aria-label={`${props.userProfile.displayName} profile`}
          title={props.userProfile.displayName}
          aria-expanded={props.profileMenuOpen}
          aria-haspopup="menu"
          onClick={props.onToggleProfileMenu}
        >
          <UserAvatar
            size={34}
            preset={props.userProfile.avatarPreset}
            customAvatarUrl={props.userProfile.customAvatarUrl}
          />
        </button>
        {props.profileMenuOpen ? (
          <ProfileMenu
            menuRef={props.profileMenuRef}
            profile={props.userProfile}
            anchor="rail"
            onSave={props.onSaveProfile}
            onClose={props.onCloseProfileMenu}
          />
        ) : null}
      </div>

      <NavIconButton
        active
        title={t("nav.messages")}
        ariaLabel={t("nav.messages")}
        colorful
        unreadCount={props.totalUnreadCount}
      >
        <ChatsNavIcon active />
      </NavIconButton>

      <div className={"[flex:1_1_auto]"} />

      <NavIconButton active={false} title={t("nav.settings")} ariaLabel={t("nav.settings")} onClick={props.onOpenSettings}>
        <Settings size={20} />
      </NavIconButton>
    </aside>
  );
}
