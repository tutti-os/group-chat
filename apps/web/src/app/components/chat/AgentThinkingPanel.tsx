import { useEffect, useRef } from "react";
import { BrainCircuit, Braces, FileText, LoaderCircle, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentRunEvent } from "@group-chat/shared";
import type { ProcessSection } from "../../agent-thinking.js";
import { formatRunEventStatus, formatRunEventTypeLabel, useTranslation } from "../../i18n/index.js";

export function AgentThinkingPanel(props: {
  open: boolean;
  participantName: string;
  sections: ProcessSection[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streaming = props.sections.some(
    (section) => (section.kind === "reasoning" || section.kind === "thinking") && section.streaming,
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
        {props.sections.length === 0 ? (
          <div className={"[display:grid] [place-items:center] [gap:10px] [padding:40px_12px] [color:var(--muted)] [font-size:13px] [text-align:center]"}>
            <BrainCircuit size={22} />
            <p className={"[margin:0]"}>{t("thinkingPanel.emptyTitle")}</p>
            <p className={"[margin:0] [font-size:12px]"}>{t("thinkingPanel.emptyHint")}</p>
          </div>
        ) : null}
        {props.sections.map((section) => {
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

function RunEventSection(props: { event: AgentRunEvent }) {
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
      className={`[display:grid] [gap:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px_12px] [background:#ffffff] [font-size:12px] ${props.event.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${props.event.status === "error" ? "[border-color:#dc26262e] [background:#fef2f2]" : ""}`}
    >
      <div className={"[display:flex] [align-items:center] [gap:6px] [color:var(--muted)] [font-size:12px] [font-weight:700]"}>
        {icon}
        <span>{label}</span>
        <span className={"[margin-left:auto] [font-weight:600]"}>{formatRunEventStatus(props.event)}</span>
      </div>
      {props.event.content ? (
        <pre className={"[margin:0] [max-height:220px] [overflow:auto] [border-radius:10px] [padding:10px] [white-space:pre-wrap] [color:#404040] [background:#f8fafc] [font-size:12px] [line-height:1.5]"}>
          {props.event.content}
        </pre>
      ) : null}
    </section>
  );
}
