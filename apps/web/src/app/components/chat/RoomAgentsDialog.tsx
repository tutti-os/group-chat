import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  type Identity,
  type LocalAgentProviderStatus,
  type Participant,
  type RuntimeProfile,
} from "@group-chat/shared";
import { useTranslation } from "../../i18n/index.js";
import { AgentManageCard } from "./AgentManageCard.js";

export function RoomAgentsDialog(props: {
  open: boolean;
  conversationId: string;
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
  onClose: () => void;
  onOpenParticipant: (participant: Participant) => void;
  onStartAddAgent: () => void;
}) {
  const { t } = useTranslation();
  const [recentlyAddedParticipantIds, setRecentlyAddedParticipantIds] = useState<Set<string>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { onClose } = props;

  const agents = props.participants
    .filter((participant) => participant.kind === "ai" && participant.status !== "removed")
    .sort((left, right) => {
      const leftRecent = recentlyAddedParticipantIds.has(left.id);
      const rightRecent = recentlyAddedParticipantIds.has(right.id);
      if (leftRecent !== rightRecent) return leftRecent ? -1 : 1;
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      return right.sortOrder - left.sortOrder;
    });

  useEffect(() => {
    if (!props.open) {
      setRecentlyAddedParticipantIds(new Set());
      return;
    }
  }, [props.open]);

  useEffect(() => {
    if (recentlyAddedParticipantIds.size === 0) return;
    const timer = window.setTimeout(() => setRecentlyAddedParticipantIds(new Set()), 8000);
    return () => window.clearTimeout(timer);
  }, [recentlyAddedParticipantIds]);

  useEffect(() => {
    if (!props.open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, props.open]);

  if (!props.open) return null;

  return (
    <div
      className={"[position:fixed] [inset:0] [z-index:75] [display:grid] [place-items:center] [padding:24px] [background:color-mix(in_srgb,var(--black-stationary)_52%,transparent)] max-[760px]:[padding:14px]"}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("roomAgents.title")}
        className={"[display:flex] [width:min(680px,_calc(100vw_-_32px))] [max-height:min(720px,_calc(100vh_-_32px))] [flex-direction:column] [overflow:hidden] [border:1px_solid_var(--border-1)] [border-radius:8px] [background:var(--background-fronted)] [box-shadow:0_24px_80px_color-mix(in_srgb,var(--black-stationary)_24%,transparent)] max-[760px]:[width:calc(100vw_-_28px)] max-[760px]:[max-height:calc(100vh_-_28px)]"}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={"[display:flex] [flex:0_0_auto] [align-items:flex-start] [justify-content:space-between] [gap:12px] [padding:16px_18px] [border-bottom:1px_solid_var(--border-1)]"}>
          <div className={"[min-width:0] [&_h3]:[margin:0] [&_h3]:[font-size:15px] [&_h3]:[font-weight:720] [&_h3]:[line-height:1.2] [&_span]:[display:block] [&_span]:[margin-top:3px] [&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px]"}>
            <h3>{t("roomAgents.title")}</h3>
            <span>{t("roomAgents.count", { count: agents.length })}</span>
          </div>
          <button
            className={"dialog-close-button [display:inline-grid] [flex-shrink:0] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:8px] [color:var(--text-secondary)] [background:var(--transparency-hover)] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--line-focus-window)] [&:focus-visible]:[outline:none]"}
            type="button"
            aria-label={t("roomAgents.closeDialog")}
            title={t("common.close")}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className={"[min-height:0] [flex:1_1_auto] [overflow-y:auto] [padding:14px] [display:grid] [align-content:start] [gap:8px]"}>
          <button
            className={"[display:inline-flex] [width:100%] [height:42px] [align-items:center] [justify-content:center] [gap:8px] [border:1px_solid_var(--border-focus)] [border-radius:8px] [padding:0_16px] [font-size:13px] [font-weight:650] [color:var(--accent-codex)] [background:var(--accent-bg)] [transition:background-color_0.12s_ease,_border-color_0.12s_ease] [&:hover:not(:disabled)]:[border-color:var(--accent-codex)] [&:hover:not(:disabled)]:[background:var(--accent-bg)] [&:focus-visible]:[outline:none] [&:focus-visible]:[box-shadow:0_0_0_3px_var(--border-focus)] [&_svg]:[color:var(--accent-codex)]"}
            type="button"
            aria-label={t("roomAgents.addAgent")}
            onClick={props.onStartAddAgent}
          >
            <Plus size={18} strokeWidth={2.25} />
            <span>{t("roomAgents.addAgentButton")}</span>
          </button>

          {agents.length === 0 ? (
            <div className={"[display:grid] [gap:10px] [border:1px_dashed_var(--border-1)] [border-radius:8px] [padding:24px_14px] [color:var(--text-secondary)] [background:color-mix(in_srgb,var(--white-stationary)_60%,transparent)] [font-size:13px] [line-height:1.5] [text-align:center] [&_strong]:[color:var(--text-primary)] [&_strong]:[font-size:13px]"}>
              <strong>{t("roomAgents.emptyTitle")}</strong>
              <span>{t("roomAgents.emptyHint")}</span>
            </div>
          ) : null}

          {agents.length > 0 ? (
            <h4 className={"[margin:4px_0_0] [color:var(--text-secondary)] [font-size:11px] [font-weight:700] [line-height:1.2]"}>
              {t("roomAgents.inRoom")}
            </h4>
          ) : null}

          {agents.map((participant) => {
            const identity = props.identities.find((item) => item.id === participant.identityId) ?? null;
            const runtimeProfile = props.runtimeProfiles.find((profile) => profile.id === participant.runtimeProfileId) ?? null;
            return (
              <AgentManageCard
                key={participant.id}
                participant={participant}
                identity={identity}
                runtimeProfile={runtimeProfile}
                localAgentProviders={props.localAgentProviders}
                highlighted={recentlyAddedParticipantIds.has(participant.id)}
                onOpen={props.onOpenParticipant}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
