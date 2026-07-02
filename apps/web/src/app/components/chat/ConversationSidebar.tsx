import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Pin, PinOff } from "lucide-react";
import type { Conversation, Message, Room } from "@group-chat/shared";
import { formatConversationListTimestamp } from "../../formatting.js";
import { t, useTranslation } from "../../i18n/index.js";
import type { LocalUserProfile } from "../../user-profile.js";
import { ProfileMenu } from "../settings/ProfileMenu.js";
import { RoomAvatar } from "../ui/RoomAvatar.js";
import { UnreadBadge } from "../ui/UnreadBadge.js";
import { UserAvatar } from "../ui/UserAvatar.js";
import { CreateChatIcon, SettingsLinedIcon } from "../ui/AppIcons.js";
import { buildLatestPreviewMessageIndex } from "../../conversation-preview-index.js";
import { flattenReferenceMentionsToPlainText } from "../../reference-mentions.js";

export function ConversationSidebar(props: {
  rooms: Room[];
  conversations: Conversation[];
  messages: Message[];
  currentConversationId: string | null;
  unreadCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onCreateRoom: () => void;
  onTogglePin: (conversation: Conversation, pinned: boolean) => void;
  userProfile: LocalUserProfile;
  profileMenuOpen: boolean;
  profileButtonRef: RefObject<HTMLButtonElement | null>;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  onToggleProfileMenu: () => void;
  onSaveProfile: (profile: LocalUserProfile) => void;
  onCloseProfileMenu: () => void;
}) {
  const { t, locale } = useTranslation();
  const [query, setQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{ conversationId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const roomsById = useMemo(
    () => new Map(props.rooms.map((room) => [room.id, room])),
    [props.rooms],
  );
  const conversationsById = useMemo(
    () => new Map(props.conversations.map((conversation) => [conversation.id, conversation])),
    [props.conversations],
  );
  const latestPreviewMessageByConversationId = useMemo(
    () => buildLatestPreviewMessageIndex(props.messages),
    [props.messages],
  );
  const conversationEntries = useMemo(
    () => props.conversations.flatMap((conversation) => {
      const room = roomsById.get(conversation.roomId);
      if (!room) return [];
      return [{
        conversation,
        room,
        preview: buildRecentMessagePreview(
          conversation,
          room,
          latestPreviewMessageByConversationId.get(conversation.id) ?? null,
        ),
      }];
    }),
    [latestPreviewMessageByConversationId, locale, props.conversations, roomsById],
  );
  const visibleConversationEntries = useMemo(() => {
    return conversationEntries
      .filter(({ conversation }) => {
        if (!normalizedQuery) return true;
        return conversation.title.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => sortConversations(left.conversation, right.conversation));
  }, [conversationEntries, normalizedQuery]);

  const contextConversation = contextMenu
    ? conversationsById.get(contextMenu.conversationId) ?? null
    : null;

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenu]);

  return (
    <aside className={"[display:flex] [flex-direction:column] [min-width:0] [height:100vh] [background:var(--background-panel)] max-[760px]:[display:none]"}>
      <div className={"[display:flex] [height:52px] [align-items:center] [justify-content:space-between] [gap:12px] [padding:12px_14px_10px_16px] [&_h1]:[margin:0] [&_h1]:[color:var(--text-primary)] [&_h1]:[font-size:15px] [&_h1]:[font-weight:650] [&_h1]:[line-height:1.2] [&_h1]:[letter-spacing:0] [&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px] [&_span]:[display:none]"}>
        <div>
          <h1>{t("sidebar.title")}</h1>
          <span>{t("sidebar.roomCount", { count: props.rooms.length })}</span>
        </div>
        <button className={"[display:inline-grid] [place-items:center] [border:0] [width:28px] [height:28px] [border-radius:4px] [color:var(--text-secondary)] [background:transparent] [transition:background-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--transparency-hover)] [&:focus-visible]:[outline:none] [&:focus-visible]:[background:var(--transparency-hover)]"} title={t("sidebar.newRoom")} onClick={props.onCreateRoom}>
          <CreateChatIcon size={16} />
        </button>
      </div>
      <div className={"[padding:0_4px_10px] [&_input]:[width:100%] [&_input]:[height:36px] [&_input]:[min-width:0] [&_input]:[border:0] [&_input]:[border-radius:8px] [&_input]:[padding:0_12px] [&_input]:[color:var(--text-primary)] [&_input]:[background:var(--transparency-hover)] [&_input]:[outline:none] [&_input]:[font-size:13px] [&_input::placeholder]:[color:var(--text-placeholder)] [&_input:focus]:[box-shadow:inset_0_0_0_1px_var(--line-focus-window)]"}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("sidebar.searchRooms")}
          placeholder={t("sidebar.searchPlaceholder")}
        />
      </div>
      <div className={"[display:grid] [min-height:0] [flex:1_1_auto] [align-content:start] [gap:2px] [overflow-y:auto] [padding:2px_4px_12px]"}>
        {visibleConversationEntries.length === 0 ? (
          <div className={"[display:grid] [gap:10px] [margin:8px_4px] [border:1px_dashed_var(--border-1)] [border-radius:10px] [padding:24px_14px] [color:var(--text-secondary)] [background:color-mix(in_srgb,var(--white-stationary)_60%,transparent)] [font-size:11px] [line-height:1.5] [text-align:center] [&_strong]:[color:var(--text-primary)] [&_strong]:[font-size:13px] [&_button]:[justify-self:center] [&_button]:[height:32px] [&_button]:[border:0] [&_button]:[border-radius:6px] [&_button]:[padding:0_12px] [&_button]:[color:var(--white-stationary)] [&_button]:[background:var(--black-stationary)] [&_button]:[font-size:11px] [&_button]:[font-weight:650]"}>
            <strong>{normalizedQuery ? t("sidebar.noMatchTitle") : t("sidebar.emptyTitle")}</strong>
            <span>{normalizedQuery ? t("sidebar.noMatchHint") : t("sidebar.emptyHint")}</span>
            <button type="button" onClick={props.onCreateRoom}>
              {t("sidebar.createRoom")}
            </button>
          </div>
        ) : null}
        {visibleConversationEntries.map(({ conversation, room, preview }) => {
          const unreadCount = props.unreadCounts[conversation.id] ?? 0;
          const selected = conversation.id === props.currentConversationId;
          return (
            <div
              key={conversation.id}
              className={`[position:relative] [display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:8px] [width:100%] [min-width:0] [min-height:56px] [overflow:hidden] [border:0] [border-radius:8px] [padding:8px_12px] [text-align:left] [color:var(--text-primary)] [background:transparent] [transition:background-color_0.12s_ease] ${selected ? "[background:var(--accent-bg)]" : "[&:hover]:[background:var(--transparency-hover)]"}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ conversationId: conversation.id, x: event.clientX, y: event.clientY });
              }}
            >
              <span className={"[position:relative] [display:inline-flex]"}>
                <RoomAvatar key={`${room.id}:${room.avatar ?? "default"}`} title={conversation.title} avatar={room.avatar} seed={room.id} size={32} />
                <UnreadBadge count={unreadCount} />
              </span>
              <button className={"[display:grid] [min-width:0] [border:0] [padding:0] [text-align:left] [color:inherit] [background:transparent] [&:focus-visible]:[outline:none]"} onClick={() => props.onSelect(conversation.id)}>
                <span className={"[display:flex] [min-width:0] [align-items:center] [justify-content:space-between] [gap:8px]"}>
                  <span className={"[display:flex] [min-width:0] [align-items:center] [gap:4px]"}>
                    {conversation.pinned ? (
                      <Pin size={12} className={"[flex:0_0_auto] [color:var(--text-secondary)]"} aria-hidden />
                    ) : null}
                    <span className={"[display:block] [overflow:hidden] [font-size:13px] [font-weight:600] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]"}>{conversation.title}</span>
                  </span>
                  <span data-slot="conversation-time" className={"[flex:0_0_auto] [margin-left:auto] [color:var(--text-secondary)] [font-size:11px] [text-align:right] [white-space:nowrap]"}>{formatConversationListTimestamp(resolveConversationActivityAt(conversation))}</span>
                </span>
                <span className={"[display:flex] [min-width:0] [margin-top:4px] [align-items:center] [gap:2px] [color:var(--text-secondary)] [font-size:11px] [line-height:1.35] [white-space:nowrap]"}>
                  {preview.sender ? (
                    <strong className={"[display:block] [flex:0_0_auto] [max-width:72px] [overflow:hidden] [color:inherit] [font:inherit] [font-weight:500] [text-overflow:ellipsis] [white-space:nowrap]"}>
                      {preview.sender}: 
                    </strong>
                  ) : null}
                  <span className={"[display:block] [min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{preview.content}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className={"[position:relative] [display:flex] [align-items:center] [justify-content:space-between] [gap:10px] [overflow:hidden] [border-top:1px_solid_var(--border-1)] [border-radius:0] [padding:8px_4px] [background:var(--background-panel)]"}>
        <button
          ref={props.profileButtonRef}
          type="button"
          className={"[display:flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:10px] [border:0] [border-radius:8px] [padding:12px] [color:var(--text-primary)] [background:transparent] [text-align:left] [transition:background-color_0.12s_ease] [&:hover]:[background:var(--transparency-hover)]"}
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
          <span className={"[display:block] [min-width:0] [flex:1_1_auto] [overflow:hidden] [font-size:13px] [font-weight:650] [line-height:1.25] [text-overflow:ellipsis] [white-space:nowrap]"}>
            {props.userProfile.displayName}
          </span>
          <span className={"[display:inline-grid] [width:28px] [height:28px] [flex:0_0_auto] [place-items:center] [border-radius:4px] [color:var(--text-secondary)] [background:transparent]"}>
            <SettingsLinedIcon size={16} />
          </span>
        </button>
        {props.profileMenuOpen ? (
          <ProfileMenu
            menuRef={props.profileMenuRef}
            profile={props.userProfile}
            anchor="chat"
            anchorEl={props.profileButtonRef.current}
            onSave={props.onSaveProfile}
            onClose={props.onCloseProfileMenu}
          />
        ) : null}
      </div>
      {contextMenu && contextConversation ? (
        <ConversationContextMenu
          menuRef={menuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          pinned={contextConversation.pinned}
          onTogglePin={() => {
            props.onTogglePin(contextConversation, !contextConversation.pinned);
            setContextMenu(null);
          }}
        />
      ) : null}
    </aside>
  );
}

function ConversationContextMenu(props: {
  menuRef: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const { t } = useTranslation();
  const style = {
    top: Math.min(props.y, window.innerHeight - 56),
    left: Math.min(props.x, window.innerWidth - 168),
  };

  return (
    <div
      ref={props.menuRef}
      className={"[position:fixed] [z-index:90] [min-width:148px] [overflow:hidden] [border:1px_solid_var(--border-1)] [border-radius:12px] [padding:4px] [background:var(--white-stationary)] [box-shadow:0_12px_40px_color-mix(in_srgb,var(--black-stationary)_14%,transparent)]"}
      style={style}
      role="menu"
    >
      <button
        type="button"
        className={"[display:flex] [width:100%] [align-items:center] [gap:8px] [border:0] [border-radius:8px] [padding:8px_10px] [color:var(--text-primary)] [background:transparent] [font-size:13px] [text-align:left] [&:hover]:[background:var(--background-panel)]"}
        role="menuitem"
        onClick={props.onTogglePin}
      >
        {props.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        {props.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
      </button>
    </div>
  );
}

function sortConversations(left: Conversation, right: Conversation) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return resolveConversationActivityAt(right).localeCompare(resolveConversationActivityAt(left));
}

function resolveConversationActivityAt(conversation: Conversation) {
  return conversation.lastMessageAt ?? (conversation.lastMessage ? conversation.updatedAt : conversation.createdAt);
}

function buildRecentMessagePreview(conversation: Conversation, room: Room, message: Message | null) {
  const conversationLastMessage = formatConversationPreviewContent(conversation.lastMessage || "");
  if (!message) {
    return {
      sender: "",
      content: conversationLastMessage || room.description || t("sidebar.noMessagesYet"),
    };
  }
  if (shouldPreferConversationLastMessage(conversation, message)) {
    return {
      sender: "",
      content: conversationLastMessage || t("common.attachment"),
    };
  }
  if (message.status === "deleted") {
    return {
      sender: messageSenderLabel(message),
      content: t("sidebar.messageDeleted"),
    };
  }
  if (message.status === "recalled") {
    return {
      sender: messageSenderLabel(message),
      content: t("sidebar.messageRecalled"),
    };
  }
  return {
    sender: messageSenderLabel(message),
    content: formatConversationPreviewContent(message.content)
      || conversationLastMessage
      || t("common.attachment"),
  };
}

function messageSenderLabel(message: Message) {
  if (message.role === "user") return "";
  return message.senderName || message.role;
}

function stripGeneratedReplyQuoteMarkers(content: string) {
  return content.replace(/^[ \t]*>\s?(?=(?:回复|Reply)\s+[^:：]+[:：])/gim, "");
}

function formatConversationPreviewContent(content: string) {
  return flattenReferenceMentionsToPlainText(stripGeneratedReplyQuoteMarkers(content)).trim();
}

function shouldPreferConversationLastMessage(conversation: Conversation, message: Message) {
  if (!conversation.lastMessage || !conversation.lastMessageAt) return false;
  const conversationLastMessageTime = Date.parse(conversation.lastMessageAt);
  const messageTime = Date.parse(message.createdAt);
  return Number.isFinite(conversationLastMessageTime)
    && Number.isFinite(messageTime)
    && conversationLastMessageTime > messageTime;
}
