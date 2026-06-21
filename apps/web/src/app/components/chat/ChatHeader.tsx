import { useEffect, useState, type RefObject } from "react";
import { Bot, Files, Search, UserPlus } from "lucide-react";
import type { Conversation, Message, Participant, Room, UpdateRoomRequest } from "@group-chat/shared";
import type { LocalUserProfile } from "../../user-profile.js";
import { useTranslation } from "../../i18n/index.js";
import { ChatMessageSearch } from "./ChatMessageSearch.js";
import { RoomSettingsDialog } from "./RoomSettingsDialog.js";
import { RoomAvatar } from "../ui/RoomAvatar.js";
import { HoverTooltip } from "../ui/HoverTooltip.js";
import { UserAvatar } from "../ui/UserAvatar.js";

export function ChatHeader(props: {
  room: Room;
  conversation: Conversation;
  participants: Participant[];
  agentCount: number;
  messages: Message[];
  agentsOpen: boolean;
  filesOpen: boolean;
  userProfile: Pick<LocalUserProfile, "displayName" | "avatarPreset" | "customAvatarUrl">;
  profileMenuOpen: boolean;
  profileButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleProfileMenu: () => void;
  onUpdateRoom: (roomId: string, input: UpdateRoomRequest) => Promise<unknown>;
  onDeleteRoom: () => void | Promise<void>;
  onRoomPreviewChange?: (roomId: string, input: UpdateRoomRequest) => void;
  onToggleAgents: () => void;
  onToggleFiles: () => void;
  onInvitePeople: () => void;
  onFocusMessage: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setSettingsOpen(false);
    setSearchOpen(false);
  }, [props.conversation.id]);

  return (
    <>
      <header className={"[&_h2]:[margin:0] [&_h2]:[color:var(--text)] [&_h2]:[font-size:16px] [&_h2]:[font-weight:650] [&_h2]:[line-height:1.2] [&_h2]:[letter-spacing:0] [&_p]:[color:var(--muted)] [&_p]:[font-size:12px] [&_small]:[color:var(--muted)] [&_small]:[font-size:12px] [display:flex] [position:relative] [z-index:25] [height:56px] [align-items:center] [justify-content:space-between] [flex-wrap:nowrap] [gap:12px] [padding:0_16px] [border-bottom:1px_solid_var(--border)] [background:var(--panel)] [overflow:visible] [&_p]:[display:none] [&_p]:[margin:3px_0_0] [&_small]:[display:none] [&_small]:[margin-top:3px] max-[760px]:[padding-inline:12px]"}>
        <div className={"[display:flex] [min-width:0] [align-items:center] [gap:10px]"}>
          <button
            ref={props.profileButtonRef}
            type="button"
            className={`[display:none] [width:34px] [height:34px] [place-items:center] [border:0] [border-radius:999px] [padding:0] [background:transparent] [transition:transform_0.12s_ease,_box-shadow_0.12s_ease] [&:hover]:[transform:scale(1.04)] [&:hover]:[box-shadow:0_0_0_2px_var(--border-strong)] max-[760px]:[display:grid] ${props.profileMenuOpen ? "max-[760px]:[box-shadow:0_0_0_2px_var(--border-strong)]" : ""}`}
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
          <button
            type="button"
            className={"[display:inline-grid] [border:0] [padding:0] [background:transparent] [&:hover]:[opacity:0.88] [&:focus-visible]:[outline:none]"}
            aria-label={t("chatHeader.openRoomSettings")}
            title={t("chatHeader.openRoomSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            <RoomAvatar key={props.room.avatar ?? "default"} title={props.conversation.title} avatar={props.room.avatar} size={34} />
          </button>
          <button
            type="button"
            className={"[display:block] [height:24px] [max-width:min(320px,_36vw)] [overflow:hidden] [border:0] [padding:0] [color:var(--text)] [background:transparent] [text-align:left] [font-size:16px] [font-weight:650] [line-height:24px] [letter-spacing:0] [text-overflow:ellipsis] [white-space:nowrap] [&:hover]:[text-decoration:underline] [&:focus-visible]:[outline:none] [&:focus-visible]:[text-decoration:underline] max-[760px]:[max-width:36vw]"}
            aria-label={t("chatHeader.openRoomSettings")}
            title={t("chatHeader.openRoomSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            {props.conversation.title}
          </button>
          <HoverTooltip label={t("chatHeader.manageAgents")}>
            <button
              type="button"
              className={`[display:inline-flex] [height:26px] [align-items:center] [gap:5px] [border:1px_solid_var(--border)] [border-radius:999px] [padding:0_8px] [color:var(--muted)] [background:#ffffff] [font-size:12px] [font-weight:700] [line-height:1] [transition:background-color_0.12s_ease,_border-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text)] [&:hover]:[background:#f7f7f8] [&:focus-visible]:[outline:none] [&:focus-visible]:[border-color:var(--border-strong)] ${props.agentsOpen ? "[border-color:var(--border-strong)] [color:var(--text)] [background:#f7f7f8]" : ""}`}
              aria-label={t("chatHeader.manageAgents")}
              onClick={props.onToggleAgents}
            >
              <Bot size={13} />
              <span>{props.agentCount}</span>
            </button>
          </HoverTooltip>
          <p>{props.room.description || t("chatHeader.defaultDescription")}</p>
        </div>
        <div className={"[display:flex] [align-items:center] [gap:6px] [overflow:visible] max-[760px]:[width:100%] max-[760px]:[overflow-x:auto] max-[760px]:[overflow-y:visible]"}>
          <HoverTooltip label={t("chatHeader.searchMessages")}>
            <button
              type="button"
              className={`[display:inline-grid] [width:30px] [height:30px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#00000008] [transition:background-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none] ${searchOpen ? "![color:var(--text)] ![background:#00000012]" : ""}`}
              aria-label={t("chatHeader.searchMessages")}
              onClick={() => setSearchOpen((current) => !current)}
            >
              <Search size={15} />
            </button>
          </HoverTooltip>
          <HoverTooltip label={t("chatHeader.viewFiles")}>
            <button
              type="button"
              className={`[display:inline-grid] [width:30px] [height:30px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:#00000008] [transition:background-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none] ${props.filesOpen ? "![color:var(--text)] ![background:#00000012]" : ""}`}
              aria-label={t("chatHeader.viewFiles")}
              onClick={() => {
                setSearchOpen(false);
                props.onToggleFiles();
              }}
            >
              <Files size={15} />
            </button>
          </HoverTooltip>
          <HoverTooltip label={t("chatHeader.inviteMembers")}>
            <button
              type="button"
              className={"[display:inline-flex] [height:30px] [align-items:center] [gap:6px] [border:0] [border-radius:999px] [padding:0_10px] [color:var(--muted)] [background:#00000008] [font-size:12px] [font-weight:650] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
              aria-label={t("chatHeader.inviteMembers")}
              onClick={props.onInvitePeople}
            >
              <UserPlus size={13} />
              <span>{t("chatHeader.invite")}</span>
            </button>
          </HoverTooltip>
        </div>
        <ChatMessageSearch
          open={searchOpen}
          messages={props.messages}
          onClose={() => setSearchOpen(false)}
          onFocusMessage={props.onFocusMessage}
        />
      </header>
      {settingsOpen ? (
        <RoomSettingsDialog
          room={props.room}
          onUpdateRoom={props.onUpdateRoom}
          onDeleteRoom={props.onDeleteRoom}
          onPreviewChange={(input) => props.onRoomPreviewChange?.(props.room.id, input)}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}
