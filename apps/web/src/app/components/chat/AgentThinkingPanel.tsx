import { useEffect, useMemo, useRef } from "react";
import { BrainCircuit, Braces, ChevronDown, FileText, LoaderCircle, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentRunEvent } from "@group-chat/shared";
import { compactToolExecutionSections, type ProcessSection, type ToolSummaryStats } from "../../agent-thinking.js";
import { formatRunEventStatus, formatRunEventTypeLabel, useTranslation } from "../../i18n/index.js";
import type { TranslateParams } from "../../i18n/translate.js";

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
      className={"[position:absolute] [top:56px] [right:0] [bottom:0] [z-index:37] [display:grid] [width:min(630px,_calc(100vw_-_24px))] [grid-template-rows:auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:#ffffff] [box-shadow:-18px_0_40px_rgb(0_0_0_/_8%)]"}
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
        className={"[min-height:0] [overflow-y:auto] [padding:14px] [display:grid] [align-content:start] [gap:10px] [background:#ffffff]"}
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
            return <ToolSummarySection key={section.id} count={section.count} status={section.status} stats={section.stats} events={section.events} />;
          }
          if (section.kind === "event") {
            return <RunEventSection key={section.id} event={section.event} />;
          }
          const hasContent = section.content.trim().length > 0;
          return (
            <section
              key={section.id}
              className={`[display:grid] [min-width:0] [overflow:hidden] [gap:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px_12px] [background:#f8fafc] [font-size:12px] ${section.streaming ? "[border-color:var(--accent-hover)]" : ""}`}
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
              {hasContent ? (
                <div
                  className={"message-prose [overflow:auto] [color:#404040] [font-size:12px] [line-height:1.7] [scrollbar-gutter:stable] [&_p]:[margin:0_0_10px] [&_p:last-child]:[margin-bottom:0]"}
                  style={{ maxHeight: "min(420px, 42vh)" }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{formatThinkingMarkdown(section.content)}</ReactMarkdown>
                </div>
              ) : (
                <div className={"[display:flex] [align-items:center] [gap:8px] [border-radius:10px] [padding:10px] [color:var(--muted)] [background:#ffffff] [font-size:12px] [line-height:18px]"}>
                  <LoaderCircle size={14} className={section.streaming ? "animate-spin" : ""} />
                  <span>{section.streaming ? t("thinkingPanel.thinkingInProgress") : t("thinkingPanel.emptyTitle")}</span>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function ToolSummarySection(props: { count: number; status: AgentRunEvent["status"]; stats: ToolSummaryStats; events: Array<{ event: AgentRunEvent; displayStatus: AgentRunEvent["status"] }> }) {
  const { t } = useTranslation();
  return (
    <details open className={`group [display:grid] [min-width:0] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:14px] [background:#ffffff] [color:var(--muted)] [font-size:12px] ${props.status === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${props.status === "error" ? "[border-color:#dc26262e] [background:#fef2f2]" : ""}`}>
      <summary className={"[display:flex] [min-width:0] [align-items:center] [gap:8px] [padding:10px_12px] [font-weight:700] [cursor:pointer] [list-style:none] [&::-webkit-details-marker]:[display:none]"}>
        <Wrench size={15} className={"[flex:0_0_auto]"} />
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{t("thinkingPanel.toolCallsSummary", { count: props.count })}</span>
        <span className={"[flex:0_0_auto] [margin-left:auto] [font-weight:600]"}>{formatToolSummaryStatus(props.status, props.stats, t)}</span>
        <ChevronDown size={14} className={"[flex:0_0_auto] [transition:transform_0.12s_ease] group-open:[rotate:180deg]"} />
      </summary>
      <div
        className={"[display:grid] [gap:8px] [overflow-y:auto] [overscroll-contain] [border-top:1px_solid_var(--border)] [padding:8px] [scrollbar-gutter:stable]"}
        style={{ maxHeight: "min(560px, calc(100vh - 260px))" }}
        onWheel={(event) => {
          const element = event.currentTarget;
          if (element.scrollHeight <= element.clientHeight) return;
          event.stopPropagation();
        }}
      >
        {props.events.map(({ event, displayStatus }) => (
          <RunEventSection key={event.id} event={event} compact displayStatus={displayStatus} />
        ))}
      </div>
    </details>
  );
}

function formatToolSummaryStatus(status: AgentRunEvent["status"], stats: ToolSummaryStats, t: (key: string, values?: TranslateParams) => string) {
  if (stats.failedCount > 0) {
    return t("thinkingPanel.toolCallsMixedStatus", { success: stats.successCount, failed: stats.failedCount });
  }
  if (status === "streaming") return formatRunEventStatus({ status, type: "tool_call" } as AgentRunEvent);
  if (status === "error") return formatRunEventStatus({ status, type: "tool_result" } as AgentRunEvent);
  return formatRunEventStatus({ status: "success", type: "tool_result" } as AgentRunEvent);
}

const THINKING_PARAGRAPH_MAX_CHARS = 92;

export function formatThinkingMarkdown(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return " ";
  return splitMarkdownFences(trimmed)
    .map((part) => part.fenced ? formatFencedThinkingBlock(part.text) : formatThinkingTextPart(part.text))
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

function formatFencedThinkingBlock(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^(```|~~~)[^\n]*\n([\s\S]*?)\n\1$/);
  if (!match) return trimmed;
  return match[2]?.trim() ? trimmed : "";
}

function splitMarkdownFences(content: string) {
  const parts: Array<{ fenced: boolean; text: string }> = [];
  const fencePattern = /(^|\n)(```[\s\S]*?```|~~~[\s\S]*?~~~)(?=\n|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content))) {
    const fenceStart = match.index + (match[1] ?? "").length;
    if (fenceStart > cursor) parts.push({ fenced: false, text: content.slice(cursor, fenceStart) });
    parts.push({ fenced: true, text: match[2] ?? "" });
    cursor = fencePattern.lastIndex;
  }
  if (cursor < content.length) parts.push({ fenced: false, text: content.slice(cursor) });
  return parts;
}

function formatThinkingTextPart(text: string) {
  return text
    .split(/\n{2,}/)
    .map(formatThinkingBlock)
    .filter(Boolean)
    .join("\n\n");
}

function formatThinkingBlock(block: string) {
  const chunks: string[] = [];
  let buffer: string[] = [];
  const flushBuffer = () => {
    const paragraphText = buffer.join(" ").replace(/[ \t]+/g, " ").trim();
    if (paragraphText) chunks.push(...buildThinkingParagraphs(paragraphText));
    buffer = [];
  };

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushBuffer();
      continue;
    }
    if (isMarkdownStructureLine(trimmed)) {
      flushBuffer();
      chunks.push(line.trimEnd());
      continue;
    }
    buffer.push(trimmed);
  }
  flushBuffer();

  return chunks.join("\n\n");
}

function isMarkdownStructureLine(line: string) {
  return /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|`{3,}|~~~|\|)/.test(line);
}

function buildThinkingParagraphs(text: string) {
  return text
    .replace(/([。！？!?；;])\s*/g, "$1\n")
    .replace(/([：:])\s+/g, "$1\n")
    .replace(/([，,])\s*(?=(?:然后|现在|接下来|目标|验证|工作区|当前|这里|看起来|因此|另外|同时|不过|但是|我会|我先))/g, "$1\n")
    .replace(/\s+(?=(?:目标|验证|当前|现在|接下来|这里|看起来|因此|另外|同时|不过|但是|我会|我先)[：:])/g, "\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap(splitLongThinkingPart);
}

function splitLongThinkingPart(text: string) {
  if (text.length <= THINKING_PARAGRAPH_MAX_CHARS) return [text];
  const segments = text
    .split(/(?<=[，,])\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length <= 1) return [text];

  const parts: string[] = [];
  let current = "";
  const pushCurrent = () => {
    if (!current) return;
    parts.push(current);
    current = "";
  };

  for (const segment of segments) {
    if (!current) {
      current = segment;
    } else if (current.length + segment.length > THINKING_PARAGRAPH_MAX_CHARS) {
      pushCurrent();
      current = segment;
    } else {
      current = `${current}${segment}`;
    }
  }
  pushCurrent();
  return parts;
}

function RunEventSection(props: { event: AgentRunEvent; compact?: boolean; displayStatus?: AgentRunEvent["status"] }) {
  const { t } = useTranslation();
  const displayStatus = props.displayStatus ?? props.event.status;
  const toolName = typeof props.event.metadata?.toolName === "string" ? props.event.metadata.toolName : null;
  const details = runEventDetailEntries(props.event, t);
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
      className={`[display:grid] [min-width:0] [overflow:hidden] [gap:8px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:10px_12px] [background:#ffffff] [font-size:12px] ${displayStatus === "streaming" ? "[border-color:var(--accent-hover)]" : ""} ${displayStatus === "error" ? "[border-color:#dc26262e] [background:#fef2f2]" : ""}`}
    >
      <div className={"[display:flex] [min-width:0] [align-items:center] [gap:6px] [overflow:hidden] [color:var(--muted)] [font-size:12px] [font-weight:700]"}>
        {icon}
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{label}</span>
        <span className={"[flex:0_0_auto] [margin-left:auto] [font-weight:600]"}>{formatRunEventDisplayStatus(props.event, displayStatus)}</span>
      </div>
      {props.event.content ? (
        <pre className={`${props.compact ? "[max-height:160px] [font-size:11px]" : "[max-height:220px] [font-size:12px]"} [margin:0] [overflow:auto] [border-radius:10px] [padding:10px] [white-space:pre-wrap] [color:#404040] [background:#f8fafc] [line-height:1.5]`}>
          {props.event.content}
        </pre>
      ) : null}
      {details.length ? (
        <div className={"[display:grid] [gap:7px]"}>
          {details.map((detail) => (
            <div key={detail.key} className={"[display:grid] [gap:4px]"}>
              <span className={"[color:var(--muted)] [font-size:11px] [font-weight:750]"}>{detail.label}</span>
              <pre className={`${props.compact ? "[max-height:220px] [font-size:11px]" : "[max-height:360px] [font-size:12px]"} [margin:0] [overflow:auto] [border-radius:10px] [border:1px_solid_var(--border)] [padding:10px] [white-space:pre-wrap] [color:#262626] [background:#ffffff] [line-height:1.5] [scrollbar-gutter:stable]`}>
                {detail.value}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function runEventDetailEntries(event: AgentRunEvent, t: (key: string, values?: TranslateParams) => string) {
  const metadata = event.metadata ?? {};
  const entries: Array<{ key: string; label: string; value: string }> = [];
  const push = (key: string, label: string, value: unknown) => {
    const formatted = formatRunEventMetadataValue(value);
    if (!formatted) return;
    entries.push({ key, label, value: formatted });
  };

  if (event.type === "tool_call") {
    push("input", t("thinkingPanel.toolInput"), metadata.input);
  } else if (event.type === "tool_result") {
    push("summary", t("thinkingPanel.toolSummary"), metadata.summary);
    push("output", t("thinkingPanel.toolOutput"), metadata.output);
    push("error", t("thinkingPanel.toolError"), metadata.error);
  } else if (event.type === "file_write") {
    push("path", t("runPanel.writeFile"), metadata.path);
  }

  return entries;
}

function formatRunEventMetadataValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2).trim();
  } catch {
    return String(value).trim();
  }
}

function formatRunEventDisplayStatus(event: AgentRunEvent, status: AgentRunEvent["status"]) {
  if (event.type === "tool_call" && status === "success") {
    return formatRunEventStatus({ type: "tool_result", status });
  }
  return formatRunEventStatus({ type: event.type, status });
}
