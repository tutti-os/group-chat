import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type {
  AddParticipantRequest,
  Identity,
  LocalAgentProviderStatus,
  Participant,
  ReasoningEffort,
  RuntimeProfile,
  UpdateParticipantRequest,
} from "@group-chat/shared";
import { DEFAULT_PARTICIPANT_LISTEN_MODE } from "@group-chat/shared";
import { getIdentityRoleLabel } from "../../identity-role.js";
import { reasoningEffortOptions, reasoningModeFieldLabel } from "../../constants.js";
import { listRuntimeModels } from "../../runtime.js";

export function AgentManageForm(props: {
  mode?: "add" | "edit";
  participant: Participant;
  identity: Identity | null;
  runtimeProfile: RuntimeProfile | null;
  localAgentProviders: LocalAgentProviderStatus[];
  showRemove?: boolean;
  readOnly?: boolean;
  avatar: string | null;
  conversationId?: string;
  onDisplayNameChange?: (displayName: string) => void;
  onMention: (participant: Participant) => void;
  onAddParticipant?: (
    conversationId: string,
    input: AddParticipantRequest,
  ) => Promise<{ participant: Participant }>;
  onUpdateParticipant: (participantId: string, input: UpdateParticipantRequest) => Promise<unknown>;
  onRemoveParticipant?: (participantId: string) => Promise<unknown>;
  onSaved?: () => void;
  onRemoved?: () => void;
}) {
  const { participant, identity, runtimeProfile } = props;
  const isAddMode = props.mode === "add";
  const [displayName, setDisplayName] = useState(participant.displayName);
  const [roomInstructions, setRoomInstructions] = useState(participant.roomInstructions);
  const [model, setModel] = useState(runtimeProfile?.model ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<"" | ReasoningEffort>(participant.reasoningEffort ?? "");
  const [saving, setSaving] = useState(false);

  const skillIds = identity?.skillIds ?? [];
  const modelOptions = listRuntimeModels(runtimeProfile, props.localAgentProviders);
  const readOnly = props.readOnly ?? false;
  const globalRoleLabel = getIdentityRoleLabel(identity);

  useEffect(() => {
    setDisplayName(participant.displayName);
    setModel(runtimeProfile?.model ?? "");
    setReasoningEffort(participant.reasoningEffort ?? "");
    setRoomInstructions(participant.roomInstructions);
  }, [identity, participant, runtimeProfile]);

  const mention = () => {
    props.onMention(participant);
    props.onSaved?.();
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: UpdateParticipantRequest = {
        displayName,
        avatar: props.avatar,
        listenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
        model: model || undefined,
        reasoningEffort: reasoningEffort || null,
        roomInstructions: roomInstructions.trim(),
      };

      if (isAddMode) {
        if (!props.conversationId || !identity || !props.onAddParticipant) {
          throw new Error("无法添加 Agent，请关闭后重试");
        }
        const result = await props.onAddParticipant(props.conversationId, {
          identityId: identity.id,
          displayName: displayName.trim() || identity.name,
          listenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
          roomInstructions: roomInstructions.trim(),
          reasoningEffort: reasoningEffort || null,
        });
        await props.onUpdateParticipant(result.participant.id, payload);
      } else {
        await props.onUpdateParticipant(participant.id, payload);
      }
      props.onSaved?.();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={"[display:grid] [gap:20px] [&_input]:[height:34px] [&_input]:[width:100%] [&_input]:[min-width:0] [&_input]:[border:1px_solid_var(--border)] [&_input]:[border-radius:12px] [&_input]:[padding:0_10px] [&_input]:[font-size:13px] [&_input]:[outline:none] [&_select]:[height:34px] [&_select]:[width:100%] [&_select]:[min-width:0] [&_select]:[border:1px_solid_var(--border)] [&_select]:[border-radius:12px] [&_select]:[padding:0_10px] [&_select]:[font-size:13px] [&_select]:[outline:none] [&_textarea]:[width:100%] [&_textarea]:[min-height:88px] [&_textarea]:[border:1px_solid_var(--border)] [&_textarea]:[border-radius:12px] [&_textarea]:[padding:10px] [&_textarea]:[font-size:13px] [&_textarea]:[line-height:1.5] [&_textarea]:[outline:none] [&_textarea]:[resize:vertical] [&_label]:[display:grid] [&_label]:[gap:8px] [&_label_span]:[color:var(--muted)] [&_label_span]:[font-size:12px] [&_label_span]:[font-weight:700]"}>
      {!readOnly && isAddMode ? (
        <p className={"[margin:0] [border:1px_solid_var(--border)] [border-radius:12px] [padding:10px_12px] [color:var(--muted)] [background:#f7f7f8] [font-size:12px] [line-height:1.5]"}>
          保存后才会将此 Agent 加入当前房间。
        </p>
      ) : null}
      {readOnly && !isAddMode ? (
        <p className={"[margin:0] [border:1px_solid_var(--border)] [border-radius:12px] [padding:10px_12px] [color:var(--muted)] [background:#f7f7f8] [font-size:12px] [line-height:1.5]"}>
          该 Agent 已从此群移出，以下信息仅供查看。
        </p>
      ) : null}
      <label>
        <span>在房间里的别名</span>
        <input
          value={displayName}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          onChange={(event) => {
            if (readOnly) return;
            setDisplayName(event.target.value);
            props.onDisplayNameChange?.(event.target.value);
          }}
          className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          aria-label={`${participant.displayName} 在房间里的别名`}
        />
      </label>

      <div className={"[display:grid] [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:10px] max-[520px]:[grid-template-columns:1fr]"}>
        <label>
          <span>Runtime</span>
          <input
            value={runtimeProfile?.displayName ?? "未配置"}
            readOnly
            aria-readonly
            className={"[color:var(--muted)] [background:#f3f4f6] [cursor:default]"}
          />
        </label>
        <label>
          <span>模型</span>
          {modelOptions.length ? (
            <select
              value={model}
              disabled={readOnly}
              onChange={(event) => setModel(event.target.value)}
              aria-label={`${participant.displayName} 模型`}
              className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
            >
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input value={model || "未配置"} readOnly aria-readonly />
          )}
        </label>
        <label>
          <span>{reasoningModeFieldLabel(reasoningEffort)}</span>
          <select
            value={reasoningEffort}
            disabled={readOnly}
            onChange={(event) => setReasoningEffort(event.target.value as "" | ReasoningEffort)}
            aria-label={`${participant.displayName} 推理模式`}
            className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          >
            {reasoningEffortOptions.map((option) => (
              <option key={option.value || "auto"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {globalRoleLabel ? (
        <label>
          <span>角色设定（来自全局 Agent 配置，如需修改请前往「管理智能体」。）</span>
          <input
            value={globalRoleLabel}
            readOnly
            aria-readonly
            className={"[color:var(--muted)] [background:#f3f4f6] [cursor:default]"}
            aria-label={`${participant.displayName} 角色设定`}
          />
        </label>
      ) : null}

      <label>
        <span>在此群的描述</span>
        <textarea
          value={roomInstructions}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          onChange={(event) => {
            if (readOnly) return;
            setRoomInstructions(event.target.value);
          }}
          className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          placeholder={globalRoleLabel ? "留空则使用全局角色设定" : "为本群单独设置描述（可选）"}
          aria-label={`${participant.displayName} 在此群的描述`}
        />
      </label>

      <div className={"[display:grid] [gap:8px]"}>
        <span className={"[color:var(--muted)] [font-size:12px] [font-weight:700]"}>Skills</span>
        {skillIds.length ? (
          <div className={"[display:flex] [flex-wrap:wrap] [gap:6px]"}>
            {skillIds.map((skillId) => (
              readOnly ? (
                <span
                  key={skillId}
                  className={"[border:1px_solid_var(--border)] [border-radius:999px] [padding:4px_10px] [color:var(--muted)] [background:#f3f4f6] [font-size:11px] [font-weight:650]"}
                >
                  {skillId}
                </span>
              ) : (
                <button
                  key={skillId}
                  type="button"
                  className={"[border:1px_solid_var(--border)] [border-radius:999px] [padding:4px_10px] [color:var(--text)] [background:#f7f7f8] [font-size:11px] [font-weight:650] [&:hover]:[background:#eceef1]"}
                  title={`点击后 @${participant.displayName}`}
                  onClick={mention}
                >
                  {skillId}
                </button>
              )
            ))}
          </div>
        ) : (
          <span className={"[color:var(--muted)] [font-size:12px]"}>暂无 Skills</span>
        )}
      </div>

      {!readOnly ? (
        <div className={"[display:flex] [flex-wrap:wrap] [justify-content:space-between] [gap:8px] [padding-top:10px] [margin-top:4px]"}>
          <div className={"[display:flex] [flex-wrap:wrap] [gap:6px]"}>
            {props.showRemove && props.onRemoveParticipant ? (
              <button
                type="button"
                className={"[display:inline-flex] [height:32px] [align-items:center] [border:0] [border-radius:10px] [padding:0_12px] [color:var(--danger)] [background:#fde8e7] [font-size:12px] [font-weight:650]"}
                onClick={() => {
                  if (!window.confirm(`确定将 ${participant.displayName} 移出此群吗？`)) return;
                  void props.onRemoveParticipant!(participant.id).then(() => props.onRemoved?.());
                }}
              >
                移除
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={"[display:inline-flex] [height:32px] [align-items:center] [gap:5px] [border:0] [border-radius:10px] [padding:0_14px] [color:#ffffff] [background:var(--primary)] [font-size:12px] [font-weight:650] [&:disabled]:[opacity:0.5]"}
            disabled={saving || !displayName.trim()}
            onClick={() => void save()}
          >
            <Check size={14} />
            {saving ? "保存中..." : isAddMode ? "添加到群聊" : "保存"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
