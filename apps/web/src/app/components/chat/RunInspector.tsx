import type { AgentRun, Participant } from "@group-chat/shared";

export function RunInspector(props: {
  participants: Participant[];
  activeRuns: AgentRun[];
  openAgentRunId: string | null;
  onOpenAgentRun: (runId: string) => void;
}) {
  if (props.activeRuns.length === 0) return null;

  const primaryRunId = props.activeRuns[0]?.id ?? null;
  const label = formatActiveRuns(props.activeRuns, props.participants);
  const open = primaryRunId ? props.openAgentRunId === primaryRunId : false;

  return (
    <section className={"[min-height:32px] [padding:0_clamp(14px,_2.25vw,_32px)_8px] [background:var(--panel)] max-[1080px]:[padding-inline:16px] max-[760px]:[padding:0_12px_8px]"} aria-label="Agent execution status">
      <button
        type="button"
        className={`[display:block] [width:100%] [margin:0] [overflow:hidden] [border:0] [padding:0] [color:var(--muted)] [background:transparent] [font-size:13px] [line-height:24px] [text-align:left] [text-overflow:ellipsis] [white-space:nowrap] [cursor:pointer] hover:[color:var(--text)] ${open ? "[color:var(--text)] [font-weight:650]" : ""}`}
        onClick={() => {
          if (primaryRunId) props.onOpenAgentRun(primaryRunId);
        }}
        title="查看 Agent 执行过程"
      >
        {label}
      </button>
    </section>
  );
}

function formatActiveRuns(activeRuns: AgentRun[], participants: Participant[]) {
  const labels = activeRuns.map((run) => participantLabel(participants, run.participantId));
  if (labels.length === 1) return `${labels[0]} 的 Agent 正在执行 ...`;
  return `${labels[0]} 等 ${labels.length} 个 Agent 正在执行 ...`;
}

function participantLabel(participants: Participant[], participantId: string | null) {
  return participants.find((participant) => participant.id === participantId)?.displayName ?? "Agent";
}
