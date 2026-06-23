import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Artifact, Identity, Message, MessageBlock, Participant, Room, Conversation, RuntimeProfile, AgentRun, AgentRunEvent } from "@group-chat/shared";
import { parseMessageLinkIds } from "../../chat-links.js";
import { messageSenderLabel, resolveMessageSenderLabel } from "../../chat-links.js";
import { formatMessageTime } from "../../formatting.js";
import { t, useTranslation } from "../../i18n/index.js";
import { MessageBlockRenderer, MessageSenderAvatar } from "./MessageTimeline.js";
import type { BackgroundTask } from "../../background-tasks.js";
import type { LocalUserProfile } from "../../user-profile.js";

const MESSAGE_ROLE_CONTENT_CLASS =
  "[&[data-role=assistant]_[data-slot=message-block]:not([data-link-only])]:[background:#f2f3f5] "
  + "[&[data-role=assistant]_[data-slot=message-block]:not([data-link-only])]:[border-radius:8px] "
  + "[&[data-role=user]_[data-slot=message-block]:not([data-link-only])]:[border-color:transparent] "
  + "[&[data-role=user]_[data-slot=message-block]:not([data-link-only])]:[background:#d6e9ff]";

const MESSAGE_GROUP_GAP_MS = 60_000;

function shouldStartNewMessageGroup(previous: Message, current: Message) {
  if (previous.senderParticipantId !== current.senderParticipantId) return true;
  if (previous.conversationId !== current.conversationId) return true;
  const previousTime = Date.parse(previous.createdAt);
  const currentTime = Date.parse(current.createdAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return true;
  return currentTime - previousTime > MESSAGE_GROUP_GAP_MS;
}

export function MessageLinkDetailPanel(props: {
  open: boolean;
  messageIdSegment: string;
  messages: Message[];
  blocks: MessageBlock[];
  artifacts: Artifact[];
  participants: Participant[];
  identities: Identity[];
  conversations: Conversation[];
  rooms: Room[];
  runtimeProfiles: RuntimeProfile[];
  agentRuns: AgentRun[];
  agentRunEvents: AgentRunEvent[];
  summaryTasks: BackgroundTask[];
  userProfile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl" | "displayName">;
  onClose: () => void;
  onOpenArtifact?: (artifact: Artifact) => void;
  onOpenAgentProfile?: (participant: Participant) => void;
  onOpenMessageLink?: (messageId: string) => void;
  onOpenSummaryLink?: (taskId: string) => void;
  onEnsureSummaryTask?: (taskId: string) => Promise<BackgroundTask | null>;
}) {
  useTranslation();
  const panelRef = useRef<HTMLElement | null>(null);
  const { onClose } = props;

  useEffect(() => {
    if (!props.open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, props.open]);

  if (!props.open) return null;

  const messageIds = parseMessageLinkIds(props.messageIdSegment);
  const linkedMessages = messageIds
    .map((id) => props.messages.find((item) => item.id === id))
    .filter((item): item is Message => Boolean(item));

  const firstMessage = linkedMessages[0] ?? null;
  const conversation = firstMessage ? props.conversations.find((item) => item.id === firstMessage.conversationId) ?? null : null;
  const room = conversation ? props.rooms.find((item) => item.id === conversation.roomId) ?? null : null;

  const senderNames: string[] = [];
  const seenSenderKeys = new Set<string>();
  for (const msg of linkedMessages) {
    const key = msg.senderParticipantId ?? msg.senderName ?? msg.id;
    if (seenSenderKeys.has(key)) continue;
    seenSenderKeys.add(key);
    const senderLabel = messageSenderLabel(msg, props.participants, props.identities, props.userProfile?.displayName);
    if (senderLabel) senderNames.push(senderLabel);
  }

  const panelTitle = t("messageLink.detailTitle", {
    count: linkedMessages.length,
    senders: senderNames.slice(0, 3).join("、"),
  });

  return (
    <aside
      ref={panelRef}
      className={"[position:absolute] [top:56px] [right:0] [bottom:0] [z-index:36] [display:grid] [width:min(420px,_calc(100vw_-_24px))] [grid-template-rows:auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:var(--panel)] [box-shadow:-18px_0_40px_rgb(0_0_0_/_8%)]"}
    >
      <div className={"[display:grid] [min-width:0] [grid-template-columns:minmax(0,_1fr)_32px] [align-items:center] [gap:10px] [padding:14px] [border-bottom:1px_solid_var(--border)]"}>
        <div className={"[min-width:0] [&_h3]:[margin:0] [&_h3]:[overflow:hidden] [&_h3]:[font-size:15px] [&_h3]:[font-weight:720] [&_h3]:[line-height:1.2] [&_h3]:[text-overflow:ellipsis] [&_h3]:[white-space:nowrap] [&_span]:[display:block] [&_span]:[min-width:0] [&_span]:[overflow:hidden] [&_span]:[margin-top:3px] [&_span]:[color:var(--muted)] [&_span]:[font-size:12px] [&_span]:[text-overflow:ellipsis] [&_span]:[white-space:nowrap]"}>
          <h3>{panelTitle}</h3>
          <span>{room?.title || conversation?.title || t("common.unknownConversation")}</span>
        </div>
        <button
          className={"[display:inline-grid] [width:32px] [height:32px] [place-items:center] [border:0] [border-radius:10px] [color:var(--muted)] [background:#00000008] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000012] [&:focus-visible]:[outline:none]"}
          type="button"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className={"[min-height:0] [overflow-y:auto] [padding:8px_6px] [display:grid] [align-content:start]"}>
        {linkedMessages.length === 0 ? (
          <div className={"[padding:28px_12px] [color:var(--muted)] [font-size:13px] [line-height:1.5] [text-align:center]"}>
            {t("messageLink.notFound")}
          </div>
        ) : null}
        {linkedMessages.map((message, index) => {
          const isUserMessage = message.role === "user";
          const previous = index > 0 ? linkedMessages[index - 1]! : null;
          const showHeader = !previous || shouldStartNewMessageGroup(previous, message);
          const messageBlocks = props.blocks
            .filter((block) => block.messageId === message.id)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          const conversationBlocks = messageBlocks.filter((block) => block.type !== "tool_call" && block.type !== "reasoning");
          const visibleBlocks = conversationBlocks.filter((block) => block.content.trim() || block.type === "image" || block.type === "file");
          const participant = message.senderParticipantId
            ? props.participants.find((item) => item.id === message.senderParticipantId) ?? null
            : null;
          const participantIdentity = participant?.identityId
            ? props.identities.find((identity) => identity.id === participant.identityId) ?? null
            : null;
          const senderLabel = resolveMessageSenderLabel(
            message,
            participant,
            participantIdentity,
            props.userProfile.displayName,
          );

          return (
            <div
              key={message.id}
              data-role={message.role}
              data-group-continuation={!showHeader || undefined}
              className={`[position:relative] [display:grid] [grid-template-columns:34px_minmax(0,_1fr)] [gap:8px] [align-items:start] ${showHeader ? "[margin-top:14px]" : "[margin-top:2px]"} ${MESSAGE_ROLE_CONTENT_CLASS}`}
            >
              {showHeader ? (
                <div data-slot="message-avatar" className={"[display:inline-flex] [flex:0_0_auto] [width:34px] [height:34px] [align-items:flex-start] [justify-content:center] [padding-top:2px]"}>
                  <MessageSenderAvatar
                    message={message}
                    participant={participant}
                    identity={participantIdentity}
                    runtimeProfiles={props.runtimeProfiles}
                    userProfile={props.userProfile}
                  />
                </div>
              ) : (
                <div data-slot="message-avatar" aria-hidden="true" className={"[width:34px] [height:34px]"} />
              )}
              <div className={"[min-width:0] [display:grid]"}>
                {showHeader ? (
                  <div className={"[display:flex] [min-width:0] [align-items:center] [gap:7px] [overflow:hidden] [min-height:20px] [margin-bottom:4px]"}>
                    <strong className={"[min-width:0] [overflow:hidden] [color:var(--muted)] [font-size:12px] [font-weight:550] [text-overflow:ellipsis] [white-space:nowrap]"}>{senderLabel}</strong>
                    <span className={"[flex:0_0_auto] [color:var(--muted)] [font-size:12px]"}>{formatMessageTime(message.createdAt)}</span>
                  </div>
                ) : null}
                <div className={"[user-select:text] [min-width:0] [max-width:100%]"}>
                  {visibleBlocks.length === 0 ? (
                    <span className={"[color:var(--muted)] [font-size:13px]"}>{t("common.attachment")}</span>
                  ) : null}
                  {visibleBlocks.map((block) => (
                    <MessageBlockRenderer
                      key={block.id}
                      block={block}
                      artifacts={props.artifacts}
                      allBlocks={props.blocks}
                      allMessages={props.messages}
                      allParticipants={props.participants}
                      identities={props.identities}
                      userProfile={props.userProfile}
                      conversations={props.conversations}
                      rooms={props.rooms}
                      onOpenArtifact={props.onOpenArtifact ?? (() => {})}
                      onOpenMessageLink={props.onOpenMessageLink}
                      onOpenSummaryLink={props.onOpenSummaryLink}
                      onEnsureSummaryTask={props.onEnsureSummaryTask}
                      summaryTasks={props.summaryTasks}
                      referenceMentions={message.mentions}
                      messageRole={message.role}
                      onOpenAgentProfile={props.onOpenAgentProfile}
                      runtimeProfiles={props.runtimeProfiles}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
