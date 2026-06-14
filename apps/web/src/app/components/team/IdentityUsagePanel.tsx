import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { IdentityUsageRoom } from "../../identity-usage.js";
import { resolveAgentAvatar } from "../../identity-avatar.js";
import { RoomAvatar } from "../ui/RoomAvatar.js";

export function IdentityUsagePanel(props: {
  usage: IdentityUsageRoom[];
  identityIcon: string;
  identityProvider?: string | null;
  onOpenConversation?: (conversationId: string) => void;
}) {
  const roomCount = props.usage.length;
  const cloneCount = props.usage.reduce((total, room) => total + room.clones.length, 0);
  const hasUsage = roomCount > 0;

  return (
    <div className={"[display:grid] [gap:10px]"}>
      {hasUsage ? (
        <>
          <p className={"[margin:0] [color:var(--muted)] [font-size:12px] [line-height:1.55]"}>
            已加入 {roomCount} 个房间 · {cloneCount} 个分身员工。删除 Agent 会从房间移除，历史消息保留。
          </p>
          <div className={"[display:grid] [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:8px] max-[760px]:[grid-template-columns:1fr]"}>
            {props.usage.map((room) => (
              <UsageRoomSection
                key={room.conversationId}
                room={room}
                identityIcon={props.identityIcon}
                identityProvider={props.identityProvider ?? null}
                onOpenConversation={props.onOpenConversation}
              />
            ))}
          </div>
        </>
      ) : (
        <div className={"[border:1px_solid_var(--border)] [border-radius:14px] [padding:12px] [color:var(--muted)] [background:#f7f7f8] [font-size:12px] [line-height:1.55]"}>
          尚未加入任何房间。可在群聊中点击「添加 Agent」将此身份加入房间。
        </div>
      )}
    </div>
  );
}

function UsageRoomSection(props: {
  room: IdentityUsageRoom;
  identityIcon: string;
  identityProvider: string | null;
  onOpenConversation?: (conversationId: string) => void;
}) {
  const { room } = props;
  const [expanded, setExpanded] = useState(false);
  const openRoomTip = `前往「${room.title}」`;

  return (
    <section className={"[overflow:hidden] [border:1px_solid_var(--border)] [border-radius:14px] [background:#ffffff]"}>
      <div className={"[display:grid] [gap:8px] [padding:10px_12px]"}>
        <div className={"[display:flex] [min-width:0] [align-items:center]"}>
          {props.onOpenConversation ? (
            <button
              type="button"
              className={"[display:inline-flex] [max-width:100%] [min-width:0] [align-items:center] [gap:10px] [border:0] [padding:0] [color:var(--text)] [background:transparent] [text-align:left] [cursor:pointer] [&:hover]:[color:#2563eb] [&:hover_span]:[text-decoration:underline] [&:focus-visible]:[outline:none] [&:focus-visible]:[box-shadow:0_0_0_3px_#2563eb22] [&:focus-visible]:[border-radius:8px]"}
              title={openRoomTip}
              aria-label={openRoomTip}
              onClick={() => props.onOpenConversation?.(room.conversationId)}
            >
              <RoomAvatar title={room.title} avatar={room.roomAvatar} size={34} />
              <span className={"[min-width:0] [overflow:hidden] [font-size:14px] [font-weight:650] [text-overflow:ellipsis] [white-space:nowrap]"}>
                {room.title}
              </span>
            </button>
          ) : (
            <div className={"[display:inline-flex] [max-width:100%] [min-width:0] [align-items:center] [gap:10px]"}>
              <RoomAvatar title={room.title} avatar={room.roomAvatar} size={34} />
              <span className={"[min-width:0] [overflow:hidden] [font-size:14px] [font-weight:650] [text-overflow:ellipsis] [white-space:nowrap]"}>
                {room.title}
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          className={"[display:inline-flex] [width:100%] [align-items:center] [justify-content:space-between] [gap:4px] [border:0] [border-top:1px_solid_var(--border)] [padding:8px_0_0] [color:var(--muted)] [background:transparent] [font-size:11px] [font-weight:650] [white-space:nowrap] [cursor:pointer] [&:hover]:[color:var(--text)] [&:focus-visible]:[outline:none]"}
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"} ${room.title} 的分身员工列表`}
          onClick={() => setExpanded((current) => !current)}
        >
          {room.clones.length} 个分身员工
          <ChevronRight
            size={16}
            className={`[flex-shrink:0] [transition:transform_0.15s_ease] ${expanded ? "[transform:rotate(90deg)]" : ""}`}
          />
        </button>
      </div>
      {expanded ? (
      <ul className={"[display:grid] [gap:2px] [margin:0] [padding:4px_12px_10px] [border-top:1px_solid_var(--border)] [list-style:none]"}>
        {room.clones.map((clone) => {
          const cloneAvatar = resolveAgentAvatar({
            avatar: clone.avatar ?? props.identityIcon,
            icon: props.identityIcon,
            runtimeProfile: props.identityProvider ? { provider: props.identityProvider, kind: "local-agent" } : null,
          });
          return (
          <li
            key={clone.participantId}
            className={"[display:flex] [align-items:center] [gap:8px] [border-radius:8px] [padding:4px_4px_4px_2px]"}
          >
            <RoomAvatar
              title={clone.displayName}
              avatar={cloneAvatar.avatar}
              provider={cloneAvatar.provider}
              size={32}
            />
            <div className={"[min-width:0] [flex:1] [display:grid] [gap:1px]"}>
              <span className={"[overflow:hidden] [font-size:12px] [font-weight:600] [line-height:1.3] [color:#525252] [text-overflow:ellipsis] [white-space:nowrap]"}>
                {clone.displayName}
              </span>
              <span className={"[display:flex] [flex-wrap:wrap] [gap:3px] [align-items:center]"}>
                {clone.isAlias ? <UsageTag compact muted>别名</UsageTag> : null}
                {clone.hasRoomOverride ? <UsageTag compact muted>群配置</UsageTag> : null}
                {clone.status === "muted" ? <UsageTag compact warn>已静音</UsageTag> : null}
              </span>
            </div>
          </li>
          );
        })}
      </ul>
      ) : null}
    </section>
  );
}

function UsageTag(props: { children: string; muted?: boolean; warn?: boolean; compact?: boolean }) {
  return (
    <span
      className={`[display:inline-flex] [align-items:center] [border-radius:999px] [font-weight:650] [line-height:1] ${
        props.compact ? "[height:16px] [padding:0_6px] [font-size:9px]" : "[height:18px] [padding:0_7px] [font-size:10px]"
      } ${
        props.warn
          ? "[color:#b45309] [background:#fef3c7]"
          : props.muted
            ? "[color:var(--muted)] [background:#00000008]"
            : "[color:#2563eb] [background:#eff6ff]"
      }`}
    >
      {props.children}
    </span>
  );
}
