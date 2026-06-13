import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Mic, MicOff, X } from "lucide-react";
import type {
  AddParticipantRequest,
  Identity,
  LocalAgentProviderStatus,
  Participant,
  RuntimeProfile,
  UpdateParticipantRequest,
} from "@group-chat/shared";
import { DEFAULT_PARTICIPANT_LISTEN_MODE } from "@group-chat/shared";
import { runtimeStatusSummary } from "../../runtime.js";
import { resolveAgentAvatar } from "../../identity-avatar.js";
import { AgentAvatar } from "../ui/AgentAvatar.js";
import { RoomAvatarUploadButton } from "../ui/RoomAvatarUploadButton.js";
import { AgentManageForm } from "./AgentManageForm.js";

export function AgentProfileDialog(props: {
  participant: Participant | null;
  setupIdentity?: Identity | null;
  conversationId?: string | null;
  roomParticipants?: Participant[];
  identity: Identity | null;
  runtimeProfile: RuntimeProfile | null;
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
  showRemove?: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onOpenIdentity?: (identityId: string) => void;
  onMention: (participant: Participant) => void;
  onAddParticipant?: (
    conversationId: string,
    input: AddParticipantRequest,
  ) => Promise<{ participant: Participant }>;
  onUpdateParticipant: (participantId: string, input: UpdateParticipantRequest) => Promise<unknown>;
  onToggleMute: (participantId: string, muted: boolean) => Promise<unknown>;
  onRemoveParticipant?: (participantId: string) => Promise<unknown>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const participant = props.participant;
  const setupIdentity = props.setupIdentity ?? null;
  const isAddMode = Boolean(setupIdentity && !participant);
  const draftParticipant = useMemo(
    () =>
      isAddMode && setupIdentity && props.conversationId
        ? createDraftParticipant(setupIdentity, props.conversationId, props.roomParticipants ?? [])
        : null,
    [isAddMode, props.conversationId, props.roomParticipants, setupIdentity],
  );
  const formParticipant = participant ?? draftParticipant;
  const [avatar, setAvatar] = useState<string | null>(formParticipant?.avatar ?? setupIdentity?.icon ?? null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mutePending, setMutePending] = useState(false);
  const [previewDisplayName, setPreviewDisplayName] = useState(formParticipant?.displayName ?? setupIdentity?.name ?? "");

  useEffect(() => {
    if (!formParticipant && !setupIdentity) return;
    setAvatar(formParticipant?.avatar ?? setupIdentity?.icon ?? null);
    setUploadError(null);
    setPreviewDisplayName(formParticipant?.displayName ?? setupIdentity?.name ?? "");
  }, [
    formParticipant?.avatar,
    formParticipant?.displayName,
    formParticipant?.id,
    setupIdentity,
  ]);

  useEffect(() => {
    if (!formParticipant && !setupIdentity) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      props.onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [formParticipant, props, setupIdentity]);

  if (!formParticipant) return null;

  const selectedRuntime =
    props.runtimeProfiles.find((profile) => profile.id === formParticipant.runtimeProfileId) ?? props.runtimeProfile;
  const displayAvatar = avatar ?? props.identity?.icon ?? setupIdentity?.icon ?? null;
  const headerAvatar = resolveAgentAvatar({
    avatar: displayAvatar,
    icon: props.identity?.icon ?? setupIdentity?.icon,
    runtimeProfile: selectedRuntime,
  });
  const identityAvatar = resolveAgentAvatar({
    icon: props.identity?.icon,
    runtimeProfile:
      props.identity?.defaultRuntimeProfileId
        ? props.runtimeProfiles.find((profile) => profile.id === props.identity!.defaultRuntimeProfileId) ?? null
        : null,
  });
  const removed = !isAddMode && participant?.status === "removed";
  const muted = !isAddMode && participant?.status === "muted";

  const toggleMute = async () => {
    if (!participant || mutePending) return;
    setMutePending(true);
    try {
      await props.onToggleMute(participant.id, !muted);
    } finally {
      setMutePending(false);
    }
  };

  return (
    <div
      className={"[position:fixed] [inset:0] [z-index:80] [display:grid] [place-items:center] [padding:24px] [background:rgb(15_23_42_/_52%)] max-[760px]:[padding:14px]"}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${previewDisplayName || formParticipant.displayName} 设置`}
        className={"[display:flex] [width:min(680px,_calc(100vw_-_32px))] [max-height:min(720px,_calc(100vh_-_32px))] [flex-direction:column] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:20px] [background:var(--panel)] [box-shadow:0_24px_80px_rgb(0_0_0_/_24%)] max-[760px]:[width:calc(100vw_-_28px)] max-[760px]:[max-height:calc(100vh_-_28px)]"}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={"[display:flex] [flex:0_0_auto] [align-items:center] [justify-content:space-between] [gap:12px] [padding:16px_18px] [border-bottom:1px_solid_var(--border)]"}>
          <div className={"[display:flex] [min-width:0] [flex:1_1_auto] [align-items:center] [gap:10px]"}>
            {removed ? (
              <AgentAvatar title={previewDisplayName || formParticipant.displayName} avatar={headerAvatar.avatar} provider={headerAvatar.provider} size={40} />
            ) : (
              <RoomAvatarUploadButton
                title={previewDisplayName || formParticipant.displayName}
                avatar={headerAvatar.avatar}
                provider={headerAvatar.provider}
                size={40}
                agent
                onUpload={(dataUrl) => {
                  setAvatar(dataUrl);
                  setUploadError(null);
                }}
                onError={setUploadError}
              />
            )}
            <div className={"[min-width:0]"}>
              <h3 className={"[margin:0] [overflow:hidden] [font-size:16px] [font-weight:720] [line-height:1.2] [text-overflow:ellipsis] [white-space:nowrap]"}>
                {previewDisplayName || formParticipant.displayName}
              </h3>
              {isAddMode ? (
                <p className={"[margin:3px_0_0] [color:var(--muted)] [font-size:12px] [line-height:1.35]"}>
                  配置完成后保存，即可加入此群
                </p>
              ) : (
                <p className={"[margin:3px_0_0] [color:var(--muted)] [font-size:12px] [line-height:1.35]"}>
                  {runtimeStatusSummary(selectedRuntime, props.localAgentProviders)}
                </p>
              )}
              {uploadError ? (
                <p className={"[margin:4px_0_0] [color:var(--danger)] [font-size:11px] [line-height:1.35]"}>{uploadError}</p>
              ) : null}
              <div className={"[display:flex] [flex-wrap:wrap] [gap:6px] [margin-top:6px]"}>
                {isAddMode ? (
                  <span className={"[display:inline-flex] [height:20px] [align-items:center] [border-radius:999px] [padding:0_7px] [color:#2563eb] [background:#eff6ff] [font-size:10px] [font-weight:700]"}>
                    待添加
                  </span>
                ) : null}
                {removed ? (
                  <span className={"[display:inline-flex] [height:20px] [align-items:center] [border-radius:999px] [padding:0_7px] [color:#6b7280] [background:#f3f4f6] [font-size:10px] [font-weight:700]"}>
                    已移出群聊
                  </span>
                ) : null}
                {muted ? (
                  <span className={"[display:inline-flex] [height:20px] [align-items:center] [border-radius:999px] [padding:0_7px] [color:#b45309] [background:#fef3c7] [font-size:10px] [font-weight:700]"}>
                    已静音
                  </span>
                ) : null}
              </div>
            </div>
            {props.identity && props.onOpenIdentity ? (
              <>
                <ChevronRight size={16} className={"[flex-shrink:0] [color:#cbd5e1]"} aria-hidden />
                <button
                  type="button"
                  className={"[display:inline-flex] [flex-shrink:0] [max-width:min(200px,_42vw)] [align-items:center] [gap:6px] [border:1px_solid_var(--border)] [border-radius:999px] [padding:4px_10px_4px_4px] [color:var(--text)] [background:#f8fafc] [font-size:12px] [font-weight:650] [white-space:nowrap] [cursor:pointer] [transition:background-color_0.12s_ease,_border-color_0.12s_ease] [&:hover]:[background:#eff6ff] [&:hover]:[border-color:#bfdbfe] [&:focus-visible]:[outline:none] [&:focus-visible]:[box-shadow:0_0_0_3px_#2563eb22]"}
                  onClick={() => props.onOpenIdentity?.(props.identity!.id)}
                  title={`查看全局 Agent「${props.identity.name}」`}
                >
                  <AgentAvatar title={props.identity.name} avatar={identityAvatar.avatar} provider={identityAvatar.provider} size={32} />
                  <span className={"[min-width:0] [overflow:hidden] [text-overflow:ellipsis]"}>
                    来自 {props.identity.name}
                  </span>
                </button>
              </>
            ) : null}
          </div>

          <div className={"[display:flex] [flex:0_0_auto] [align-items:center] [gap:6px]"}>
            {!removed && !isAddMode ? (
              <button
                type="button"
                className={"[display:inline-flex] [height:32px] [align-items:center] [gap:5px] [border:1px_solid_var(--border)] [border-radius:10px] [padding:0_12px] [color:var(--text)] [background:#ffffff] [font-size:12px] [font-weight:650] [&:hover:not(:disabled)]:[background:#f7f7f8] [&:disabled]:[opacity:0.55]"}
                disabled={mutePending}
                onClick={() => void toggleMute()}
              >
                {muted ? <Mic size={14} /> : <MicOff size={14} />}
                {muted ? "解除静音" : "静音"}
              </button>
            ) : null}
            <button
              type="button"
              className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012]"}
              aria-label="关闭"
              onClick={props.onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className={"[min-height:0] [flex:1_1_auto] [overflow-y:auto] [padding:18px_20px_20px]"}>
          <AgentManageForm
            key={isAddMode ? `add:${setupIdentity?.id}` : formParticipant.id}
            mode={isAddMode ? "add" : "edit"}
            participant={formParticipant}
            identity={props.identity ?? setupIdentity}
            runtimeProfile={props.runtimeProfile}
            localAgentProviders={props.localAgentProviders}
            showRemove={props.showRemove}
            readOnly={removed}
            avatar={avatar}
            conversationId={props.conversationId ?? undefined}
            onDisplayNameChange={setPreviewDisplayName}
            onMention={props.onMention}
            onAddParticipant={props.onAddParticipant}
            onUpdateParticipant={props.onUpdateParticipant}
            onRemoveParticipant={props.onRemoveParticipant}
            onSaved={props.onSaved ?? props.onClose}
          />
        </div>
      </div>
    </div>
  );
}

function createDraftParticipant(
  identity: Identity,
  conversationId: string,
  roomParticipants: Participant[],
): Participant {
  const existingCount = roomParticipants.filter(
    (participant) =>
      participant.kind === "ai"
      && participant.status !== "removed"
      && participant.identityId === identity.id,
  ).length;
  const now = new Date().toISOString();
  return {
    id: "__draft__",
    conversationId,
    kind: "ai",
    displayName: existingCount > 0 ? `${identity.name} ${existingCount + 1}` : identity.name,
    avatar: null,
    runtimeProfileId: identity.defaultRuntimeProfileId,
    identityId: identity.id,
    roomInstructions: "",
    status: "active",
    listenMode: identity.defaultListenMode ?? DEFAULT_PARTICIPANT_LISTEN_MODE,
    sortOrder: 0,
    reasoningEffort: identity.defaultReasoningEffort,
    createdAt: now,
    updatedAt: now,
  };
}
