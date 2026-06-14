import { useEffect, useRef, useState, type RefObject } from "react";
import { MessageSquarePlus, Pin, PinOff, Trash2 } from "lucide-react";
import type { Conversation, Message, Room } from "@group-chat/shared";
import { formatShortDate } from "../../formatting.js";
import { RoomAvatar } from "../ui/RoomAvatar.js";
import { UnreadBadge } from "../ui/UnreadBadge.js";

export function ConversationSidebar(props: {
  rooms: Room[];
  conversations: Conversation[];
  messages: Message[];
  currentConversationId: string | null;
  unreadCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onCreateRoom: () => void;
  onDeleteRoom: (room: Room, conversation: Conversation) => void;
  onTogglePin: (conversation: Conversation, pinned: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{ conversationId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const visibleConversations = props.conversations
    .filter((conversation) => {
      const room = props.rooms.find((item) => item.id === conversation.roomId);
      if (!room) return false;
      const preview = buildRecentMessagePreview(conversation, room, props.messages);
      if (!normalizedQuery) return true;
      return [conversation.title, conversation.lastMessage, preview.sender, preview.content, room.title, room.description]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery));
    })
    .slice()
    .sort(sortConversations);

  const contextConversation = contextMenu
    ? props.conversations.find((item) => item.id === contextMenu.conversationId) ?? null
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
    <aside className={"[min-width:0] [background:var(--panel)] max-[760px]:[display:none]"}>
      <div className={"[display:flex] [height:52px] [align-items:center] [justify-content:space-between] [gap:12px] [padding:12px_14px_10px_16px] [&_h1]:[margin:0] [&_h1]:[color:var(--text)] [&_h1]:[font-size:16px] [&_h1]:[font-weight:650] [&_h1]:[line-height:1.2] [&_h1]:[letter-spacing:0] [&_span]:[color:var(--muted)] [&_span]:[font-size:12px] [&_span]:[display:none]"}>
        <div>
          <h1>消息</h1>
          <span>{props.rooms.length} rooms</span>
        </div>
        <button className={"[display:inline-grid] [place-items:center] [border:0] [width:34px] [height:34px] [border-radius:12px] [color:var(--muted)] [background:#00000008] [transition:background-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012]"} title="New room" onClick={props.onCreateRoom}>
          <MessageSquarePlus size={18} />
        </button>
      </div>
      <div className={"[padding:0_8px_10px] [&_input]:[width:100%] [&_input]:[height:36px] [&_input]:[min-width:0] [&_input]:[border:0] [&_input]:[border-radius:14px] [&_input]:[padding:0_13px] [&_input]:[color:var(--text)] [&_input]:[background:#00000008] [&_input]:[outline:none] [&_input]:[font-size:13px] [&_input::placeholder]:[color:#17171755] [&_input:focus]:[box-shadow:inset_0_0_0_1px_var(--border-strong)]"}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search rooms"
          placeholder="Search rooms"
        />
      </div>
      <div className={"[height:calc(100vh_-_98px)] [overflow-y:auto] [padding:2px_8px_12px]"}>
        {visibleConversations.length === 0 ? (
          <div className={"[display:grid] [gap:10px] [margin:8px_4px] [border:1px_dashed_var(--border)] [border-radius:10px] [padding:24px_14px] [color:var(--muted)] [background:#ffffff99] [font-size:12px] [line-height:1.5] [text-align:center] [&_strong]:[color:var(--text)] [&_strong]:[font-size:13px] [&_button]:[justify-self:center] [&_button]:[height:32px] [&_button]:[border:0] [&_button]:[border-radius:6px] [&_button]:[padding:0_12px] [&_button]:[color:#ffffff] [&_button]:[background:var(--primary)] [&_button]:[font-size:12px] [&_button]:[font-weight:650]"}>
            <strong>{normalizedQuery ? "没有找到匹配的房间" : "还没有协作房间"}</strong>
            <span>{normalizedQuery ? "换个关键词试试，或新建一个房间。" : "创建第一个房间，开始组织 Agent 群聊。"}</span>
            <button type="button" onClick={props.onCreateRoom}>
              创建房间
            </button>
          </div>
        ) : null}
        {visibleConversations.map((conversation) => {
          const room = props.rooms.find((item) => item.id === conversation.roomId);
          if (!room) return null;
          const preview = buildRecentMessagePreview(conversation, room, props.messages);
          const unreadCount = props.unreadCounts[conversation.id] ?? 0;
          return (
            <div
              key={conversation.id}
              className={`[display:grid] [grid-template-columns:32px_minmax(0,_1fr)_28px] [align-items:center] [gap:8px] [width:100%] [min-width:0] [min-height:56px] [overflow:hidden] [border:0] [border-radius:14px] [padding:4px_8px] [text-align:left] [color:var(--text)] [background:transparent] [transition:background-color_0.12s_ease] [&:hover]:[background:var(--sidebar-hover)] [&:hover_[data-slot=conversation-delete]]:[opacity:1] [&:focus-within_[data-slot=conversation-delete]]:[opacity:1] ${conversation.id === props.currentConversationId ? "[background:var(--accent-soft)]" : ""}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ conversationId: conversation.id, x: event.clientX, y: event.clientY });
              }}
            >
              <span className={"[position:relative] [display:inline-flex]"}>
                <RoomAvatar key={`${room.id}:${room.avatar ?? "default"}`} title={conversation.title} avatar={room.avatar} size={32} />
                <UnreadBadge count={unreadCount} />
              </span>
              <button className={"[display:grid] [min-width:0] [border:0] [padding:4px_4px_4px_0] [text-align:left] [color:inherit] [background:transparent] [&:focus-visible]:[outline:none]"} onClick={() => props.onSelect(conversation.id)}>
                <span className={"[display:flex] [min-width:0] [align-items:center] [justify-content:space-between] [gap:8px]"}>
                  <span className={"[display:flex] [min-width:0] [align-items:center] [gap:4px]"}>
                    {conversation.pinned ? (
                      <Pin size={12} className={"[flex:0_0_auto] [color:var(--muted)]"} aria-hidden />
                    ) : null}
                    <span className={"[display:block] [overflow:hidden] [font-size:13px] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]"}>{conversation.title}</span>
                  </span>
                  <span className={"[flex:0_0_auto] [color:var(--muted)] [font-size:11px]"}>{formatShortDate(conversation.updatedAt)}</span>
                </span>
                <span className={"[display:flex] [min-width:0] [margin-top:4px] [align-items:center] [gap:2px] [color:var(--muted)] [font-size:12px] [line-height:1.35] [white-space:nowrap]"}>
                  {preview.sender ? (
                    <strong className={"[display:block] [flex:0_0_auto] [max-width:72px] [overflow:hidden] [color:inherit] [font:inherit] [font-weight:500] [text-overflow:ellipsis] [white-space:nowrap]"}>
                      {preview.sender}: 
                    </strong>
                  ) : null}
                  <span className={"[display:block] [min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{preview.content}</span>
                </span>
              </button>
              <button
                type="button"
                data-slot="conversation-delete"
                className={"[justify-self:end] [&:focus-visible]:[outline:none] [display:inline-grid] [width:28px] [height:28px] [place-items:center] [border:0] [border-radius:8px] [color:var(--danger)] [background:transparent] [opacity:0] [transition:opacity_0.12s_ease,_background-color_0.12s_ease] [&:hover]:[background:#dc26261a]"}
                title="Delete chat"
                onClick={() => props.onDeleteRoom(room, conversation)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
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
  const style = {
    top: Math.min(props.y, window.innerHeight - 56),
    left: Math.min(props.x, window.innerWidth - 168),
  };

  return (
    <div
      ref={props.menuRef}
      className={"[position:fixed] [z-index:90] [min-width:148px] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:12px] [padding:4px] [background:#ffffff] [box-shadow:0_12px_40px_rgb(0_0_0_/_14%)]"}
      style={style}
      role="menu"
    >
      <button
        type="button"
        className={"[display:flex] [width:100%] [align-items:center] [gap:8px] [border:0] [border-radius:8px] [padding:8px_10px] [color:var(--text)] [background:transparent] [font-size:13px] [text-align:left] [&:hover]:[background:#f3f4f6]"}
        role="menuitem"
        onClick={props.onTogglePin}
      >
        {props.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        {props.pinned ? "取消置顶" : "置顶"}
      </button>
    </div>
  );
}

function sortConversations(left: Conversation, right: Conversation) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function buildRecentMessagePreview(conversation: Conversation, room: Room, messages: Message[]) {
  const message = [...messages].reverse().find((item) => item.conversationId === conversation.id && shouldUseMessageForPreview(item));
  if (!message) {
    return {
      sender: "",
      content: conversation.lastMessage || room.description || "还没有消息",
    };
  }
  if (message.status === "deleted") {
    return {
      sender: messageSenderLabel(message),
      content: "消息已删除",
    };
  }
  if (message.status === "recalled") {
    return {
      sender: messageSenderLabel(message),
      content: "消息已撤回",
    };
  }
  return {
    sender: messageSenderLabel(message),
    content: message.content.trim() || conversation.lastMessage || "附件",
  };
}

function shouldUseMessageForPreview(message: Message) {
  return !(message.role === "assistant" && message.status === "cancelled" && !message.content.trim());
}

function messageSenderLabel(message: Message) {
  if (message.role === "user") return "";
  return message.senderName || message.role;
}
