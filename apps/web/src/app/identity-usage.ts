import type {
  Conversation,
  Identity,
  Participant,
  ParticipantListenMode,
  Room,
} from "@group-chat/shared";
import { getLocale } from "./i18n/index.js";

export interface IdentityUsageClone {
  participantId: string;
  displayName: string;
  avatar: string | null;
  listenMode: ParticipantListenMode;
  status: Participant["status"];
  hasRoomOverride: boolean;
  isAlias: boolean;
}

export interface IdentityUsageRoom {
  conversationId: string;
  title: string;
  roomAvatar: string | null;
  clones: IdentityUsageClone[];
}

function isActiveIdentityParticipant(
  participant: Participant,
  identityId: string,
  existingConversationIds: Set<string>,
): boolean {
  return (
    participant.identityId === identityId
    && participant.kind === "ai"
    && participant.status !== "removed"
    && existingConversationIds.has(participant.conversationId)
  );
}

export function listIdentityUsage(
  identity: Identity,
  participants: Participant[],
  conversations: Conversation[],
  rooms: Room[],
): IdentityUsageRoom[] {
  const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const existingConversationIds = new Set(conversations.map((conversation) => conversation.id));
  const byConversation = new Map<string, IdentityUsageClone[]>();

  for (const participant of participants) {
    if (!isActiveIdentityParticipant(participant, identity.id, existingConversationIds)) continue;
    const clone: IdentityUsageClone = {
      participantId: participant.id,
      displayName: participant.displayName,
      avatar: participant.avatar,
      listenMode: participant.listenMode,
      status: participant.status,
      hasRoomOverride: Boolean(participant.roomInstructions.trim()),
      isAlias: participant.displayName.trim() !== identity.name.trim(),
    };
    const clones = byConversation.get(participant.conversationId) ?? [];
    clones.push(clone);
    byConversation.set(participant.conversationId, clones);
  }

  const usage: IdentityUsageRoom[] = [];
  for (const [conversationId, clones] of byConversation) {
    const conversation = conversationById.get(conversationId);
    if (!conversation) continue;
    const room = roomById.get(conversation.roomId);
    clones.sort((left, right) => left.displayName.localeCompare(right.displayName, getLocale()));
    usage.push({
      conversationId,
      title: conversation.title,
      roomAvatar: room?.avatar ?? null,
      clones,
    });
  }

  usage.sort((left, right) => left.title.localeCompare(right.title, getLocale()));
  return usage;
}

export function countIdentityActiveRooms(
  identityId: string,
  participants: Participant[],
  conversations: Conversation[],
): number {
  const existingConversationIds = new Set(conversations.map((conversation) => conversation.id));
  const activeRoomIds = new Set<string>();
  for (const participant of participants) {
    if (!isActiveIdentityParticipant(participant, identityId, existingConversationIds)) continue;
    activeRoomIds.add(participant.conversationId);
  }
  return activeRoomIds.size;
}

export function countIdentityActiveClones(
  identityId: string,
  participants: Participant[],
  conversations: Conversation[],
): number {
  const existingConversationIds = new Set(conversations.map((conversation) => conversation.id));
  let count = 0;
  for (const participant of participants) {
    if (!isActiveIdentityParticipant(participant, identityId, existingConversationIds)) continue;
    count += 1;
  }
  return count;
}
