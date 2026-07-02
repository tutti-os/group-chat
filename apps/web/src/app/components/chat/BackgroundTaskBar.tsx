import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BrainCircuit, Bot, ChevronDown, ChevronUp, Ear, LoaderCircle, X } from "lucide-react";
import { backgroundTaskLabel, backgroundTaskStatusLabel, type AgentRunTaskItem, type BackgroundTask } from "../../background-tasks.js";
import { WHISPER_FEATURE_ENABLED } from "../../feature-flags.js";
import { truncateMiddle } from "../../formatting.js";
import { useTranslation } from "../../i18n/index.js";

export function BackgroundTaskBar(props: {
  tasks: BackgroundTask[];
  agentRuns: AgentRunTaskItem[];
  openTaskId: string | null;
  openAgentRunId: string | null;
  onOpenTask: (taskId: string) => void;
  onDismissTask: (taskId: string) => void;
  onOpenAgentRun: (runId: string) => void;
  onDismissAgentRun: (runId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (props.tasks.length === 0 && props.agentRuns.length === 0) return null;

  return (
    <div
      className={`[display:grid] [width:100%] [box-sizing:border-box] [gap:0] [background:transparent] ${props.className ?? ""}`}
      aria-label={t("taskBar.panel")}
    >
      {props.tasks.length > 0 ? (
        <div
          className={"[display:flex] [flex-wrap:wrap] [align-items:flex-start] [align-content:flex-start] [gap:6px] [padding:8px_clamp(14px,_2.25vw,_32px)_0] max-[1080px]:[padding-inline:16px] max-[760px]:[padding:8px_12px_0]"}
        >
          {props.tasks.map((task) => (
            <div
              key={task.id}
              className={`[display:inline-flex] [flex:0_0_auto] [max-width:min(280px,_100%)] [align-items:center] [gap:2px] [border:1px_solid_var(--border-1)] [border-radius:999px] [padding:2px_2px_2px_4px] [color:var(--text-primary)] [background:var(--white-stationary)] [font-size:11px] [font-weight:650] ${props.openTaskId === task.id ? "[border-color:var(--black-stationary)] [background:var(--accent-bg)]" : ""}`}
            >
              <button
                type="button"
                className={"[display:inline-flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:6px] [border:0] [border-radius:999px] [padding:3px_6px] [color:inherit] [background:transparent] [font-size:11px] [font-weight:inherit] [cursor:pointer] hover:[background:var(--transparency-block)]"}
                onClick={() => props.onOpenTask(task.id)}
                title={task.sourcePreview}
              >
                {task.status === "running" ? <LoaderCircle size={13} className={"animate-spin"} /> : <BrainCircuit size={13} />}
                <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{backgroundTaskLabel(task)}</span>
                <span className={"[color:var(--text-secondary)] [font-size:11px] [font-weight:550]"}>{backgroundTaskStatusLabel(task)}</span>
              </button>
              <button
                type="button"
                className={"[display:grid] [flex:0_0_auto] [width:22px] [height:22px] [place-items:center] [border:0] [border-radius:999px] [color:var(--text-secondary)] [background:transparent] [cursor:pointer] hover:[color:var(--text-primary)] hover:[background:var(--transparency-hover)]"}
                aria-label={t("taskBar.closeTask")}
                onClick={() => props.onDismissTask(task.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {props.agentRuns.length > 0 ? (
        <ExecutingRunsPanel
          agentRuns={props.agentRuns}
          openAgentRunId={props.openAgentRunId}
          onOpenAgentRun={props.onOpenAgentRun}
          onDismissAgentRun={props.onDismissAgentRun}
        />
      ) : null}
    </div>
  );
}

function ExecutingRunsPanel(props: {
  agentRuns: AgentRunTaskItem[];
  openAgentRunId: string | null;
  onOpenAgentRun: (runId: string) => void;
  onDismissAgentRun: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [pendingDismissRunId, setPendingDismissRunId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingDismissRunId && !props.agentRuns.some((run) => run.id === pendingDismissRunId)) {
      setPendingDismissRunId(null);
    }
  }, [pendingDismissRunId, props.agentRuns]);

  return (
    <section
      aria-label={t("taskBar.executingCount", { count: props.agentRuns.length })}
      className={"[position:relative] [width:calc(100%-32px)] [max-width:960px] [margin:4px_auto_3px] [border:1px_solid_var(--accent-bg)] [border-radius:11px] [background:linear-gradient(180deg,_var(--accent-bg)_0%,_var(--tutti-purple-bg)_100%)] max-[760px]:[width:calc(100%-24px)] max-[760px]:[margin:4px_auto_3px]"}
    >
      <button
        type="button"
        className={"[display:flex] [width:100%] [align-items:center] [justify-content:space-between] [gap:8px] [border:0] [border-radius:10px] [padding:5px_8px_5px_11px] [color:inherit] [background:transparent] [cursor:pointer] [text-align:left] hover:[background:color-mix(in_srgb,var(--white-stationary)_32%,transparent)] [&:focus-visible]:[outline:none] [&:focus-visible]:[box-shadow:0_0_0_2px_var(--border-focus)]"}
        aria-label={expanded ? t("taskBar.collapse") : t("taskBar.expand")}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <div className={"[display:inline-flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:6px] [color:var(--accent-codex)] [font-size:11px] [font-weight:650]"}>
          <LoaderCircle size={14} className={"[flex:0_0_auto] animate-spin"} />
          <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
            {t("taskBar.executingCount", { count: props.agentRuns.length })}
          </span>
        </div>
        <span className={"[display:grid] [flex:0_0_auto] [width:22px] [height:22px] [place-items:center] [border-radius:6px] [color:var(--text-secondary)] [background:color-mix(in_srgb,var(--white-stationary)_60%,transparent)]"}>
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </span>
      </button>
      {expanded ? (
        <div
          className={"[display:grid] [gap:6px] [padding:0_10px_10px_12px]"}
        >
          {props.agentRuns.map((run) => {
            const isWhisper = WHISPER_FEATURE_ENABLED && run.visibility === "whisper";
            const isOpen = props.openAgentRunId === run.id;
            const pendingDismiss = pendingDismissRunId === run.id;
            return (
              <div
                key={run.id}
                data-whisper={isWhisper || undefined}
                className={`[position:relative] [display:flex] [width:100%] [min-width:0] [box-sizing:border-box] [align-items:center] [gap:2px] [border-radius:0] [padding:0] [color:var(--text-primary)] [background:transparent] [font-size:11px] [font-weight:650] [box-shadow:none] ${isWhisper ? "[border:1px_dashed_transparent]" : "[border:1px_solid_transparent]"} ${isOpen ? "[border-color:var(--border-focus)] [background:var(--transparency-hover)]" : ""} ${pendingDismiss ? "[border-color:color-mix(in_srgb,var(--state-danger)_28%,transparent)] [background:var(--on-danger)]" : ""}`}
              >
                <button
                  type="button"
                  className={`[display:inline-flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:8px] [border:0] [border-radius:6px] [padding:4px_8px] [color:inherit] [background:transparent] [font-size:11px] [font-weight:inherit] [cursor:pointer] hover:[background:var(--transparency-block)] ${pendingDismiss ? "[pointer-events:none] [opacity:0.72]" : ""}`}
                  onClick={() => props.onOpenAgentRun(run.id)}
                  title={run.preview}
                >
                  <LoaderCircle size={13} className={"animate-spin"} />
                  {isWhisper ? <Ear size={13} /> : <Bot size={13} />}
                  <AgentExecutingLabel participantName={run.participantName} />
                </button>
                <div className={"[display:grid] [flex:0_0_auto] [width:22px] [height:22px] [place-items:center]"}>
                  {!pendingDismiss ? (
                    <button
                      type="button"
                      className={"[display:grid] [width:22px] [height:22px] [place-items:center] [border:0] [border-radius:999px] [color:var(--text-secondary)] [background:transparent] [cursor:pointer] hover:[color:var(--text-primary)] hover:[background:var(--transparency-hover)]"}
                      aria-label={t("taskBar.cancelTask")}
                      onClick={() => setPendingDismissRunId(run.id)}
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
                {pendingDismiss ? (
                  <div
                    className={"[position:absolute] [top:2px] [right:2px] [bottom:2px] [z-index:1] [display:inline-flex] [align-items:center] [gap:2px] [border-radius:999px] [padding:0_2px_0_10px] [background:linear-gradient(90deg,_var(--on-danger)00_0%,_var(--on-danger)_18%,_var(--on-danger)_100%)]"}
                  >
                    <button
                      type="button"
                      className={"[height:22px] [border:0] [border-radius:999px] [padding:0_8px] [color:var(--text-secondary)] [background:transparent] [font-size:11px] [font-weight:650] [cursor:pointer] hover:[color:var(--text-primary)] hover:[background:var(--transparency-hover)]"}
                      onClick={() => setPendingDismissRunId(null)}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className={"[height:22px] [border:0] [border-radius:999px] [padding:0_8px] [color:var(--state-danger)] [background:var(--on-danger)] [font-size:11px] [font-weight:650] [cursor:pointer] hover:[background:color-mix(in_srgb,var(--state-danger)_18%,transparent)]"}
                      onClick={() => {
                        setPendingDismissRunId(null);
                        void props.onDismissAgentRun(run.id);
                      }}
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function AgentExecutingLabel(props: { participantName: string }) {
  const { t } = useTranslation();
  const suffix = t("taskBar.executingSuffix");
  const nameRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [displayName, setDisplayName] = useState(props.participantName.trim());

  useLayoutEffect(() => {
    const nameNode = nameRef.current;
    const measureNode = measureRef.current;
    if (!nameNode || !measureNode) return;

    const update = () => {
      const full = props.participantName.trim();
      if (!full) {
        setDisplayName("");
        return;
      }
      const availableWidth = nameNode.clientWidth;
      if (availableWidth <= 0) {
        setDisplayName(truncateMiddle(full, 8));
        return;
      }

      measureNode.textContent = full;
      if (measureNode.offsetWidth <= availableWidth) {
        setDisplayName(full);
        return;
      }
      let low = 4;
      let high = full.length;
      let best = truncateMiddle(full, 4);
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = truncateMiddle(full, mid);
        measureNode.textContent = candidate;
        if (measureNode.offsetWidth <= availableWidth) {
          best = candidate;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      setDisplayName(best);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(nameNode);
    return () => observer.disconnect();
  }, [props.participantName, suffix]);

  return (
    <span
      className={"[display:inline-flex] [min-width:0] [flex:1_1_auto] [align-items:baseline] [overflow:hidden] [white-space:nowrap]"}
      title={`${props.participantName.trim()}${suffix}`}
    >
      <span ref={nameRef} className={"[min-width:0] [flex:1_1_auto] [overflow:hidden] [white-space:nowrap]"}>
        {displayName}
      </span>
      <span className={"[flex:0_0_auto]"}>{suffix}</span>
      <span
        ref={measureRef}
        aria-hidden="true"
        className={"[position:absolute] [visibility:hidden] [white-space:nowrap] [pointer-events:none]"}
      />
    </span>
  );
}
