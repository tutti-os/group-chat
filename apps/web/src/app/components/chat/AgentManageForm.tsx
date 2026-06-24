import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
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
import {
  DEFAULT_PARTICIPANT_LISTEN_MODE,
  normalizeParticipantDisplayName,
  participantDisplayNameUnits,
  truncateParticipantDisplayName,
  uniqueParticipantDisplayNameInRoom,
} from "@group-chat/shared";
import { roleDescriptionPresetLabel, roleDescriptionPresets, getReasoningEffortOptions, reasoningModeFieldLabel } from "../../constants.js";
import { useTranslation } from "../../i18n/index.js";
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
  listRuntimeSpeedOptions,
  localAgentStatus,
  normalizeRuntimeModelId,
  preferredRuntimeModelId,
  resolveRuntimeSpeedMode,
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
  roomParticipants?: Participant[];
  onDisplayNameChange?: (displayName: string) => void;
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
  const { t } = useTranslation();
  const { participant, identity } = props;
  const isAddMode = props.mode === "add";
  const isNewIdentity = isNewAgentDraft(identity);
  const readOnly = props.readOnly ?? false;

  const [displayName, setDisplayName] = useState(() => normalizeParticipantDisplayName(participant.displayName));
  const [roomInstructions, setRoomInstructions] = useState(participant.roomInstructions);
  const [runtimeProfileId, setRuntimeProfileId] = useState(
    () => participant.runtimeProfileId ?? identity?.defaultRuntimeProfileId ?? "",
  );
  const [model, setModel] = useState(() => normalizeRuntimeModelId(props.runtimeProfile, props.runtimeProfile?.model));
  const [reasoningEffort, setReasoningEffort] = useState<"" | ReasoningEffort>(
    participant.reasoningEffort ?? identity?.defaultReasoningEffort ?? "",
  );
  const [speedMode, setSpeedMode] = useState(() => participant.speedMode ?? identity?.defaultSpeedMode ?? "");
  const [roleDescription, setRoleDescription] = useState(() => normalizeRoleDescriptionForEditor(identity));
  const [selectedRolePresetId, setSelectedRolePresetId] = useState(() =>
    matchRolePresetId(normalizeRoleDescriptionForEditor(identity)),
  );
  const [showRoomInstructionsEditor, setShowRoomInstructionsEditor] = useState(
    () => Boolean(participant.roomInstructions.trim()),
  );
  const [saving, setSaving] = useState(false);
  const [openSelectId, setOpenSelectId] = useState<string | null>(null);

  const runtimeOptions = useMemo(
    () => listCanonicalRuntimeProfiles(props.runtimeProfiles),
    [props.runtimeProfiles],
  );
  const selectedRuntime =
    props.runtimeProfiles.find((profile) => profile.id === runtimeProfileId)
    ?? (props.runtimeProfile?.id === runtimeProfileId ? props.runtimeProfile : null)
    ?? props.runtimeProfiles.find((profile) => profile.id === identity?.defaultRuntimeProfileId)
    ?? props.runtimeProfile;
  const canonicalRuntime = resolveCanonicalRuntimeProfile(selectedRuntime ?? null, props.runtimeProfiles);
  const listedModelOptions = listRuntimeModels(selectedRuntime ?? null, props.localAgentProviders);
  const normalizedModel = normalizeRuntimeModelId(selectedRuntime ?? null, model);
  const modelOptions =
    normalizedModel && !listedModelOptions.some((option) => option.id === normalizedModel)
      ? [{ id: normalizedModel, label: normalizedModel }, ...listedModelOptions]
      : listedModelOptions;
  const reasoningOptions = listRuntimeReasoningOptions(
    selectedRuntime ?? null,
    props.localAgentProviders,
    normalizedModel,
    getReasoningEffortOptions(),
  );
  const providerStatus = localAgentStatus(selectedRuntime ?? null, props.localAgentProviders);
  const speedOptions = listRuntimeSpeedOptions(selectedRuntime ?? null, props.localAgentProviders);
  const selectedSpeed = resolveRuntimeSpeedMode(selectedRuntime ?? null, props.localAgentProviders, speedMode);
  const hasRoomInstructions = Boolean(roomInstructions.trim());
  const showRoomInstructions = hasRoomInstructions || (!readOnly && showRoomInstructionsEditor);

  useEffect(() => {
    setDisplayName(normalizeParticipantDisplayName(participant.displayName));
    setRoomInstructions(participant.roomInstructions);
    setRuntimeProfileId(participant.runtimeProfileId ?? identity?.defaultRuntimeProfileId ?? "");
    setModel(normalizeRuntimeModelId(props.runtimeProfile, props.runtimeProfile?.model));
    setReasoningEffort(participant.reasoningEffort ?? identity?.defaultReasoningEffort ?? "");
    setSpeedMode(participant.speedMode ?? identity?.defaultSpeedMode ?? "");
    const nextRoleDescription = normalizeRoleDescriptionForEditor(identity);
    setRoleDescription(nextRoleDescription);
    setSelectedRolePresetId(matchRolePresetId(nextRoleDescription));
    setShowRoomInstructionsEditor(Boolean(participant.roomInstructions.trim()));
  }, [identity, participant, props.runtimeProfile]);

  useEffect(() => {
    if (!selectedRuntime) return;
    if (model) return;
    const nextModel = preferredRuntimeModelId(selectedRuntime, props.localAgentProviders);
    if (!nextModel) return;
    setModel(nextModel);
    const nextProvider = localAgentStatus(selectedRuntime, props.localAgentProviders);
    if (nextProvider?.defaultReasoningEffort) {
      setReasoningEffort(nextProvider.defaultReasoningEffort);
    }
  }, [model, props.localAgentProviders, selectedRuntime]);

  useEffect(() => {
    if (!reasoningOptions.some((option) => option.value === reasoningEffort)) {
      const providerDefault = providerStatus?.defaultReasoningEffort ?? "";
      setReasoningEffort(
        reasoningOptions.some((option) => option.value === providerDefault) ? providerDefault : "",
      );
    }
  }, [normalizedModel, providerStatus?.defaultReasoningEffort, reasoningEffort, reasoningOptions]);

  useEffect(() => {
    if (speedMode !== selectedSpeed) setSpeedMode(selectedSpeed);
  }, [selectedSpeed, speedMode]);

  const buildIdentityPayload = (): CreateIdentityRequest => ({
    name: normalizeParticipantDisplayName(displayName, identity?.name || t("common.agent")),
    icon: props.avatar ?? identity?.icon ?? "",
    systemPrompt: roleDescription,
    stylePrompt: "",
    defaultRuntimeProfileId: canonicalRuntime?.id ?? (runtimeProfileId || null),
    defaultListenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
    defaultReasoningEffort: reasoningEffort || null,
    defaultSpeedMode: selectedSpeed || null,
    model: normalizedModel || undefined,
  });

  const save = async () => {
    setSaving(true);
    try {
      let activeIdentity = identity;
      const baseDisplayName = normalizeParticipantDisplayName(displayName, identity?.name || t("common.agent"));
      const resolvedDisplayName = isAddMode && props.roomParticipants
        ? uniqueParticipantDisplayNameInRoom(
          baseDisplayName,
          props.roomParticipants,
        )
        : baseDisplayName;
      const identityPayload = {
        ...buildIdentityPayload(),
        name: resolvedDisplayName,
      };

      if (isNewIdentity) {
        if (!props.onCreateIdentity) throw new Error(t("agentForm.createFailed"));
        const result = await props.onCreateIdentity(identityPayload);
        activeIdentity = result.identity;
      } else if (activeIdentity && props.onUpdateIdentity) {
        const identityChanged =
          activeIdentity.name !== identityPayload.name
          || activeIdentity.icon !== identityPayload.icon
          || getConfiguredIdentityRoleDescription(activeIdentity) !== roleDescription
          || activeIdentity.defaultRuntimeProfileId !== identityPayload.defaultRuntimeProfileId
          || (activeIdentity.defaultReasoningEffort ?? null) !== (identityPayload.defaultReasoningEffort ?? null)
          || (activeIdentity.defaultSpeedMode ?? null) !== (identityPayload.defaultSpeedMode ?? null);
        if (identityChanged) {
          const result = await props.onUpdateIdentity(activeIdentity.id, identityPayload);
          activeIdentity = result.identity ?? activeIdentity;
        }
      }

      const participantPayload: UpdateParticipantRequest = {
        displayName: resolvedDisplayName,
        avatar: props.avatar,
        listenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
        runtimeProfileId: canonicalRuntime?.id ?? (runtimeProfileId || undefined),
        model: normalizedModel || undefined,
        reasoningEffort: reasoningEffort || null,
        speedMode: selectedSpeed || null,
        roomInstructions: roomInstructions.trim(),
      };

      if (isAddMode) {
        if (!props.conversationId || !activeIdentity || !props.onAddParticipant) {
          throw new Error(t("agentForm.addFailed"));
        }
        const result = await props.onAddParticipant(props.conversationId, {
          identityId: activeIdentity.id,
          runtimeProfileId: canonicalRuntime?.id ?? (runtimeProfileId || null),
          displayName: resolvedDisplayName,
          listenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
          roomInstructions: roomInstructions.trim(),
          reasoningEffort: reasoningEffort || null,
          speedMode: selectedSpeed || null,
        });
        await props.onUpdateParticipant(result.participant.id, participantPayload);
      } else {
        await props.onUpdateParticipant(participant.id, participantPayload);
      }
      props.onSaved?.();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("agentForm.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={"[display:grid] [gap:20px] [&_input]:[height:34px] [&_input]:[width:100%] [&_input]:[min-width:0] [&_input]:[border:1px_solid_var(--border)] [&_input]:[border-radius:12px] [&_input]:[padding:0_10px] [&_input]:[font-size:13px] [&_input]:[outline:none] [&_select]:[height:34px] [&_select]:[width:100%] [&_select]:[min-width:0] [&_select]:[border:1px_solid_var(--border)] [&_select]:[border-radius:12px] [&_select]:[padding:0_10px] [&_select]:[font-size:13px] [&_select]:[outline:none] [&_textarea]:[width:100%] [&_textarea]:[min-height:88px] [&_textarea]:[border:1px_solid_var(--border)] [&_textarea]:[border-radius:12px] [&_textarea]:[padding:10px] [&_textarea]:[font-size:13px] [&_textarea]:[line-height:1.5] [&_textarea]:[outline:none] [&_textarea]:[resize:vertical] [&_label]:[display:grid] [&_label]:[gap:8px] [&_label_span]:[color:var(--muted)] [&_label_span]:[font-size:12px] [&_label_span]:[font-weight:700]"}>
      {!readOnly && isAddMode ? (
        <p className={"[margin:0] [border:1px_solid_var(--border)] [border-radius:12px] [padding:10px_12px] [color:var(--muted)] [background:#f7f7f8] [font-size:12px] [line-height:1.5]"}>
          {t("agentForm.addHint")}
        </p>
      ) : null}
      {readOnly && !isAddMode ? (
        <p className={"[margin:0] [border:1px_solid_var(--border)] [border-radius:12px] [padding:10px_12px] [color:var(--muted)] [background:#f7f7f8] [font-size:12px] [line-height:1.5]"}>
          {t("agentForm.removedHint")}
        </p>
      ) : null}
      <label>
        <span>{t("agentForm.roomAlias")}</span>
        <input
          value={displayName}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          onChange={(event) => {
            if (readOnly) return;
            const nextValue = truncateParticipantDisplayName(event.target.value, undefined, { trimTrailing: false });
            setDisplayName(nextValue);
            props.onDisplayNameChange?.(nextValue);
          }}
          maxLength={20}
          className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          aria-label={t("agentForm.roomAliasAria", { name: participant.displayName })}
        />
        <small className={"[color:var(--muted)] [font-size:11px] [line-height:1.4]"}>
          {t("agentForm.roomAliasLimit", { used: participantDisplayNameUnits(displayName) })}
        </small>
      </label>

      <div className={"[display:grid] [grid-template-columns:repeat(4,_minmax(0,_1fr))] [gap:10px] max-[760px]:[grid-template-columns:repeat(2,_minmax(0,_1fr))] max-[520px]:[grid-template-columns:1fr]"}>
        <label>
          <span>Runtime</span>
          <AgentSelect
            id="runtime"
            value={canonicalRuntime?.id ?? runtimeProfileId}
            disabled={readOnly}
            ariaLabel={`${participant.displayName} Runtime`}
            open={openSelectId === "runtime"}
            onOpenChange={(open) => setOpenSelectId(open ? "runtime" : null)}
            options={runtimeOptions.map((profile) => ({
              value: profile.id,
              label: runtimeOptionLabel(profile, props.localAgentProviders),
            }))}
            onChange={(value) => {
              const nextProfile = props.runtimeProfiles.find((profile) => profile.id === value) ?? null;
              setRuntimeProfileId(value);
              const nextModel = preferredRuntimeModelId(nextProfile, props.localAgentProviders);
              setModel(nextModel);
              const nextProvider = localAgentStatus(nextProfile, props.localAgentProviders);
              if (nextProvider?.defaultReasoningEffort) {
                setReasoningEffort(nextProvider.defaultReasoningEffort);
              }
              setSpeedMode(resolveRuntimeSpeedMode(nextProfile, props.localAgentProviders, ""));
            }}
            className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          />
        </label>
        <label>
          <span>{t("agentForm.model")}</span>
          {modelOptions.length ? (
            <AgentSelect
              id="model"
              value={normalizedModel}
              disabled={readOnly}
              onChange={setModel}
              ariaLabel={t("agentForm.modelAria", { name: participant.displayName })}
              open={openSelectId === "model"}
              onOpenChange={(open) => setOpenSelectId(open ? "model" : null)}
              options={modelOptions.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
            />
          ) : (
            <input value={model || t("common.notConfigured")} readOnly aria-readonly />
          )}
        </label>
        <label>
          <span>{reasoningModeFieldLabel(reasoningEffort)}</span>
          <AgentSelect
            id="reasoning"
            value={reasoningEffort}
            disabled={readOnly}
            onChange={(value) => setReasoningEffort(value as "" | ReasoningEffort)}
            ariaLabel={t("agentForm.reasoningAria", { name: participant.displayName })}
            open={openSelectId === "reasoning"}
            onOpenChange={(open) => setOpenSelectId(open ? "reasoning" : null)}
            options={reasoningOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          />
        </label>
        <label>
          <span>{t("agentForm.speed")}</span>
          <AgentSelect
            id="speed"
            value={selectedSpeed}
            disabled={readOnly}
            onChange={setSpeedMode}
            ariaLabel={t("agentForm.speedAria", { name: participant.displayName })}
            open={openSelectId === "speed"}
            onOpenChange={(open) => setOpenSelectId(open ? "speed" : null)}
            options={speedOptions.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
          />
        </label>
      </div>

      <div className={"[display:grid] [gap:10px]"}>
        <span className={"[color:var(--muted)] [font-size:12px] [font-weight:700]"}>{t("agentForm.roleSetting")}</span>
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
                  {roleDescriptionPresetLabel(preset.id)}
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
          placeholder={t("agentForm.rolePlaceholder")}
          aria-label={`${participant.displayName} ${t("agentForm.roleSetting")}`}
        />
      </div>

      {showRoomInstructions ? (
        <label>
          <span>{t("agentForm.roomDesc")}</span>
          <textarea
            value={roomInstructions}
            readOnly={readOnly}
            aria-readonly={readOnly || undefined}
            onChange={(event) => {
              if (readOnly) return;
              setRoomInstructions(event.target.value);
            }}
            className={readOnly ? "[color:var(--muted)] [background:#f3f4f6] [cursor:default]" : ""}
            placeholder={t("agentForm.roomDescPlaceholder")}
            aria-label={`${participant.displayName} ${t("agentForm.roomDesc")}`}
          />
        </label>
      ) : !readOnly ? (
        <button
          type="button"
          className={"[justify-self:start] [border:0] [padding:0] [color:var(--muted)] [background:transparent] [font-size:12px] [font-weight:650] [text-decoration:underline] [text-underline-offset:3px] [&:hover]:[color:var(--text)]"}
          onClick={() => setShowRoomInstructionsEditor(true)}
        >
          {t("agentForm.addRoomDesc")}
        </button>
      ) : null}

      {!readOnly ? (
        <div className={"[display:flex] [flex-wrap:wrap] [justify-content:space-between] [gap:8px] [padding-top:10px] [margin-top:4px]"}>
          <div className={"[display:flex] [flex-wrap:wrap] [gap:6px]"}>
            {props.showRemove && props.onRemoveParticipant ? (
              <button
                type="button"
                className={"[display:inline-flex] [height:32px] [align-items:center] [border:0] [border-radius:10px] [padding:0_12px] [color:var(--danger)] [background:#fde8e7] [font-size:12px] [font-weight:650]"}
                onClick={() => {
                  if (!window.confirm(t("agentForm.removeConfirm", { name: participant.displayName }))) return;
                  void props.onRemoveParticipant!(participant.id).then(() => props.onRemoved?.());
                }}
              >
                {t("common.remove")}
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
            {saving ? t("common.saving") : isAddMode ? t("agentForm.addToRoom") : t("common.save")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AgentSelect(props: {
  id: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = props.options.find((option) => option.value === props.value) ?? props.options[0] ?? null;

  const updatePosition = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width,
    });
  };

  useEffect(() => {
    if (!props.open) return;
    updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      props.onOpenChange(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onOpenChange(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [props.open, props.onOpenChange]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={props.open}
        data-agent-select-id={props.id}
        className={`[display:grid] [grid-template-columns:minmax(0,_1fr)_18px] [align-items:center] [height:34px] [width:100%] [min-width:0] [border:1px_solid_var(--border)] [border-radius:12px] [padding:0_10px] [color:var(--text)] [background:#ffffff] [font-size:13px] [text-align:left] [outline:none] [cursor:pointer] focus-visible:[border-color:#8ab4f8] focus-visible:[box-shadow:0_0_0_3px_rgb(74_144_226_/_18%)] disabled:[color:var(--muted)] disabled:[background:#f3f4f6] disabled:[cursor:default] ${props.className ?? ""}`}
        onClick={() => {
          if (props.disabled) return;
          updatePosition();
          props.onOpenChange(!props.open);
        }}
      >
        <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
          {selected?.label ?? ""}
        </span>
        <ChevronDown size={16} className={"[justify-self:end] [color:var(--muted)]"} />
      </button>
      {props.open && position ? createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={props.ariaLabel}
          className={"[position:fixed] [z-index:10000] [display:grid] [max-height:260px] [overflow:auto] [border:1px_solid_#2f2f2f] [border-radius:14px] [padding:6px] [color:#f7f7f7] [background:#4f4f4f] [box-shadow:0_18px_44px_rgb(0_0_0_/_22%)]"}
          style={{ top: position.top, left: position.left, width: position.width }}
        >
          {props.options.map((option) => {
            const active = option.value === props.value;
            return (
              <button
                key={option.value || "empty"}
                type="button"
                role="option"
                aria-selected={active}
                className={`[display:grid] [grid-template-columns:20px_minmax(0,_1fr)] [align-items:center] [gap:6px] [min-height:34px] [border:0] [border-radius:10px] [padding:0_10px] [color:inherit] [background:transparent] [font:inherit] [text-align:left] [cursor:pointer] hover:[background:#ffffff1f] focus-visible:[outline:none] focus-visible:[background:#ffffff2b] ${active ? "[background:#4f8fea]" : ""}`}
                onClick={() => {
                  props.onChange(option.value);
                  props.onOpenChange(false);
                  buttonRef.current?.focus();
                }}
              >
                <span className={"[width:16px] [color:#ffffff]"}>
                  {active ? "✓" : ""}
                </span>
                <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
