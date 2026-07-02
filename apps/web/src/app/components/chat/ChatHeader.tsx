import { useEffect, useState, type RefObject } from "react";
import { Search, UserPlus } from "lucide-react";
import type { Artifact, Conversation, Identity, Message, MessageBlock, Participant, Room, RuntimeProfile, UpdateRoomRequest } from "@group-chat/shared";
import type { BackgroundTask } from "../../background-tasks.js";
import type { LocalUserProfile } from "../../user-profile.js";
import { useTranslation } from "../../i18n/index.js";
import { RoomSettingsDialog } from "./RoomSettingsDialog.js";
import { RoomAvatar } from "../ui/RoomAvatar.js";
import { HoverTooltip } from "../ui/HoverTooltip.js";
import { UserAvatar } from "../ui/UserAvatar.js";
import { AgentLinedIcon, FolderLinedIcon } from "../ui/AppIcons.js";

export function ChatHeader(props: {
  room: Room;
  conversation: Conversation;
  participants: Participant[];
  allParticipants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  conversations: Conversation[];
  rooms: Room[];
  artifacts: Artifact[];
  allMessages: Message[];
  allBlocks: MessageBlock[];
  summaryTasks: BackgroundTask[];
  agentCount: number;
  messages: Message[];
  agentsOpen: boolean;
  filesOpen: boolean;
  searchOpen: boolean;
  userProfile: Pick<LocalUserProfile, "displayName" | "avatarPreset" | "customAvatarUrl">;
  profileMenuOpen: boolean;
  profileButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleProfileMenu: () => void;
  onUpdateRoom: (roomId: string, input: UpdateRoomRequest) => Promise<unknown>;
  onDeleteRoom: () => void | Promise<void>;
  onRoomPreviewChange?: (roomId: string, input: UpdateRoomRequest) => void;
  onToggleAgents: () => void;
  onToggleFiles: () => void;
  onToggleSearch: () => void;
  onInvitePeople: () => void;
  onFocusMessage: (messageId: string) => void;
  onOpenMessageLink: (messageIdSegment: string) => void;
  onOpenSummaryLink: (taskId: string) => void;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
  onOpenArtifact?: (artifact: Artifact) => void;
  onOpenAgentProfile?: (participant: Participant) => void;
}) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const roomDescription = props.room.description.trim();
  const defaultDescription = t("chatHeader.defaultDescription").trim();
  const headerDescription = roomDescription || defaultDescription;

  useEffect(() => {
    setSettingsOpen(false);
  }, [props.conversation.id]);

  return (
    <>
      <header className={"[&_h2]:[margin:0] [&_h2]:[color:var(--text-primary)] [&_h2]:[font-size:15px] [&_h2]:[font-weight:650] [&_h2]:[line-height:1.2] [&_h2]:[letter-spacing:0] [&_p]:[color:var(--text-secondary)] [&_p]:[font-size:11px] [&_small]:[color:var(--text-secondary)] [&_small]:[font-size:11px] [display:flex] [position:relative] [z-index:25] [height:56px] [align-items:center] [justify-content:space-between] [flex-wrap:nowrap] [gap:12px] [padding:0_16px] [border-bottom:1px_solid_var(--border-1)] [background:var(--background-panel)] [overflow:visible] [&_p]:[display:none] [&_p]:[margin:3px_0_0] [&_small]:[display:none] [&_small]:[margin-top:3px] max-[760px]:[padding-inline:12px]"}>
        <div className={"[display:flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:10px]"}>
          <button
            ref={props.profileButtonRef}
            type="button"
            className={`[display:none] [width:34px] [height:34px] [place-items:center] [border:0] [border-radius:999px] [padding:0] [background:transparent] [transition:transform_0.12s_ease,_box-shadow_0.12s_ease] [&:hover]:[transform:scale(1.04)] [&:hover]:[box-shadow:0_0_0_2px_var(--line-focus-window)] max-[760px]:[display:grid] ${props.profileMenuOpen ? "max-[760px]:[box-shadow:0_0_0_2px_var(--line-focus-window)]" : ""}`}
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
          <span aria-hidden="true" className={"[display:none] [width:1px] [height:24px] [flex:0_0_auto] [background:var(--border-1)] max-[760px]:[display:block]"} />
          <button
            type="button"
            className={"[display:inline-grid] [border:0] [padding:0] [background:transparent] [&:hover]:[opacity:0.88] [&:focus-visible]:[outline:none]"}
            aria-label={t("chatHeader.openRoomSettings")}
            title={t("chatHeader.openRoomSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            <RoomAvatar key={props.room.avatar ?? "default"} title={props.conversation.title} avatar={props.room.avatar} seed={props.room.id} size={32} />
          </button>
          <button
            type="button"
            className={"[display:block] [height:24px] [flex:0_0_auto] [border:0] [padding:0] [color:var(--text-primary)] [background:transparent] [text-align:left] [font-size:15px] [font-weight:650] [line-height:24px] [letter-spacing:0] [white-space:nowrap] [&:hover]:[text-decoration:none] [&:focus-visible]:[outline:none] [&:focus-visible]:[text-decoration:none]"}
            aria-label={t("chatHeader.openRoomSettings")}
            title={t("chatHeader.openRoomSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            {props.conversation.title}
          </button>
          <HoverTooltip label={t("chatHeader.manageAgents")}>
            <button
              type="button"
              className={`[display:inline-flex] [height:26px] [align-items:center] [gap:5px] [border:1px_solid_var(--border-1)] [border-radius:999px] [padding:0_8px] [color:var(--text-secondary)] [background:var(--white-stationary)] [font-size:11px] [font-weight:700] [line-height:1] [transition:background-color_0.12s_ease,_border-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--background-panel)] [&:focus-visible]:[outline:none] [&:focus-visible]:[border-color:var(--line-focus-window)] ${props.agentsOpen ? "[border-color:var(--line-focus-window)] [color:var(--text-primary)] [background:var(--background-panel)]" : ""}`}
              aria-label={t("chatHeader.manageAgents")}
              onClick={props.onToggleAgents}
            >
              <AgentLinedIcon size={16} />
              <span>{props.agentCount}</span>
            </button>
          </HoverTooltip>
          {headerDescription ? <p>{headerDescription}</p> : null}
        </div>
        <div className={"[display:flex] [margin-left:auto] [flex:0_0_auto] [align-items:center] [gap:6px] [overflow:visible] max-[760px]:[overflow-x:auto] max-[760px]:[overflow-y:visible]"}>
          <HoverTooltip label={t("chatHeader.searchMessages")}>
            <button
              type="button"
              className={`[display:inline-grid] [width:28px] [height:28px] [place-items:center] [border:0] [border-radius:4px] [color:var(--text-secondary)] [background:transparent] [transition:background-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--transparency-hover)] [&:focus-visible]:[outline:none] ${props.searchOpen ? "![color:var(--text-primary)] ![background:var(--transparency-hover)]" : ""}`}
              aria-label={t("chatHeader.searchMessages")}
              onClick={props.onToggleSearch}
            >
              <Search size={16} />
            </button>
          </HoverTooltip>
          <HoverTooltip label={t("chatHeader.viewFiles")}>
            <button
              type="button"
              className={`[display:inline-grid] [width:28px] [height:28px] [place-items:center] [border:0] [border-radius:4px] [color:var(--text-secondary)] [background:transparent] [transition:background-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--transparency-hover)] [&:focus-visible]:[outline:none] ${props.filesOpen ? "![color:var(--text-primary)] ![background:var(--transparency-hover)]" : ""}`}
              aria-label={t("chatHeader.viewFiles")}
              onClick={props.onToggleFiles}
            >
              <FolderLinedIcon size={16} />
            </button>
          </HoverTooltip>
          <HoverTooltip label={t("chatHeader.inviteMembers")}>
            <button
              type="button"
              className={"[display:inline-flex] [height:28px] [align-items:center] [gap:6px] [border:0] [border-radius:4px] [padding:0_8px] [color:var(--text-secondary)] [background:transparent] [font-size:11px] [font-weight:650] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--transparency-hover)] [&:focus-visible]:[outline:none] [&:focus-visible]:[background:var(--transparency-hover)]"}
              aria-label={t("chatHeader.inviteMembers")}
              onClick={props.onInvitePeople}
            >
              <UserPlus size={16} />
              <span>{t("chatHeader.invite")}</span>
            </button>
          </HoverTooltip>
        </div>
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
