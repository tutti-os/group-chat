import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import type {
  AddParticipantRequest,
  CreateIdentityRequest,
  Identity,
  LocalAgentProviderStatus,
  Participant,
  ReasoningEffort,
  RuntimeProfile,
  UpdateParticipantRequest,
} from "@group-chat/shared";
import { DEFAULT_PARTICIPANT_LISTEN_MODE } from "@group-chat/shared";
import { roleDescriptionPresets, reasoningEffortOptions, reasoningModeFieldLabel } from "../../constants.js";
import { isNewAgentDraft } from "../../identity-draft.js";
import {
  getConfiguredIdentityRoleDescription,
  matchRolePresetId,
  normalizeRoleDescriptionForEditor,
} from "../../identity-role.js";
import {
  listCanonicalRuntimeProfiles,
  listRuntimeModels,
  listRuntimeReasoningOptions,
  localAgentStatus,
  preferredRuntimeModelId,
  resolveCanonicalRuntimeProfile,
  runtimeOptionLabel,
} from "../../runtime.js";

export function AgentManageForm(props: {
  mode?: "add" | "edit";
  participant: Participant;
  identity: Identity | null;
  runtimeProfile: RuntimeProfile | null;
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
  showRemove?: boolean;
  readOnly?: boolean;
  avatar: string | null;
  conversationId?: string;
  onDisplayNameChange?: (displayName: string) => void;
  onMention: (participant: Participant) => void;
  onCreateIdentity?: (input: CreateIdentityRequest) => Promise<{ identity: Identity }>;
  onUpdateIdentity?: (
    identityId: string,
    input: CreateIdentityRequest,
  ) => Promise<{ identity: Identity | null }>;
  onAddParticipant?: (
    conversationId: string,
    input: AddParticipantRequest,
  ) => Promise<{ participant: Participant }>;
  onUpdateParticipant: (participantId: string, input: UpdateParticipantRequest) => Promise<unknown>;
  onRemoveParticipant?: (participantId: string) => Promise<unknown>;
  onSaved?: () => void;
  onRemoved?: () => void;
}) {
  const { participant, identity } = props;
  const isAddMode = props.mode === "add";
  const isNewIdentity = isNewAgentDraft(identity);
  const readOnly = props.readOnly ?? false;

  const [displayName, setDisplayName] = useState(participant.displayName);
  const [roomInstructions, setRoomInstructions] = useState(participant.roomInstructions);
  const [runtimeProfileId, setRuntimeProfileId] = useState(
    () => participant.runtimeProfileId ?? identity?.defaultRuntimeProfileId ?? "",
  );
  const [model, setModel] = useState(props.runtimeProfile?.model ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<"" | ReasoningEffort>(
    participant.reasoningEffort ?? identity?.defaultReasoningEffort ?? "",
  );
  const [roleDescription, setRoleDescription] = useState(() => normalizeRoleDescriptionForEditor(identity));
  const [selectedRolePresetId, setSelectedRolePresetId] = useState(() =>
    matchRolePresetId(normalizeRoleDescriptionForEditor(identity)),
  );
  const [showRoomInstructionsEditor, setShowRoomInstructionsEditor] = useState(
    () => Boolean(participant.roomInstructions.trim()),
  );
  const [saving, setSaving] = useState(false);

  const runtimeOptions = useMemo(
    () => listCanonicalRuntimeProfiles(props.runtimeProfiles),
    [props.runtimeProfiles],
  );
  const selectedRuntime =
    props.runtimeProfiles.find((profile) => profile.id === runtimeProfileId)
    ?? props.runtimeProfiles.find((profile) => profile.id === identity?.defaultRuntimeProfileId)
    ?? props.runtimeProfile;
  const canonicalRuntime = resolveCanonicalRuntimeProfile(selectedRuntime ?? null, props.runtimeProfiles);
  const modelOptions = listRuntimeModels(selectedRuntime ?? null, props.localAgentProviders);
  const reasoningOptions = listRuntimeReasoningOptions(
    selectedRuntime ?? null,
    props.localAgentProviders,
    model,
    reasoningEffortOptions,
  );
  const providerStatus = localAgentStatus(selectedRuntime ?? null, props.localAgentProviders);
  const skillIds = identity?.skillIds ?? [];
  const hasRoomInstructions = Boolean(roomInstructions.trim());
  const showRoomInstructions = hasRoomInstructions || (!readOnly && showRoomInstructionsEditor);

  useEffect(() => {
    setDisplayName(participant.displayName);
    setRoomInstructions(participant.roomInstructions);
    setRuntimeProfileId(participant.runtimeProfileId ?? identity?.defaultRuntimeProfileId ?? "");
    setModel(props.runtimeProfile?.model ?? "");
    setReasoningEffort(participant.reasoningEffort ?? identity?.defaultReasoningEffort ?? "");
    const nextRoleDescription = normalizeRoleDescriptionForEditor(identity);
    setRoleDescription(nextRoleDescription);
    setSelectedRolePresetId(matchRolePresetId(nextRoleDescription));
    setShowRoomInstructionsEditor(Boolean(participant.roomInstructions.trim()));
  }, [identity, participant, props.runtimeProfile]);

  useEffect(() => {
    if (!selectedRuntime) return;
    const nextModel = preferredRuntimeModelId(selectedRuntime, props.localAgentProviders);
    setModel(nextModel);
    const nextProvider = localAgentStatus(selectedRuntime, props.localAgentProviders);
    if (nextProvider?.defaultReasoningEffort) {
      setReasoningEffort(nextProvider.defaultReasoningEffort);
    }
  }, [props.localAgentProviders, runtimeProfileId, selectedRuntime]);

  useEffect(() => {
    if (!reasoningOptions.some((option) => option.value === reasoningEffort)) {
      const providerDefault = providerStatus?.defaultReasoningEffort ?? "";
      setReasoningEffort(
        reasoningOptions.some((option) => option.value === providerDefault) ? providerDefault : "",
      );
    }
  }, [model, providerStatus?.defaultReasoningEffort, reasoningEffort, reasoningOptions]);

  const mention = () => {
    props.onMention(participant);
    props.onSaved?.();
  };

  const buildIdentityPayload = (): CreateIdentityRequest => ({
    name: displayName.trim() || identity?.name || "Agent",
    icon: props.avatar ?? identity?.icon ?? "",
    systemPrompt: roleDescription,
    stylePrompt: "",
    defaultRuntimeProfileId: canonicalRuntime?.id ?? (runtimeProfileId || null),
    defaultListenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
    defaultReasoningEffort: reasoningEffort || null,
    model: model || undefined,
  });

  const save = async () => {
    setSaving(true);
    try {
      let activeIdentity = identity;
      const identityPayload = buildIdentityPayload();

      if (isNewIdentity) {
        if (!props.onCreateIdentity) throw new Error("无法创建 Agent，请关闭后重试");
        const result = await props.onCreateIdentity(identityPayload);
        activeIdentity = result.identity;
      } else if (activeIdentity && props.onUpdateIdentity) {
        const identityChanged =
          activeIdentity.name !== identityPayload.name
          || activeIdentity.icon !== identityPayload.icon
          || getConfiguredIdentityRoleDescription(activeIdentity) !== roleDescription
          || activeIdentity.defaultRuntimeProfileId !== identityPayload.defaultRuntimeProfileId
          || (activeIdentity.defaultReasoningEffort ?? null) !== (identityPayload.defaultReasoningEffort ?? null);
        if (identityChanged) {
          const result = await props.onUpdateIdentity(activeIdentity.id, identityPayload);
          activeIdentity = result.identity ?? activeIdentity;
        }
      }

      const participantPayload: UpdateParticipantRequest = {
        displayName,
        avatar: props.avatar,
        listenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
        runtimeProfileId: canonicalRuntime?.id ?? (runtimeProfileId || undefined),
        model: model || undefined,
        reasoningEffort: reasoningEffort || null,
        roomInstructions: roomInstructions.trim(),
      };

      if (isAddMode) {
        if (!props.conversationId || !activeIdentity || !props.onAddParticipant) {
          throw new Error("无法添加 Agent，请关闭后重试");
        }
        const result = await props.onAddParticipant(props.conversationId, {
          identityId: activeIdentity.id,
          runtimeProfileId: canonicalRuntime?.id ?? (runtimeProfileId || null),
          displayName: displayName.trim() || activeIdentity.name,
          listenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
          roomInstructions: roomInstructions.trim(),
          reasoningEffort: reasoningEffort || null,
        });
        await props.onUpdateParticipant(result.participant.id, participantPayload);
      } else {
        await props.onUpdateParticipant(participant.id, participantPayload);
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
          配置完成后保存，将创建 Agent 并加入当前房间。
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
          <select
            value={canonicalRuntime?.id ?? runtimeProfileId}
            disabled={readOnly}
            onChange={(event) => {
              const nextProfile = props.runtimeProfiles.find((profile) => profile.id === event.target.value) ?? null;
              setRuntimeProfileId(event.target.value);
              const nextModel = preferredRuntimeModelId(nextProfile, props.localAgentProviders);
              setModel(nextModel);
              const nextProvider = localAgentStatus(nextProfile, props.localAgentProviders);
              if (nextProvider?.defaultReasoningEffort) {
                setReasoningEffort(nextProvider.defaultReasoningEffort);
              }
            }}
            aria-label={`${participant.displayName} Runtime`}
            className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          >
            {runtimeOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {runtimeOptionLabel(profile, props.localAgentProviders)}
              </option>
            ))}
          </select>
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
            {reasoningOptions.map((option) => (
              <option key={option.value || "auto"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={"[display:grid] [gap:10px]"}>
        <span className={"[color:var(--muted)] [font-size:12px] [font-weight:700]"}>角色设定</span>
        {!readOnly ? (
          <div className={"[display:flex] [flex-wrap:wrap] [gap:8px]"}>
            {roleDescriptionPresets.map((preset) => {
              const selected = selectedRolePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  className={`[border:1px_solid_var(--border)] [border-radius:999px] [padding:6px_12px] [color:#525252] [background:#f7f7f8] [font-size:12px] [font-weight:650] [transition:background-color_0.12s_ease,_border-color_0.12s_ease,_color_0.12s_ease] [&:hover]:[border-color:#17171733] [&:hover]:[color:var(--text)] ${selected ? "![border-color:#171717] ![color:#ffffff] ![background:#171717]" : ""}`}
                  onClick={() => {
                    setSelectedRolePresetId(preset.id);
                    setRoleDescription(preset.description);
                  }}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>
        ) : null}
        <textarea
          value={roleDescription}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          onChange={(event) => {
            if (readOnly) return;
            const nextValue = event.target.value;
            setSelectedRolePresetId(matchRolePresetId(nextValue));
            setRoleDescription(nextValue);
          }}
          className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          placeholder="描述该 Agent 在此群中的职责、风格与边界"
          aria-label={`${participant.displayName} 角色设定`}
        />
      </div>

      {showRoomInstructions ? (
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
            placeholder="写一段展示给其他人看的介绍（可选）"
            aria-label={`${participant.displayName} 在此群的描述`}
          />
        </label>
      ) : !readOnly ? (
        <button
          type="button"
          className={"[justify-self:start] [border:0] [padding:0] [color:var(--muted)] [background:transparent] [font-size:12px] [font-weight:650] [text-decoration:underline] [text-underline-offset:3px] [&:hover]:[color:var(--text)]"}
          onClick={() => setShowRoomInstructionsEditor(true)}
        >
          添加在此群的描述（可选）
        </button>
      ) : null}

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
