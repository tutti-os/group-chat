import { ChevronRight } from "lucide-react";
import { Badge } from "@tutti-os/ui-system";
import type { Identity, LocalAgentProviderStatus, Participant, RuntimeProfile } from "@group-chat/shared";
import { useTranslation } from "../../i18n/index.js";
import { runtimeStatusSummary } from "../../runtime.js";
import { resolveAgentAvatar } from "../../identity-avatar.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";

export function AgentManageCard(props: {
  participant: Participant;
  identity: Identity | null;
  runtimeProfile: RuntimeProfile | null;
  localAgentProviders: LocalAgentProviderStatus[];
  highlighted?: boolean;
  onOpen: (participant: Participant) => void;
}) {
  const { t } = useTranslation();
  const { participant, identity, runtimeProfile } = props;
  const muted = participant.status === "muted";
  const displayAvatar = participant.avatar ?? identity?.icon ?? null;
  const resolvedAvatar = resolveAgentAvatar({
    avatar: displayAvatar,
    icon: identity?.icon,
    participantId: participant.id,
    runtimeProfile,
  });
  const selectedRuntime = runtimeProfile;

  return (
    <article
      data-muted={muted || undefined}
      data-highlighted={props.highlighted || undefined}
      className={"[overflow:hidden] [border:1px_solid_var(--border-1)] [border-radius:8px] [background:var(--white-stationary)] [transition:background-color_0.2s_ease,_border-color_0.2s_ease,_box-shadow_0.2s_ease] [&[data-muted=true]]:[opacity:0.72] [&[data-highlighted=true]]:[border-color:var(--accent-codex)] [&[data-highlighted=true]]:[background:var(--accent-bg)] [&[data-highlighted=true]]:[box-shadow:0_0_0_1px_var(--accent-bg),0_8px_20px_color-mix(in_srgb,var(--accent-codex)_12%,transparent)]"}
    >
      <button
        type="button"
        className={"[display:grid] [box-sizing:border-box] [width:100%] [height:58px] [min-height:58px] [grid-template-columns:34px_minmax(0,_1fr)_auto_16px] [align-items:center] [gap:9px] [border:0] [border-radius:8px] [padding:12px_10px] [text-align:left] [color:inherit] [background:transparent] [&:hover]:[background:var(--background-panel)] [&:focus-visible]:[outline:none] [[data-highlighted=true]_&]:[&:hover]:[background:transparent]"}
        aria-label={t("agentCard.openSettings", { name: participant.displayName })}
        onClick={() => props.onOpen(participant)}
      >
        <span className={"[display:grid] [width:34px] [height:34px] [flex-shrink:0] [place-items:center]"}>
          <AgentAvatar title={participant.displayName} avatar={resolvedAvatar.avatar} provider={resolvedAvatar.provider} size={34} hideProviderBadge />
        </span>
        <span className={"[display:grid] [height:34px] [min-width:0] [align-content:center]"}>
          <strong className={"[display:block] [overflow:hidden] [font-size:13px] [font-weight:700] [line-height:1.15] [text-overflow:ellipsis] [white-space:nowrap]"}>
            {participant.displayName}
          </strong>
          <small className={"[display:block] [overflow:hidden] [margin-top:2px] [color:var(--text-secondary)] [font-size:11px] [line-height:1.15] [text-overflow:ellipsis] [white-space:nowrap]"}>
            {[identity?.name, runtimeStatusSummary(selectedRuntime, props.localAgentProviders)]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
        <span className={"[display:flex] [flex-shrink:0] [flex-wrap:nowrap] [align-items:center] [justify-content:flex-end] [gap:4px]"}>
          {props.highlighted ? (
            <Badge variant="accent" className={"[font-weight:700]"}>
              {t("agentCard.newlyAdded")}
            </Badge>
          ) : null}
          {muted ? (
            <Badge variant="warning" className={"[font-weight:700]"}>
              {t("agentCard.muted")}
            </Badge>
          ) : null}
        </span>
        <ChevronRight size={16} className={"[color:var(--text-secondary)]"} />
      </button>
    </article>
  );
}
