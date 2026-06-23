import { useEffect, useMemo, useRef } from "react";
import { BrainCircuit, Braces, ChevronDown, FileText, LoaderCircle, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentRunEvent } from "@group-chat/shared";
import type { ProcessSection } from "../../agent-thinking.js";
import { formatRunEventStatus, formatRunEventTypeLabel, useTranslation } from "../../i18n/index.js";

type DisplayProcessSection =
  | ProcessSection
  | { kind: "tool_summary"; id: string; count: number; status: AgentRunEvent["status"]; events: AgentRunEvent[] };

export function AgentThinkingPanel(props: {
  open: boolean;
  participantName: string;
  sections: ProcessSection[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const displaySections = useMemo(
    () => compactToolExecutionSections(props.sections),
    [props.sections],
  );
  const streaming = displaySections.some(
    (section) =>
      (section.kind === "reasoning" || section.kind === "thinking") && section.streaming
      || section.kind === "tool_summary" && section.status === "streaming",
  );

  useEffect(() => {
    if (!props.open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-slot="message-more-menu"]')) return;
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

  useEffect(() => {
    if (!props.open) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [props.open, props.sections]);

  if (!props.open) return null;

  return (
    <aside
      ref={panelRef}
      className={"[position:absolute] [top:56px] [right:0] [bottom:0] [z-index:37] [display:grid] [width:min(400px,_calc(100vw_-_24px))] [grid-template-rows:auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:var(--panel)] [box-shadow:-18px_0_40px_rgb(0_0_0_/_8%)]"}
      aria-label={t("thinkingPanel.aria")}
    >
      <header className={"[display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [align-items:center] [gap:8px] [border-bottom:1px_solid_var(--border)] [padding:14px] [background:#ffffff]"}>
        <span className={"[display:grid] [gap:3px] [min-width:0]"}>
          <strong className={"[display:flex] [align-items:center] [gap:6px] [min-width:0] [color:var(--text)] [font-size:15px] [font-weight:750]"}>
            {streaming ? (
              <LoaderCircle size={16} className={"[flex:0_0_auto] animate-spin"} />
            ) : (
              <BrainCircuit size={16} className={"[flex:0_0_auto] [color:#7c3aed]"} />
            )}
            <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{props.participantName}</span>
          </strong>
          <small className={"[color:var(--muted)] [font-size:12px]"}>
            {streaming ? t("thinkingPanel.thinking") : t("thinkingPanel.process")}
          </small>
        </span>
        <button
          type="button"
          className={"[display:grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
          aria-label={t("thinkingPanel.close")}
          onClick={props.onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div
        ref={scrollRef}
        className={"[min-height:0] [overflow-y:auto] [padding:14px] [display:grid] [align-content:start] [gap:10px]"}
      >
        {displaySections.length === 0 ? (
          <div className={"[display:grid] [place-items:center] [gap:10px] [padding:40px_12px] [color:var(--muted)] [font-size:13px] [text-align:center]"}>
            <BrainCircuit size={22} />
            <p className={"[margin:0]"}>{t("thinkingPanel.emptyTitle")}</p>
            <p className={"[margin:0] [font-size:12px]"}>{t("thinkingPanel.emptyHint")}</p>
          </div>
        ) : null}
        {displaySections.map((section) => {
          if (section.kind === "tool_summary") {
            return <ToolSummarySection key={section.id} count={section.count} status={section.status} events={section.events} />;
          }
          if (section.kind === "event") {
            return <RunEventSection key={section.id} event={section.event} />;
          }
          return (
            <section
              key={section.id}
              className={`[display:grid] [gap:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px_12px] [background:#f8fafc] [font-size:12px] ${section.streaming ? "[border-color:var(--accent-hover)]" : ""}`}
            >
              <div className={"[display:flex] [align-items:center] [gap:6px] [color:var(--muted)] [font-size:12px] [font-weight:700]"}>
                <BrainCircuit size={15} />
                <span>
                  {section.streaming
                    ? t("thinkingPanel.thinkingInProgress")
                    : section.kind === "thinking" || section.kind === "reasoning"
                      ? t("thinkingPanel.thinkingProcess")
                      : t("thinkingPanel.reasoningBlock")}
                </span>
              </div>
              <div className={"message-prose [overflow:auto] [color:#404040] [font-size:12px] [line-height:1.6]"}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content || " "}</ReactMarkdown>
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function compactToolExecutionSections(sections: ProcessSection[]): DisplayProcessSection[] {
  const compacted: DisplayProcessSection[] = [];
  const pendingTools = new Map<string, AgentRunEvent["status"]>();
  const pendingEvents: AgentRunEvent[] = [];
  let pendingId = "";

  const flushTools = () => {
    if (pendingTools.size === 0) return;
    const statuses = [...pendingTools.values()];
    const status: AgentRunEvent["status"] = statuses.includes("error")
      ? "error"
      : statuses.includes("streaming") || statuses.includes("pending")
        ? "streaming"
        : "success";
    compacted.push({
      kind: "tool_summary",
      id: pendingId || `tool-summary-${compacted.length}`,
      count: pendingTools.size,
      status,
      events: [...pendingEvents],
    });
    pendingTools.clear();
    pendingEvents.length = 0;
    pendingId = "";
  };

  for (const section of sections) {
    if (section.kind !== "event" || !isToolExecutionEvent(section.event)) {
      flushTools();
      compacted.push(section);
      continue;
    }

    pendingId ||= `tool-summary-${section.id}`;
    const key = toolExecutionKey(section.event);
    pendingEvents.push(section.event);
    const currentStatus = pendingTools.get(key);
    if (section.event.type === "tool_result" || section.event.type === "file_write") {
      pendingTools.set(key, section.event.status === "error" ? "error" : "success");
    } else if (!currentStatus || currentStatus === "pending" || currentStatus === "streaming") {
      pendingTools.set(key, section.event.status);
    }
  }

  flushTools();
  return compacted;
}

function isToolExecutionEvent(event: AgentRunEvent) {
  return event.type === "tool_call" || event.type === "tool_result" || event.type === "file_write";
}

function toolExecutionKey(event: AgentRunEvent) {
  if (typeof event.metadata?.toolCallId === "string") return event.metadata.toolCallId;
  return event.id;
}

function ToolSummarySection(props: { count: number; status: AgentRunEvent["status"]; events: AgentRunEvent[] }) {
  const { t } = useTranslation();
  return (
    <details className={`group [display:grid] [min-width:0] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:14px] [background:#ffffff] [color:var(--muted)] [font-size:12px] ${props.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${props.status === "error" ? "[border-color:#dc26262e] [background:#fef2f2]" : ""}`}>
      <summary className={"[display:flex] [min-width:0] [align-items:center] [gap:8px] [padding:10px_12px] [font-weight:700] [cursor:pointer] [list-style:none] [&::-webkit-details-marker]:[display:none]"}>
        <Wrench size={15} className={"[flex:0_0_auto]"} />
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{t("thinkingPanel.toolCallsSummary", { count: props.count })}</span>
        <span className={"[flex:0_0_auto] [margin-left:auto] [font-weight:600]"}>{formatToolSummaryStatus(props.status)}</span>
        <ChevronDown size={14} className={"[flex:0_0_auto] [transition:transform_0.12s_ease] group-open:[rotate:180deg]"} />
      </summary>
      <div className={"[display:grid] [gap:8px] [border-top:1px_solid_var(--border)] [padding:8px]"}>
        {props.events.map((event) => (
          <RunEventSection key={event.id} event={event} compact />
        ))}
      </div>
    </details>
  );
}

function formatToolSummaryStatus(status: AgentRunEvent["status"]) {
  if (status === "streaming") return formatRunEventStatus({ status, type: "tool_call" } as AgentRunEvent);
  if (status === "error") return formatRunEventStatus({ status, type: "tool_result" } as AgentRunEvent);
  return formatRunEventStatus({ status: "success", type: "tool_result" } as AgentRunEvent);
}

function RunEventSection(props: { event: AgentRunEvent; compact?: boolean }) {
  const toolName = typeof props.event.metadata?.toolName === "string" ? props.event.metadata.toolName : null;
  const icon =
    props.event.type === "tool_call" ? (
      <Wrench size={15} />
    ) : props.event.type === "tool_result" ? (
      <Braces size={15} />
    ) : (
      <FileText size={15} />
    );
  const label = formatRunEventTypeLabel(props.event, toolName);

  return (
    <section
      className={`[display:grid] [min-width:0] [overflow:hidden] [gap:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px_12px] [background:#ffffff] [font-size:12px] ${props.event.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${props.event.status === "error" ? "[border-color:#dc26262e] [background:#fef2f2]" : ""}`}
    >
      <div className={"[display:flex] [min-width:0] [align-items:center] [gap:6px] [overflow:hidden] [color:var(--muted)] [font-size:12px] [font-weight:700]"}>
        {icon}
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{label}</span>
        <span className={"[flex:0_0_auto] [margin-left:auto] [font-weight:600]"}>{formatRunEventStatus(props.event)}</span>
      </div>
      {props.event.content ? (
        <pre className={`${props.compact ? "[max-height:160px] [font-size:11px]" : "[max-height:220px] [font-size:12px]"} [margin:0] [overflow:auto] [border-radius:10px] [padding:10px] [white-space:pre-wrap] [color:#404040] [background:#f8fafc] [line-height:1.5]`}>
          {props.event.content}
        </pre>
      ) : null}
    </section>
  );
}
