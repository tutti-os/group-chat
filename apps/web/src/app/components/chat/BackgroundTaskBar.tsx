import { BrainCircuit, Bot, Ear, LoaderCircle, X } from "lucide-react";
import { backgroundTaskLabel, backgroundTaskStatusLabel, type AgentRunTaskItem, type BackgroundTask } from "../../background-tasks.js";

export function BackgroundTaskBar(props: {
  tasks: BackgroundTask[];
  agentRuns: AgentRunTaskItem[];
  openTaskId: string | null;
  openAgentRunId: string | null;
  onOpenTask: (taskId: string) => void;
  onDismissTask: (taskId: string) => void;
  onOpenAgentRun: (runId: string) => void;
  onDismissAgentRun: (runId: string) => void;
}) {
  const items = [...props.tasks, ...props.agentRuns];
  if (items.length === 0) return null;

  return (
    <div className={"[display:flex] [flex-wrap:wrap] [gap:6px] [padding:0_clamp(14px,_2.25vw,_32px)_8px] [background:var(--panel)] max-[1080px]:[padding-inline:16px] max-[760px]:[padding:0_12px_8px]"} aria-label="临时任务栏">
      {props.tasks.map((task) => (
        <div
          key={task.id}
          className={`[display:inline-flex] [max-width:min(280px,_100%)] [align-items:center] [gap:2px] [border:1px_solid_var(--border)] [border-radius:999px] [padding:2px_2px_2px_4px] [color:var(--text)] [background:#ffffff] [font-size:12px] [font-weight:650] ${props.openTaskId === task.id ? "[border-color:var(--primary)] [background:var(--accent-soft)]" : ""}`}
        >
          <button
            type="button"
            className={"[display:inline-flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:6px] [border:0] [border-radius:999px] [padding:3px_6px] [color:inherit] [background:transparent] [font-size:inherit] [font-weight:inherit] [cursor:pointer] hover:[background:#00000006]"}
            onClick={() => props.onOpenTask(task.id)}
            title={task.sourcePreview}
          >
            {task.status === "running" ? <LoaderCircle size={13} className={"animate-spin"} /> : <BrainCircuit size={13} />}
            <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>{backgroundTaskLabel(task)}</span>
            <span className={"[color:var(--muted)] [font-size:11px] [font-weight:550]"}>{backgroundTaskStatusLabel(task)}</span>
          </button>
          <button
            type="button"
            className={"[display:grid] [flex:0_0_auto] [width:22px] [height:22px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [cursor:pointer] hover:[color:var(--text)] hover:[background:#00000008]"}
            aria-label="关闭任务"
            onClick={() => props.onDismissTask(task.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {props.agentRuns.map((run) => {
        const isWhisper = run.visibility === "whisper";
        const isOpen = props.openAgentRunId === run.id;
        return (
          <div
            key={run.id}
            data-whisper={isWhisper || undefined}
            className={`[display:inline-flex] [max-width:min(280px,_100%)] [align-items:center] [gap:2px] [border-radius:999px] [padding:2px_2px_2px_4px] [color:var(--text)] [background:#ffffff] [font-size:12px] [font-weight:650] ${isWhisper ? "[border:1px_dashed_var(--border)]" : "[border:1px_solid_var(--border)]"} ${isOpen ? "[border-color:var(--primary)] [background:var(--accent-soft)]" : ""}`}
          >
            <button
              type="button"
              className={"[display:inline-flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:6px] [border:0] [border-radius:999px] [padding:3px_8px] [color:inherit] [background:transparent] [font-size:inherit] [font-weight:inherit] [cursor:pointer] hover:[background:#00000006]"}
              onClick={() => props.onOpenAgentRun(run.id)}
              title={run.preview}
            >
              <LoaderCircle size={13} className={"animate-spin"} />
              {isWhisper ? <Ear size={13} /> : <Bot size={13} />}
              <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
                {run.participantName} 执行中
              </span>
            </button>
            <button
              type="button"
              className={"[display:grid] [flex:0_0_auto] [width:22px] [height:22px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [cursor:pointer] hover:[color:var(--text)] hover:[background:#00000008]"}
              aria-label="取消任务"
              onClick={() => props.onDismissAgentRun(run.id)}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
