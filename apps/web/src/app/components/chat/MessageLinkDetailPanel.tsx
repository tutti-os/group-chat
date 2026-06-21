import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Artifact, Identity, Message, MessageBlock, Participant, Room, Conversation, RuntimeProfile } from "@group-chat/shared";
import { resolveArtifactLinkedMessageId } from "@group-chat/shared";
import { parseMessageLinkIds, primaryMessageLinkId } from "../../chat-links.js";
import { messageSenderLabel } from "../../chat-links.js";
import { formatMessageTime } from "../../formatting.js";
import { t, useTranslation } from "../../i18n/index.js";
import { MessageReferenceContent } from "./MessageReferenceContent.js";
import { ArtifactBlock } from "./MessageTimeline.js";

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
  runtimeProfiles?: RuntimeProfile[];
  userProfile?: { displayName: string };
  onClose: () => void;
  onOpenArtifact?: (artifact: Artifact) => void;
  onOpenAgentProfile?: (participant: Participant) => void;
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

  const senders = new Map<string, { name: string; count: number }>();
  for (const message of linkedMessages) {
    const senderLabel = messageSenderLabel(message, props.participants, props.identities, props.userProfile?.displayName);
    const existing = senders.get(message.senderParticipantId ?? message.senderName ?? senderLabel);
    if (existing) {
      existing.count += 1;
    } else {
      senders.set(message.senderParticipantId ?? message.senderName ?? senderLabel, { name: senderLabel, count: 1 });
    }
  }

  const panelTitle = t("messageLink.detailTitle", {
    count: linkedMessages.length,
    senders: [...senders.values()].map((s) => s.name).slice(0, 3).join("、"),
  });

  return (
    <aside
      ref={panelRef}
      className={"[position:absolute] [top:56px] [right:0] [bottom:0] [z-index:36] [display:grid] [width:min(420px,_calc(100vw_-_24px))] [grid-template-rows:auto_minmax(0,_1fr)] [border-left:1px_solid_var(--border)] [background:var(--panel)] [box-shadow:-18px_0_40px_rgb(0_0_0_/_8%)]"}
    >
      <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:10px] [padding:14px] [border-bottom:1px_solid_var(--border)]"}>
        <div className={"[min-width:0] [&_h3]:[margin:0] [&_h3]:[font-size:15px] [&_h3]:[font-weight:720] [&_h3]:[line-height:1.2] [&_span]:[display:block] [&_span]:[margin-top:3px] [&_span]:[color:var(--muted)] [&_span]:[font-size:12px]"}>
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

      <div className={"[min-height:0] [overflow-y:auto] [padding:12px] [display:grid] [align-content:start] [gap:12px]"}>
        {linkedMessages.length === 0 ? (
          <div className={"[padding:28px_12px] [color:var(--muted)] [font-size:13px] [line-height:1.5] [text-align:center]"}>
            {t("messageLink.notFound")}
          </div>
        ) : null}
        {linkedMessages.map((message, index) => {
          const senderLabel = messageSenderLabel(message, props.participants, props.identities, props.userProfile?.displayName);
          const messageBlocks = props.blocks
            .filter((block) => block.messageId === message.id)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          const artifactBlocks = messageBlocks.filter((block) => block.type === "image" || block.type === "file");
          const messageArtifacts = artifactBlocks
            .map((block) => block.metadata?.artifactId)
            .filter((id): id is string => Boolean(id))
            .map((id) => props.artifacts.find((item) => item.id === id))
            .filter((item): item is Artifact => Boolean(item));
          const textBlocks = messageBlocks.filter((block) => block.type === "main_text" || block.type === "reasoning" || block.type === "tool_result");

          return (
            <div
              key={message.id}
              className={"[border-radius:10px] [padding:8px_10px] [background:#f8f9fa] [display:grid] [gap:4px]"}
            >
              <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:8px]"}>
                <span className={"[font-size:12px] [font-weight:700] [color:var(--text)] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]"}>
                  {senderLabel}
                </span>
                <span className={"[flex-shrink:0] [color:var(--muted)] [font-size:10px]"}>
                  {formatMessageTime(message.createdAt)}
                </span>
              </div>
              <div className={"[display:grid] [gap:4px] [font-size:12px] [line-height:1.4] [color:var(--text)] [word-break:break-word] [overflow-wrap:anywhere]"}>
                {textBlocks.length === 0 && messageArtifacts.length === 0 ? (
                  <span className={"[color:var(--muted)] [font-size:11px]"}>{t("common.attachment")}</span>
                ) : null}
                {textBlocks.map((block) => (
                  <div key={block.id} className={"[display:contents]"}>
                    <MessageReferenceContent
                      content={(block.content || " ").replace(/\n{3,}/g, "\n\n").trim()}
                      mentions={message.mentions}
                      artifacts={props.artifacts}
                      participants={props.participants}
                      runtimeProfiles={props.runtimeProfiles}
                      onOpenAgentProfile={props.onOpenAgentProfile}
                      onOpenArtifact={props.onOpenArtifact}
                      tightSpacing
                    />
                  </div>
                ))}
                {messageArtifacts.length > 0 ? (
                  <div className={"[display:flex] [flex-wrap:wrap] [gap:6px]"}>
                    {messageArtifacts.map((artifact) => (
                      <ArtifactBlock
                        key={artifact.id}
                        artifact={artifact}
                        onOpen={() => props.onOpenArtifact?.(artifact)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
