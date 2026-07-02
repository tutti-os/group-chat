import type { ParticipantListenMode } from "@group-chat/shared";
import { getEngagementOptions } from "../../constants.js";
import { useTranslation } from "../../i18n/index.js";

export function EngagementPicker(props: {
  value: ParticipantListenMode;
  subjectName: string;
  readOnly?: boolean;
  layout?: "compact" | "comfortable";
  onChange: (listenMode: ParticipantListenMode) => void;
}) {
  const { t } = useTranslation();
  const engagementOptions = getEngagementOptions();
  const current = engagementOptions.find((option) => option.value === props.value) ?? engagementOptions[0]!;
  const comfortable = props.layout === "comfortable";
  if (props.readOnly) {
    return (
      <label className={"[display:grid] [gap:5px] [&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px] [&_span]:[font-weight:650]"}>
        <span>{t("engagement.title")}</span>
        <input
          value={current.label}
          readOnly
          aria-readonly
          className={"[height:40px] [width:100%] [min-width:0] [border:1px_solid_var(--border-1)] [border-radius:12px] [padding:0_12px] [color:var(--text-secondary)] [background:var(--background-panel)] [font-size:13px] [cursor:default] [outline:none]"}
        />
      </label>
    );
  }
  return (
    <div className={comfortable ? "[display:grid] [gap:12px]" : "[display:grid] [gap:6px]"}>
      {comfortable ? (
        <div className={"[display:grid] [gap:4px]"}>
          <span className={"[color:var(--text-secondary)] [font-size:11px] [font-weight:650]"}>{t("engagement.title")}</span>
          <p className={"[margin:0] [color:var(--text-secondary)] [font-size:11px] [line-height:1.55]"}>{current.description}</p>
        </div>
      ) : (
        <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
          <span className={"[color:var(--text-secondary)] [font-size:11px] [font-weight:650]"}>{t("engagement.title")}</span>
          <small className={"[color:var(--text-secondary)] [font-size:11px]"}>{current.description}</small>
        </div>
      )}
      <div
        className={
          comfortable
            ? "[display:grid] [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:6px] [border-radius:14px] [padding:5px] [background:var(--transparency-block)] [&_button]:[height:38px] [&_button]:[min-width:0] [&_button]:[border:0] [&_button]:[border-radius:11px] [&_button]:[color:var(--text-secondary)] [&_button]:[background:transparent] [&_button]:[font-size:13px] [&_button]:[font-weight:750] [&_button]:[transition:background-color_0.12s_ease,_color_0.12s_ease,_box-shadow_0.12s_ease] [&_button:hover]:[color:var(--text-primary)] [&_button:focus-visible]:[outline:none]"
            : "[display:grid] [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:4px] [border-radius:13px] [padding:4px] [background:var(--transparency-hover)] [&_button]:[height:34px] [&_button]:[min-width:0] [&_button]:[border:0] [&_button]:[border-radius:10px] [&_button]:[color:var(--text-secondary)] [&_button]:[background:transparent] [&_button]:[font-size:11px] [&_button]:[font-weight:750] [&_button]:[transition:background-color_0.12s_ease,_color_0.12s_ease,_box-shadow_0.12s_ease] [&_button:hover]:[color:var(--text-primary)] [&_button:focus-visible]:[outline:none]"
        }
      >
        {engagementOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={props.value === option.value}
            aria-label={t("engagement.optionAria", { label: option.label, name: props.subjectName })}
            className={props.value === option.value ? "![color:var(--white-stationary)] ![background:var(--black-stationary)] [box-shadow:0_1px_6px_color-mix(in_srgb,var(--black-stationary)_18%,transparent)]" : ""}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
