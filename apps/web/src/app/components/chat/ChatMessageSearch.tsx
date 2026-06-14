import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Message } from "@group-chat/shared";
import { formatShortDate } from "../../formatting.js";

export function ChatMessageSearch(props: {
  open: boolean;
  messages: Message[];
  onClose: () => void;
  onFocusMessage: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    if (!props.open) {
      setQuery("");
      return;
    }
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [props.onClose, props.open]);

  const results = useMemo(() => {
    if (!normalizedQuery) return [];
    return props.messages
      .filter((message) => message.status !== "deleted" && message.status !== "recalled")
      .filter((message) => {
        const sender = message.role === "user" ? "我" : message.senderName || message.role;
        return [message.content, sender].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .slice()
      .reverse()
      .slice(0, 50);
  }, [normalizedQuery, props.messages]);

  if (!props.open) return null;

  return (
    <div
      ref={panelRef}
      className={"[position:absolute] [top:62px] [left:16px] [right:16px] [z-index:19] [display:grid] [gap:10px] [border:1px_solid_var(--border)] [border-radius:18px] [padding:12px] [background:var(--panel)] [box-shadow:0_18px_54px_rgb(0_0_0_/_12%)] max-[760px]:[left:12px] max-[760px]:[right:12px]"}
    >
      <div className={"[display:flex] [align-items:center] [gap:8px] [height:38px] [border:1px_solid_var(--border)] [border-radius:12px] [padding:0_10px] [background:#f7f7f8] [&_input]:[flex:1_1_auto] [&_input]:[min-width:0] [&_input]:[border:0] [&_input]:[padding:0] [&_input]:[color:var(--text)] [&_input]:[background:transparent] [&_input]:[outline:none] [&_input]:[font-size:13px] [&_input::placeholder]:[color:#17171755]"}>
        <Search size={16} className={"[color:var(--muted)] [flex:0_0_auto]"} />
        <input
          ref={inputRef}
          value={query}
          aria-label="搜索聊天记录"
          placeholder="搜索聊天记录"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className={"[display:inline-grid] [width:24px] [height:24px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000008]"}
            aria-label="清空搜索"
            onClick={() => setQuery("")}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      <div className={"[max-height:min(360px,_calc(100vh_-_180px))] [overflow-y:auto] [display:grid] [gap:4px]"}>
        {!normalizedQuery ? (
          <div className={"[padding:18px_8px] [color:var(--muted)] [font-size:12px] [text-align:center]"}>输入关键词搜索当前会话消息</div>
        ) : results.length === 0 ? (
          <div className={"[padding:18px_8px] [color:var(--muted)] [font-size:12px] [text-align:center]"}>没有找到匹配的消息</div>
        ) : (
          results.map((message) => (
            <button
              key={message.id}
              type="button"
              className={"[display:grid] [gap:4px] [width:100%] [border:0] [border-radius:12px] [padding:10px_12px] [text-align:left] [color:var(--text)] [background:transparent] [transition:background-color_0.12s_ease] [&:hover]:[background:#00000008] [&:focus-visible]:[outline:none] [&:focus-visible]:[background:#0000000d]"}
              onClick={() => {
                props.onFocusMessage(message.id);
                props.onClose();
              }}
            >
              <span className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
                <strong className={"[overflow:hidden] [font-size:12px] [font-weight:700] [text-overflow:ellipsis] [white-space:nowrap]"}>
                  {message.role === "user" ? "我" : message.senderName || message.role}
                </strong>
                <span className={"[flex:0_0_auto] [color:var(--muted)] [font-size:11px]"}>{formatShortDate(message.createdAt)}</span>
              </span>
              <span className={"[overflow:hidden] [color:var(--muted)] [font-size:12px] [line-height:1.45] [text-overflow:ellipsis] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"}>
                {highlightQuery(message.content.trim() || "[附件]", normalizedQuery)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function highlightQuery(content: string, query: string) {
  const index = content.toLowerCase().indexOf(query);
  if (index < 0) return content;
  const before = content.slice(0, index);
  const match = content.slice(index, index + query.length);
  const after = content.slice(index + query.length);
  return (
    <>
      {before}
      <mark className={"[color:inherit] [background:#fef08a99] [padding:0_1px] [border-radius:3px]"}>{match}</mark>
      {after}
    </>
  );
}
