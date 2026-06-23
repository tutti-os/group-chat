import { useEffect, useMemo, useRef } from "react";
import {
  AlertCircle,
  Bot,
  BrainCircuit,
  Braces,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentRun, AgentRunEvent, Participant } from "@group-chat/shared";
import { formatRunEventStatus, useTranslation } from "../../i18n/index.js";

type DisplayItem =
  | { kind: "thinking"; content: string; streaming: boolean }
  | { kind: "event"; event: AgentRunEvent };

export function AgentRunPanel(props: {
  open: boolean;
  run: AgentRun | null;
  participant: Participant | null;
  events: AgentRunEvent[];
  running: boolean;
  onClose: () => void;
  onFocusMessage?: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!props.open) return;
    stickToBottomRef.current = true;
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

  const displayItems = useMemo(() => groupRunEvents(props.events), [props.events]);

  useEffect(() => {
    if (!props.open || !stickToBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [displayItems, props.open]);

  if (!props.open || !props.run) return null;

  const participantName = props.participant?.displayName ?? t("common.agent");

  return (
    <aside
      ref={panelRef}
      className={"[position:absolute] [top:56px] [right:0] [bottom:0] [z-index:37] [display:grid] [width:min(400px,_calc(100vw_-_24px))] [grid-template-rows:auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:var(--panel)] [box-shadow:-18px_0_40px_rgb(0_0_0_/_8%)]"}
      aria-label={t("runPanel.aria")}
    >
      <header className={"[display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [align-items:center] [gap:8px] [border-bottom:1px_solid_var(--border)] [padding:14px] [background:#ffffff]"}>
        <span className={"[display:grid] [gap:3px] [min-width:0]"}>
          <strong className={"[display:flex] [align-items:center] [gap:6px] [min-width:0] [color:var(--text)] [font-size:15px] [font-weight:750]"}>
            {props.running ? (
              <LoaderCircle size={16} className={"[flex:0_0_auto] animate-spin"} />
            ) : (
              <CheckCircle2 size={16} className={"[flex:0_0_auto] [color:#16a34a]"} />
            )}
            <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{participantName}</span>
          </strong>
          <small className={"[color:var(--muted)] [font-size:12px]"}>
            {props.running ? t("runPanel.running") : t("runPanel.completed")}
          </small>
        </span>
        <button
          type="button"
          className={"[display:grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
          aria-label={t("runPanel.close")}
          onClick={props.onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div
        ref={scrollRef}
        className={"[min-height:0] [overflow-y:auto] [padding:14px] [display:grid] [align-content:start] [gap:10px]"}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        {props.run.assistantMessageId ? (
          <button
            type="button"
            className={"[justify-self:start] [height:30px] [border:0] [border-radius:8px] [padding:0_12px] [color:#ffffff] [background:#111827] [font-size:12px] [font-weight:700] [&:hover]:[background:#1f2937]"}
            onClick={() => props.onFocusMessage?.(props.run!.assistantMessageId!)}
          >
            {t("runPanel.jumpToReply")}
          </button>
        ) : null}

        {displayItems.length === 0 ? (
          <div className={"[display:grid] [place-items:center] [gap:10px] [padding:40px_12px] [color:var(--muted)] [font-size:13px] [text-align:center]"}>
            {props.running ? (
              <>
                <LoaderCircle size={22} className={"animate-spin"} />
                <p className={"[margin:0]"}>{t("runPanel.waiting")}</p>
              </>
            ) : (
              <>
                <Bot size={22} />
                <p className={"[margin:0]"}>{t("runPanel.noEvents")}</p>
              </>
            )}
          </div>
        ) : null}

        {displayItems.map((item, index) => {
          if (item.kind === "thinking") {
            return (
              <section
                key={`thinking-${index}`}
                className={`[display:grid] [gap:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px_12px] [background:#f8fafc] [font-size:12px] ${item.streaming ? "[border-color:var(--accent-hover)]" : ""}`}
              >
                <div className={"[display:flex] [align-items:center] [gap:6px] [color:var(--muted)] [font-size:12px] [font-weight:700]"}>
                  <BrainCircuit size={15} />
                  <span>{item.streaming ? t("thinkingPanel.thinkingInProgress") : t("thinkingPanel.thinkingProcess")}</span>
                </div>
                <div className={"message-prose [max-height:280px] [overflow:auto] [color:#404040] [font-size:12px] [line-height:1.6]"}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content || " "}</ReactMarkdown>
                </div>
              </section>
            );
          }

          const event = item.event;
          if (event.type === "tool_call" || event.type === "tool_result") {
            const toolName = typeof event.metadata?.toolName === "string" ? event.metadata.toolName : "tool";
            const isResult = event.type === "tool_result";
            return (
              <section
                key={event.id}
                className={`[display:grid] [min-width:0] [overflow:hidden] [gap:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px_12px] [background:#ffffff] [font-size:12px] ${event.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${event.status === "error" ? "[border-color:#dc26262e] [background:#fef2f2]" : ""}`}
              >
                <div className={"[display:flex] [min-width:0] [align-items:center] [gap:6px] [overflow:hidden] [font-weight:700] [color:var(--text)]"}>
                  {isResult ? <Braces size={15} /> : <Wrench size={15} />}
                  <strong className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{toolName}</strong>
                  <span className={"[flex:0_0_auto] [color:var(--muted)] [font-size:11px] [font-weight:650]"}>{formatRunEventStatus(event)}</span>
                </div>
                {event.content ? <pre className={"[margin:0] [max-height:220px] [overflow:auto] [border-radius:10px] [padding:10px] [white-space:pre-wrap] [color:#404040] [background:#f8fafc] [font-size:11px] [line-height:1.5]"}>{event.content}</pre> : null}
              </section>
            );
          }

          if (event.type === "file_write") {
            const path = typeof event.metadata?.path === "string" ? event.metadata.path : event.content;
            return (
              <section key={event.id} className={"[display:grid] [min-width:0] [overflow:hidden] [gap:6px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px_12px] [background:#ffffff] [font-size:12px]"}>
                <div className={"[display:flex] [min-width:0] [align-items:center] [gap:6px] [overflow:hidden] [font-weight:700] [color:var(--text)]"}>
                  <FileText size={15} />
                  <strong className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{t("runPanel.writeFile")}</strong>
                </div>
                <pre className={"[margin:0] [overflow:auto] [white-space:pre-wrap] [color:#404040] [font-size:11px] [line-height:1.5]"}>{path}</pre>
              </section>
            );
          }

          if (event.type === "status") {
            return (
              <p key={event.id} className={"[margin:0] [color:var(--muted)] [font-size:12px] [line-height:1.5]"}>
                {event.content || t("runPanel.statusUpdate")}
              </p>
            );
          }

          return (
            <section
              key={event.id}
              className={"[display:grid] [gap:6px] [border:1px_solid_#dc26262e] [border-radius:14px] [padding:10px_12px] [color:var(--danger)] [background:#fef2f2] [font-size:12px]"}
            >
              <div className={"[display:flex] [align-items:center] [gap:6px] [font-weight:700]"}>
                <AlertCircle size={15} />
                <strong>{event.type === "stderr" ? t("runPanel.runtimeOutput") : t("runPanel.execError")}</strong>
              </div>
              {event.content ? <pre className={"[margin:0] [overflow:auto] [white-space:pre-wrap] [font-size:11px] [line-height:1.5]"}>{event.content}</pre> : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function groupRunEvents(events: AgentRunEvent[]): DisplayItem[] {
  const sorted = [...events].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.createdAt.localeCompare(right.createdAt);
  });
  const items: DisplayItem[] = [];
  let thinkingBuffer = "";
  let thinkingStreaming = false;

  const flushThinking = () => {
    if (!thinkingBuffer && !thinkingStreaming) return;
    items.push({ kind: "thinking", content: thinkingBuffer, streaming: thinkingStreaming });
    thinkingBuffer = "";
    thinkingStreaming = false;
  };

  for (const event of sorted) {
    if (event.type === "thinking_delta") {
      thinkingBuffer += event.content;
      thinkingStreaming = event.status === "streaming" || thinkingStreaming;
      continue;
    }
    flushThinking();
    items.push({ kind: "event", event });
  }
  flushThinking();
  return items;
}
