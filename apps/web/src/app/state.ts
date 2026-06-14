import type { ChatSnapshot, Identity, Participant, StreamEvent, UpdateRoomRequest } from "@group-chat/shared";

export interface AppState extends ChatSnapshot {
  ready: boolean;
}

export const emptyState: AppState = {
  ready: false,
  rooms: [],
  conversations: [],
  participants: [],
  identities: [],
  runtimeProfiles: [],
  messages: [],
  messageBlocks: [],
  agentRunEvents: [],
  artifacts: [],
  activeRuns: [],
  lastSeq: 0,
};


export function applyEvent(state: AppState, event: StreamEvent): AppState {
  const payload = event.payload as any;
  const withSeq = { ...state, lastSeq: event.seq };
  if (
    event.conversationId &&
    event.type !== "room.created" &&
    event.type !== "room.deleted" &&
    !state.conversations.some((conversation) => conversation.id === event.conversationId)
  ) {
    return withSeq;
  }
  switch (event.type) {
    case "room.created":
    case "room.updated":
      return {
        ...withSeq,
        rooms: upsert(state.rooms, payload.room),
        conversations: upsert(state.conversations, payload.conversation),
        participants: upsertMany(state.participants, payload.participants ?? []),
      };
    case "room.deleted": {
      const roomId = payload.roomId ?? event.roomId;
      const conversationId = payload.conversationId ?? event.conversationId;
      return removeDeletedRoom(withSeq, roomId, conversationId);
    }
    case "identity.created":
    case "identity.updated":
      return { ...withSeq, identities: upsertIdentity(state.identities, payload.identity) };
    case "identity.deleted":
      return {
        ...withSeq,
        identities: state.identities.filter((identity) => identity.id !== payload.identityId),
        participants: upsertMany(state.participants, payload.removedParticipants ?? []),
      };
    case "participant.created":
    case "participant.updated":
      return { ...withSeq, participants: upsertParticipant(state.participants, payload.participant) };
    case "message.created":
    case "message.updated":
      return { ...withSeq, messages: upsert(state.messages, payload.message) };
    case "message_block.created":
    case "message_block.updated":
      return { ...withSeq, messageBlocks: upsert(state.messageBlocks, payload.block) };
    case "artifact.created":
      return { ...withSeq, artifacts: upsert(state.artifacts, payload.artifact) };
    case "conversation.updated":
      return { ...withSeq, conversations: upsert(state.conversations, payload.conversation) };
    case "run.event.created":
      return { ...withSeq, agentRunEvents: upsert(state.agentRunEvents, payload.event) };
    case "run.accepted":
    case "run.started":
      return payload.run ? { ...withSeq, activeRuns: upsert(state.activeRuns, payload.run) } : withSeq;
    case "run.completed":
    case "run.failed":
    case "run.cancelled": {
      const runId = event.runId ?? payload.run?.id;
      return {
        ...withSeq,
        activeRuns: runId ? state.activeRuns.filter((run) => run.id !== runId) : state.activeRuns,
      };
    }
    default:
      return withSeq;
  }
}

export function removeActiveRun(state: AppState, runId: string): AppState {
  return {
    ...state,
    activeRuns: state.activeRuns.filter((run) => run.id !== runId),
    messages: state.messages.map((message) =>
      message.runId === runId && (message.status === "pending" || message.status === "streaming")
        ? { ...message, status: "cancelled" }
        : message,
    ),
  };
}

export function upsert<T extends { id: string }>(items: T[], item: T | null | undefined): T[] {
  if (!item) return items;
  const exists = items.some((current) => current.id === item.id);
  return exists ? items.map((current) => (current.id === item.id ? item : current)) : [...items, item];
}

export function upsertIdentity(identities: Identity[], incoming: Identity | null | undefined): Identity[] {
  if (!incoming) return identities;
  const existing = identities.find((item) => item.id === incoming.id);
  if (!existing) return [...identities, incoming];
  if (existing.updatedAt > incoming.updatedAt) {
    return identities.map((item) => (item.id === incoming.id ? existing : item));
  }
  return identities.map((item) => (item.id === incoming.id ? incoming : item));
}

export function upsertParticipant(participants: Participant[], incoming: Participant | null | undefined): Participant[] {
  if (!incoming) return participants;
  const existing = participants.find((item) => item.id === incoming.id);
  if (!existing) return [...participants, incoming];
  if (existing.updatedAt > incoming.updatedAt) {
    return participants.map((item) => (item.id === incoming.id ? existing : item));
  }
  return participants.map((item) => (item.id === incoming.id ? incoming : item));
}

export function upsertMany<T extends { id: string }>(items: T[], nextItems: T[]): T[] {
  return nextItems.reduce((current, item) => upsert(current, item), items);
}

export function applyRoomUpdate(state: AppState, roomId: string, input: UpdateRoomRequest): AppState {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return state;
  const nextTitle = input.title === undefined ? room.title : input.title.trim() || room.title;
  const nextAvatar = input.avatar === undefined ? room.avatar : input.avatar?.trim() || null;
  const now = new Date().toISOString();
  const nextRoom = { ...room, title: nextTitle, avatar: nextAvatar, updatedAt: now };
  const conversation = state.conversations.find((item) => item.roomId === roomId);
  return {
    ...state,
    rooms: upsert(state.rooms, nextRoom),
    conversations: conversation
      ? upsert(state.conversations, {
          ...conversation,
          title: input.title === undefined ? conversation.title : nextTitle,
          updatedAt: now,
        })
      : state.conversations,
  };
}


export function removeDeletedRoom(state: AppState, roomId: string | null, conversationId: string | null): AppState {
  const messageIds = new Set(
    state.messages.filter((message) => message.conversationId === conversationId).map((message) => message.id),
  );
  return {
    ...state,
    rooms: state.rooms.filter((room) => room.id !== roomId),
    conversations: state.conversations.filter((conversation) => conversation.id !== conversationId),
    participants: state.participants.filter((participant) => participant.conversationId !== conversationId),
    messages: state.messages.filter((message) => message.conversationId !== conversationId),
    messageBlocks: state.messageBlocks.filter((block) => !messageIds.has(block.messageId)),
    agentRunEvents: state.agentRunEvents.filter((event) => event.conversationId !== conversationId),
    artifacts: state.artifacts.filter(
      (artifact) => artifact.roomId !== roomId && artifact.conversationId !== conversationId,
    ),
    activeRuns: state.activeRuns.filter((run) => run.roomId !== roomId && run.conversationId !== conversationId),
  };
}


