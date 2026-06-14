import type { ParticipantListenMode } from "@group-chat/shared";

const engagementOptions: Array<{ value: ParticipantListenMode; label: string; description: string }> = [
  { value: "passive", label: "被@", description: "通常只在被点名或手动选择时回复" },
  { value: "adaptive", label: "自适应", description: "根据消息内容判断是否接话" },
  { value: "active", label: "积极", description: "更主动参与房间讨论" },
];

export function EngagementPicker(props: {
  value: ParticipantListenMode;
  subjectName: string;
  readOnly?: boolean;
  layout?: "compact" | "comfortable";
  onChange: (listenMode: ParticipantListenMode) => void;
}) {
  const current = engagementOptions.find((option) => option.value === props.value) ?? engagementOptions[0]!;
  const comfortable = props.layout === "comfortable";
  if (props.readOnly) {
    return (
      <label className={"[display:grid] [gap:5px] [&_span]:[color:#525252] [&_span]:[font-size:12px] [&_span]:[font-weight:650]"}>
        <span>积极性</span>
        <input
          value={current.label}
          readOnly
          aria-readonly
          className={"[height:40px] [width:100%] [min-width:0] [border:1px_solid_var(--border)] [border-radius:12px] [padding:0_12px] [color:var(--muted)] [background:#f3f4f6] [font-size:13px] [cursor:default] [outline:none]"}
        />
      </label>
    );
  }
  return (
    <div className={comfortable ? "[display:grid] [gap:12px]" : "[display:grid] [gap:6px]"}>
      {comfortable ? (
        <div className={"[display:grid] [gap:4px]"}>
          <span className={"[color:#525252] [font-size:12px] [font-weight:650]"}>积极性</span>
          <p className={"[margin:0] [color:var(--muted)] [font-size:12px] [line-height:1.55]"}>{current.description}</p>
        </div>
      ) : (
        <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
          <span className={"[color:#525252] [font-size:12px] [font-weight:650]"}>积极性</span>
          <small className={"[color:var(--muted)] [font-size:12px]"}>{current.description}</small>
        </div>
      )}
      <div
        className={
          comfortable
            ? "[display:grid] [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:6px] [border-radius:14px] [padding:5px] [background:#00000006] [&_button]:[height:38px] [&_button]:[min-width:0] [&_button]:[border:0] [&_button]:[border-radius:11px] [&_button]:[color:var(--muted)] [&_button]:[background:transparent] [&_button]:[font-size:13px] [&_button]:[font-weight:750] [&_button]:[transition:background-color_0.12s_ease,_color_0.12s_ease,_box-shadow_0.12s_ease] [&_button:hover]:[color:var(--text)] [&_button:focus-visible]:[outline:none]"
            : "[display:grid] [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:4px] [border-radius:13px] [padding:4px] [background:#00000008] [&_button]:[height:34px] [&_button]:[min-width:0] [&_button]:[border:0] [&_button]:[border-radius:10px] [&_button]:[color:var(--muted)] [&_button]:[background:transparent] [&_button]:[font-size:12px] [&_button]:[font-weight:750] [&_button]:[transition:background-color_0.12s_ease,_color_0.12s_ease,_box-shadow_0.12s_ease] [&_button:hover]:[color:var(--text)] [&_button:focus-visible]:[outline:none]"
        }
      >
        {engagementOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={props.value === option.value}
            aria-label={`${option.label} 积极性 ${props.subjectName}`}
            className={props.value === option.value ? "![color:#ffffff] ![background:#171717] [box-shadow:0_1px_6px_rgb(0_0_0_/_18%)]" : ""}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
