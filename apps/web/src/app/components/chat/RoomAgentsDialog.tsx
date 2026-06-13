import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import {
  type Identity,
  type LocalAgentProviderStatus,
  type Participant,
  type RuntimeProfile,
} from "@group-chat/shared";
import { AgentManageCard } from "./AgentManageCard.js";
import { resolveAgentAvatar } from "../../identity-avatar.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";

export function RoomAgentsDialog(props: {
  open: boolean;
  startAdding?: boolean;
  conversationId: string;
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
  onClose: () => void;
  onOpenParticipant: (participant: Participant) => void;
  onConfigureNewAgent: (identity: Identity) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [selectedAddIdentityId, setSelectedAddIdentityId] = useState<string | null>(null);
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

  const addableIdentities = props.identities;
  const filteredAddableIdentities = addableIdentities.filter((identity) => {
    const query = addSearch.trim().toLowerCase();
    if (!query) return true;
    return `${identity.name} ${identity.systemPrompt} ${identity.stylePrompt}`.toLowerCase().includes(query);
  });
  const selectedAddIdentity = addableIdentities.find((identity) => identity.id === selectedAddIdentityId) ?? null;

  useEffect(() => {
    if (!props.open) {
      setAdding(false);
      setAddSearch("");
      setSelectedAddIdentityId(null);
      setRecentlyAddedParticipantIds(new Set());
      return;
    }
    if (props.startAdding) {
      setSelectedAddIdentityId(null);
      setAddSearch("");
      setAdding(true);
    }
  }, [props.open, props.startAdding]);

  useEffect(() => {
    if (recentlyAddedParticipantIds.size === 0) return;
    const timer = window.setTimeout(() => setRecentlyAddedParticipantIds(new Set()), 8000);
    return () => window.clearTimeout(timer);
  }, [recentlyAddedParticipantIds]);

  useEffect(() => {
    if (!props.open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (adding) {
          setAdding(false);
          return;
        }
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [adding, onClose, props.open]);

  const startAdding = () => {
    setSelectedAddIdentityId(null);
    setAddSearch("");
    setAdding(true);
  };

  const add = () => {
    if (!selectedAddIdentity) return;
    setAdding(false);
    setSelectedAddIdentityId(null);
    setAddSearch("");
    props.onConfigureNewAgent(selectedAddIdentity);
  };

  if (!props.open) return null;

  return (
    <>
      <div
        className={"[position:fixed] [inset:0] [z-index:75] [display:grid] [place-items:center] [padding:24px] [background:rgb(15_23_42_/_52%)] max-[760px]:[padding:14px]"}
        role="presentation"
        onPointerDown={(event) => {
          if (adding) return;
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="群 Agent 管理"
          className={"[display:flex] [width:min(680px,_calc(100vw_-_32px))] [max-height:min(720px,_calc(100vh_-_32px))] [flex-direction:column] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:20px] [background:var(--panel)] [box-shadow:0_24px_80px_rgb(0_0_0_/_24%)] max-[760px]:[width:calc(100vw_-_28px)] max-[760px]:[max-height:calc(100vh_-_28px)]"}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className={"[display:flex] [flex:0_0_auto] [align-items:center] [justify-content:space-between] [gap:10px] [padding:16px_18px] [border-bottom:1px_solid_var(--border)]"}>
            <div className={"[min-width:0] [&_h3]:[margin:0] [&_h3]:[font-size:16px] [&_h3]:[font-weight:720] [&_h3]:[line-height:1.2] [&_span]:[display:block] [&_span]:[margin-top:3px] [&_span]:[color:var(--muted)] [&_span]:[font-size:12px]"}>
              <h3>群 Agent</h3>
              <span>{agents.length} 个 Agent 在此群</span>
            </div>
            <div className={"[display:flex] [flex-shrink:0] [align-items:center] [gap:6px]"}>
              <button
                className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:1px_solid_#bfdbfe] [border-radius:10px] [color:var(--accent)] [background:#eff6ff] [&:hover:not(:disabled)]:[background:#dbeafe] [&:hover:not(:disabled)]:[border-color:#93c5fd] [&:disabled]:[opacity:0.45] [&:disabled]:[cursor:default] [&:focus-visible]:[outline:none] [&:focus-visible]:[box-shadow:0_0_0_3px_var(--focus-ring)]"}
                type="button"
                aria-label="在群里添加 Agent"
                title="添加 Agent"
                onClick={startAdding}
                disabled={addableIdentities.length === 0}
              >
                <Plus size={18} strokeWidth={2.25} />
              </button>
              <button
                className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
                type="button"
                aria-label="关闭群 Agent 管理"
                title="关闭"
                onClick={onClose}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className={"[min-height:0] [flex:1_1_auto] [overflow-y:auto] [padding:14px] [display:grid] [align-content:start] [gap:8px]"}>
            {agents.length === 0 ? (
              <div className={"[display:grid] [gap:10px] [border:1px_dashed_var(--border)] [border-radius:12px] [padding:24px_14px] [color:var(--muted)] [background:#ffffff99] [font-size:13px] [line-height:1.5] [text-align:center] [&_strong]:[color:var(--text)] [&_strong]:[font-size:14px]"}>
                <strong>此群还没有 Agent</strong>
                <span>{addableIdentities.length ? "添加 Agent 后即可开始群聊协作。" : "请先在「角色」页创建 Agent，再回到群里添加。"}</span>
              </div>
            ) : null}

            {agents.length > 0 ? (
              <h4 className={"[margin:4px_0_0] [color:var(--muted)] [font-size:12px] [font-weight:700] [line-height:1.2]"}>
                已在群里的agent
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

      {adding ? (
        <div
          className={"[position:fixed] [inset:0] [z-index:85] [display:grid] [place-items:center] [padding:32px] [background:rgb(31_35_41_/_36%)] max-[760px]:[padding:14px]"}
          role="presentation"
          onPointerDown={() => setAdding(false)}
        >
          <div
            className={"[display:flex] [width:min(560px,_calc(100vw_-_64px))] [max-height:min(620px,_calc(100vh_-_64px))] [flex-direction:column] [border:1px_solid_var(--border)] [border-radius:28px] [padding:24px_28px_22px] [background:var(--panel)] [box-shadow:0_24px_80px_rgb(0_0_0_/_24%)] max-[760px]:[width:calc(100vw_-_28px)] max-[760px]:[max-height:calc(100vh_-_28px)] max-[760px]:[border-radius:22px] max-[760px]:[padding:22px_20px_18px]"}
            role="dialog"
            aria-modal="true"
            aria-label="添加 Agent"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className={"[&_h2]:[margin:0] [&_h2]:[color:var(--text)] [&_h2]:[font-size:18px] [&_h2]:[font-weight:720] [&_h2]:[line-height:1.2] [&_p]:[margin:5px_0_18px] [&_p]:[color:var(--muted)] [&_p]:[font-size:13px] [&_p]:[line-height:1.35]"}>
              <h2>添加 Agent</h2>
              <p>选择一个 Agent 添加到群聊</p>
            </div>
            <label className={"[display:flex] [height:40px] [align-items:center] [gap:8px] [border-radius:999px] [padding:0_13px] [color:var(--muted)] [background:#f2f3f5] [&_input]:[width:100%] [&_input]:[min-width:0] [&_input]:[border:0] [&_input]:[color:var(--text)] [&_input]:[background:transparent] [&_input]:[font-size:13px] [&_input]:[outline:none] [&_input::placeholder]:[color:#7a7d82] [&_svg]:[width:16px] [&_svg]:[height:16px]"}>
              <Search size={16} />
              <input
                value={addSearch}
                onChange={(event) => setAddSearch(event.target.value)}
                placeholder="搜索 Agent..."
                autoFocus
              />
            </label>
            <div className={"[min-height:220px] [overflow-y:auto] [padding:18px_0_12px]"} role="radiogroup" aria-label="选择 Agent">
              {filteredAddableIdentities.map((identity) => {
                const selected = selectedAddIdentityId === identity.id;
                const resolvedAvatar = resolveAgentAvatar({
                  icon: identity.icon,
                  runtimeProfile: props.runtimeProfiles.find((profile) => profile.id === identity.defaultRuntimeProfileId) ?? null,
                });
                return (
                  <button
                    key={identity.id}
                    role="radio"
                    aria-checked={selected}
                    className={`[display:grid] [width:100%] [grid-template-columns:24px_32px_minmax(0,_1fr)] [align-items:center] [gap:10px] [border:1px_solid_transparent] [border-radius:14px] [padding:8px_12px] [color:var(--text)] [background:transparent] [text-align:left] [transition:background-color_0.12s_ease,_border-color_0.12s_ease,_box-shadow_0.12s_ease] [&:hover]:[background:#f7f7f8] [&:focus-visible]:[outline:none] max-[760px]:[padding:8px] ${selected ? "![border-color:transparent] ![background:#f4f4f5] [box-shadow:inset_0_0_0_1px_#00000008] [&_[data-slot=agent-picker-radio]]:[border-color:#171717] [&_[data-slot=agent-picker-radio]]:[color:#ffffff] [&_[data-slot=agent-picker-radio]]:[background:#171717]" : ""}`}
                    onClick={() => setSelectedAddIdentityId(identity.id)}
                  >
                    <span data-slot="agent-picker-radio" className={"[display:grid] [width:18px] [height:18px] [place-items:center] [border:2px_solid_#d9d9dd] [border-radius:999px] [color:#ffffff] [background:#ffffff] [transition:background-color_0.12s_ease,_border-color_0.12s_ease]"}>
                      {selected ? <span className={"[width:8px] [height:8px] [border-radius:999px] [background:currentColor]"} /> : null}
                    </span>
                    <AgentAvatar title={identity.name} avatar={resolvedAvatar.avatar} provider={resolvedAvatar.provider} size={32} />
                    <span className={"[min-width:0] [overflow:hidden] [color:#161616] [font-size:14px] [font-weight:650] [text-overflow:ellipsis] [white-space:nowrap]"}>
                      {identity.name}
                    </span>
                  </button>
                );
              })}
              {filteredAddableIdentities.length === 0 ? (
                <div className={"[padding:28px_0] [color:var(--muted)] [font-size:13px] [text-align:center]"}>没有可添加的 Agent</div>
              ) : null}
            </div>
            <div className={"[display:flex] [justify-content:flex-end] [gap:10px] [padding-top:8px]"}>
              <button
                className={"[display:inline-flex] [height:38px] [min-width:84px] [align-items:center] [justify-content:center] [border:1px_solid_#e8e8ea] [border-radius:999px] [padding:0_16px] [font-size:13px] [font-weight:720] [color:#1a1a1a] [background:#ffffff]"}
                onClick={() => setAdding(false)}
              >
                取消
              </button>
              <button
                className={"[display:inline-flex] [height:38px] [min-width:88px] [align-items:center] [justify-content:center] [border:0] [border-radius:999px] [padding:0_16px] [font-size:13px] [font-weight:720] [color:var(--primary-contrast)] [background:var(--primary)] [&:hover:not(:disabled)]:[background:#2a2a2a] [&:disabled]:[color:#ffffff] [&:disabled]:[background:#c9c9ce] [&:disabled]:[cursor:default]"}
                onClick={add}
                disabled={!selectedAddIdentity}
              >
                下一步
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
