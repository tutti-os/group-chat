import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { Conversation, CreateIdentityRequest, Identity, LocalAgentProviderStatus, Participant, Room, RuntimeProfile } from "@group-chat/shared";
import { DEFAULT_PARTICIPANT_LISTEN_MODE } from "@group-chat/shared";
import { createIdentity, deleteIdentity } from "../../../api/client.js";
import { countIdentityActiveRooms } from "../../identity-usage.js";
import { resolveAgentAvatar } from "../../identity-avatar.js";
import { defaultIdentityNameForRuntime, preferredDefaultRuntimeProfile, resolveCanonicalRuntimeProfile, runtimeStatusSummary } from "../../runtime.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";
import { IdentityEditor } from "./IdentityEditor.js";

export function TeamMembersPage(props: {
  identities: Identity[];
  participants: Participant[];
  conversations: Conversation[];
  rooms: Room[];
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
  onCreateIdentity: (input: CreateIdentityRequest) => Promise<{ identity: Identity }>;
  onUpdateIdentity: (identityId: string, input: CreateIdentityRequest) => Promise<{ identity: Identity | null }>;
  onDeleteIdentity: typeof deleteIdentity;
  onOpenConversation?: (conversationId: string) => void;
  focusIdentityId?: string | null;
  selectedIdentityId?: string | null;
  onSelectedIdentityIdChange?: (identityId: string | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(props.selectedIdentityId ?? null);
  const [creatingLocalAgent, setCreatingLocalAgent] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const selected = props.identities.find((identity) => identity.id === selectedId) ?? null;
  const visibleIdentities = props.identities;
  const draftLocalAgent = creatingLocalAgent
    ? createDraftLocalAgent(props.runtimeProfiles, props.localAgentProviders)
    : null;

  const selectIdentity = (identityId: string | null) => {
    setSelectedId(identityId);
    props.onSelectedIdentityIdChange?.(identityId);
  };

  useEffect(() => {
    if (props.selectedIdentityId === undefined) return;
    setSelectedId(props.selectedIdentityId);
  }, [props.selectedIdentityId]);

  useEffect(() => {
    if (!props.focusIdentityId) return;
    if (!props.identities.some((identity) => identity.id === props.focusIdentityId)) return;
    selectIdentity(props.focusIdentityId);
    setCreatingLocalAgent(false);
  }, [props.focusIdentityId, props.identities]);

  useEffect(() => {
    if (selectedId && !props.identities.some((identity) => identity.id === selectedId)) {
      selectIdentity(null);
    }
  }, [props.identities, selectedId]);

  const startCreateLocalAgent = () => {
    const localRuntime = props.runtimeProfiles.find((profile) => profile.kind === "local-agent");
    if (!localRuntime) return;
    selectIdentity(null);
    setCreatingLocalAgent(true);
  };

  const clearDetailPanel = () => {
    selectIdentity(null);
    setCreatingLocalAgent(false);
  };

  const remove = async (identity: Identity) => {
    if (deletingId) return;
    setDeletingId(identity.id);
    try {
      await props.onDeleteIdentity(identity.id);
      if (selectedId === identity.id) selectIdentity(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法删除 Agent");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className={"[grid-column:2_/_5] [min-width:0] [min-height:0] [background:var(--panel)] [display:grid] [grid-template-columns:minmax(300px,_320px)_minmax(0,_1fr)] [overflow:hidden] max-[760px]:[grid-column:1] max-[760px]:[grid-template-columns:1fr]"}>
      <section className={"[background:var(--panel)] [display:grid] [height:100vh] [min-width:0] [grid-template-rows:auto_minmax(0,_1fr)] [overflow:hidden] [border-right:1px_solid_var(--border)] max-[760px]:[display:none]"}>
        <div className={"[&_h2]:[margin:0] [&_h2]:[color:var(--text)] [&_h2]:[font-size:16px] [&_h2]:[font-weight:650] [&_h2]:[line-height:1.2] [&_h2]:[letter-spacing:0] [&_p]:[color:var(--muted)] [&_p]:[font-size:12px] [display:flex] [min-height:56px] [align-items:center] [justify-content:space-between] [gap:16px] [padding:12px_14px_10px_16px] [border-bottom:1px_solid_var(--border)] [&_p]:[display:none] [&_p]:[margin:3px_0_0]"}>
          <div>
            <h2>管理智能体</h2>
            <p>可加入任意房间的本地 Agent 身份。</p>
          </div>
          <div className={"[display:flex] [align-items:center] [gap:6px]"}>
            <button
              className={"[display:inline-grid] [place-items:center] [border:0] [width:34px] [height:34px] [border-radius:12px] [color:var(--primary-contrast)] [background:var(--primary)] [box-shadow:0_6px_16px_rgb(0_0_0_/_14%)] [transition:background-color_0.12s_ease,_transform_0.12s_ease,_box-shadow_0.12s_ease] [&:hover]:[background:#2563eb] [&:hover]:[box-shadow:0_8px_20px_rgb(37_99_235_/_28%)] [&:hover]:[transform:translateY(-1px)]"}
              title="添加智能体"
              aria-label="添加智能体"
              onClick={startCreateLocalAgent}
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <div className={"[display:flex] [min-width:0] [width:100%] [flex-direction:column] [gap:4px] [overflow-x:hidden] [overflow-y:auto] [padding:8px]"}>
          <div className={"[display:flex] [align-items:center] [justify-content:space-between] [min-height:34px] [padding:6px_10px_4px] [color:var(--muted)] [font-size:12px] [font-weight:650]"}>
            <span>Agent 身份库</span>
          </div>
          {visibleIdentities.length === 0 ? (
            <div className={"[display:grid] [gap:10px] [margin:8px_4px] [border:1px_dashed_var(--border)] [border-radius:10px] [padding:24px_14px] [color:var(--muted)] [background:#ffffff99] [font-size:12px] [line-height:1.5] [text-align:center] [&_strong]:[color:var(--text)] [&_strong]:[font-size:14px] [&_button]:[justify-self:center] [&_button]:[height:34px] [&_button]:[border:0] [&_button]:[border-radius:6px] [&_button]:[padding:0_12px] [&_button]:[color:#ffffff] [&_button]:[background:var(--primary)] [&_button]:[font-size:12px] [&_button]:[font-weight:650]"}>
              <strong>创建第一个 Agent</strong>
              <span>推荐从产品、设计、开发三个模板开始，之后可加入任意房间。</span>
              <button type="button" onClick={startCreateLocalAgent}>
                创建 Agent
              </button>
            </div>
          ) : null}
          {visibleIdentities.map((identity) => {
            const runtime = props.runtimeProfiles.find((profile) => profile.id === identity.defaultRuntimeProfileId) ?? null;
            const inUseCount = countIdentityActiveRooms(identity.id, props.participants, props.conversations);
            const active = identity.id === selected?.id && !creatingLocalAgent;
            const resolvedAvatar = resolveAgentAvatar({ icon: identity.icon, runtimeProfile: runtime });
            return (
              <div
                key={identity.id}
                role="button"
                tabIndex={0}
                className={`[display:flex] [box-sizing:border-box] [width:100%] [height:58px] [min-height:58px] [align-items:center] [gap:10px] [border:0] [border-radius:14px] [padding:12px_8px] [cursor:pointer] [text-align:left] [color:var(--text)] [background:transparent] [font-size:13px] [&:hover]:[background:var(--sidebar-hover)] [&_strong]:[display:block] [&_strong]:[overflow:hidden] [&_strong]:[text-overflow:ellipsis] [&_strong]:[white-space:nowrap] [&_small]:[display:block] [&_small]:[overflow:hidden] [&_small]:[text-overflow:ellipsis] [&_small]:[white-space:nowrap] [&_small]:[color:var(--muted)] [&_small]:[font-size:12px] [&_small]:[line-height:1.35] [&_strong]:[font-size:15px] [&_strong]:[font-weight:650] [&_strong]:[line-height:1.25] ${active ? "[background:var(--accent-soft)]" : ""}`}
                onClick={() => {
                  setCreatingLocalAgent(false);
                  selectIdentity(identity.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setCreatingLocalAgent(false);
                  selectIdentity(identity.id);
                }}
              >
                <span className={"[display:grid] [width:34px] [height:34px] [flex-shrink:0] [place-items:center]"}>
                  <AgentAvatar title={identity.name} avatar={resolvedAvatar.avatar} provider={resolvedAvatar.provider} size={34} />
                </span>
                <span className={"[min-width:0] [flex:1_1_auto] [overflow:hidden]"}>
                  <strong>{identity.name}</strong>
                  <small>
                    {[runtime?.displayName ?? "未选择运行时", runtimeStatusSummary(runtime ?? null, props.localAgentProviders)]
                      .filter(Boolean)
                      .join(" · ")}
                    {inUseCount > 0 ? ` · ${inUseCount} 个房间` : ""}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className={"[display:grid] [min-width:0] [min-height:0] [height:100vh] [overflow:hidden] [background:var(--panel)]"}>
        {draftLocalAgent ? (
          <IdentityEditor
            key={`${draftLocalAgent.id}:${draftLocalAgent.defaultRuntimeProfileId}:${props.localAgentProviders.length}`}
            embedded
            identity={draftLocalAgent}
            inUseCount={0}
            participants={props.participants}
            conversations={props.conversations}
            rooms={props.rooms}
            runtimeProfiles={props.runtimeProfiles}
            localAgentProviders={props.localAgentProviders}
            isNew
            onClose={clearDetailPanel}
            onSave={async (input) => {
              const result = (await props.onCreateIdentity(input)) as { identity: Identity };
              setCreatingLocalAgent(false);
              selectIdentity(result.identity.id);
            }}
          />
        ) : selected ? (
          <IdentityEditor
            key={`${selected.id}:${selected.updatedAt}`}
            embedded
            identity={selected}
            inUseCount={countIdentityActiveRooms(selected.id, props.participants, props.conversations)}
            participants={props.participants}
            conversations={props.conversations}
            rooms={props.rooms}
            runtimeProfiles={props.runtimeProfiles}
            localAgentProviders={props.localAgentProviders}
            onClose={clearDetailPanel}
            onOpenConversation={props.onOpenConversation}
            onSave={(updates) => props.onUpdateIdentity(selected.id, updates)}
            onDelete={() => remove(selected)}
            deleting={deletingId === selected.id}
          />
        ) : (
          <div className={"[display:grid] [height:100%] [place-items:center] [padding:24px]"}>
            <div className={"[display:grid] [gap:14px] [justify-items:center] [max-width:320px] [text-align:center]"}>
              <p className={"[margin:0] [color:var(--muted)] [font-size:13px] [line-height:1.55]"}>
                选择左侧 Agent 查看和编辑配置，或创建一个新的智能体身份。
              </p>
              <button
                className={"[display:inline-flex] [min-width:178px] [height:48px] [align-items:center] [justify-content:center] [gap:10px] [border:1px_solid_var(--border-strong)] [border-radius:16px] [color:var(--text)] [background:#ffffff] [font-size:14px] [font-weight:650] [box-shadow:var(--shadow-soft)] [&:hover]:[background:#f7f7f8] [&_span]:[display:inline-grid] [&_span]:[width:28px] [&_span]:[height:28px] [&_span]:[place-items:center] [&_span]:[border-radius:999px] [&_span]:[color:var(--primary-contrast)] [&_span]:[background:var(--primary)]"}
                type="button"
                onClick={startCreateLocalAgent}
              >
                <span>
                  <Plus size={22} />
                </span>
                <strong>添加智能体</strong>
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function createDraftLocalAgent(
  runtimeProfiles: RuntimeProfile[],
  localAgentProviders: LocalAgentProviderStatus[],
): Identity {
  const localRuntime = preferredDefaultRuntimeProfile(runtimeProfiles);
  const canonicalRuntime = resolveCanonicalRuntimeProfile(localRuntime, runtimeProfiles);
  return {
    id: "__new-local-agent__",
    name: defaultIdentityNameForRuntime(canonicalRuntime, localAgentProviders),
    icon: "",
    systemPrompt: "",
    stylePrompt: "",
    defaultRuntimeProfileId: canonicalRuntime?.id ?? runtimeProfiles[0]?.id ?? null,
    defaultListenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
    defaultReasoningEffort: null,
    temperature: 0.7,
    skillIds: [],
    toolAccessPolicy: { mode: "read-only", allowedToolIds: [] },
    createdAt: "",
    updatedAt: "",
  };
}
