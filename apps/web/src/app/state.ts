import type { ChatSnapshot, Identity, Message, Participant, StreamEvent, UpdateRoomRequest, AgentRun } from "@group-chat/shared";
import { enrichAgentRun, enrichAgentRuns } from "@group-chat/shared";

export interface AppState extends ChatSnapshot {
  ready: boolean;
}

export function normalizeSnapshot(snapshot: ChatSnapshot): AppState {
  const messages = resolveMessagesVisibility(snapshot.messages);
  return {
    ...snapshot,
    messages,
    ready: true,
    activeRuns: enrichAgentRuns(snapshot.activeRuns, messages),
  };
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
  agentRuns: [],
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
    case "message.updated": {
      const messages = upsertMessage(state.messages, payload.message);
      const message = payload.message;
      let activeRuns = withSeq.activeRuns;
      if (
        message?.runId
        && (message.status === "error" || message.status === "success" || message.status === "cancelled")
      ) {
        activeRuns = activeRuns.filter((run) => run.id !== message.runId);
      }
      return {
        ...withSeq,
        messages,
        activeRuns: enrichAgentRuns(activeRuns, messages),
      };
    }
    case "message.hidden":
      return removeHiddenMessages(withSeq, [payload.messageId]);
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
      return payload.run
        ? {
            ...withSeq,
            activeRuns: upsert(
              withSeq.activeRuns,
              enrichAgentRun(payload.run as AgentRun, withSeq.messages),
            ),
            agentRuns: upsert(withSeq.agentRuns, payload.run as AgentRun),
          }
        : withSeq;
    case "run.completed":
    case "run.failed":
    case "run.cancelled": {
      const runId = event.runId ?? payload.run?.id;
      return {
        ...withSeq,
        activeRuns: runId ? state.activeRuns.filter((run) => run.id !== runId) : state.activeRuns,
        agentRuns: payload.run ? upsert(state.agentRuns, payload.run as AgentRun) : state.agentRuns,
      };
    }
    default:
      return withSeq;
  }
}

export function removeHiddenMessages(state: AppState, messageIds: string[]): AppState {
  if (messageIds.length === 0) return state;
  const idSet = new Set(messageIds);
  const messages = state.messages.filter((message) => !idSet.has(message.id));
  const visibleMessageIds = new Set(messages.map((message) => message.id));
  return {
    ...state,
    messages,
    messageBlocks: state.messageBlocks.filter((block) => visibleMessageIds.has(block.messageId)),
    artifacts: state.artifacts.filter(
      (artifact) => !artifact.messageId || visibleMessageIds.has(artifact.messageId),
    ),
    activeRuns: enrichAgentRuns(
      state.activeRuns.filter((run) => !run.assistantMessageId || visibleMessageIds.has(run.assistantMessageId)),
      messages,
    ),
  };
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
  const existingIndex = items.findIndex((current) => current.id === item.id);
  if (existingIndex === -1) return [...items, item];
  if (items[existingIndex] === item) return items;
  const result = items.slice();
  result[existingIndex] = item;
  return result;
}

export function upsertMessage(messages: Message[], incoming: Message | null | undefined): Message[] {
  if (!incoming) return messages;
  const mergedMessages = upsert(messages, incoming);
  return resolveMessagesVisibility(mergedMessages);
}

export function upsertIdentity(identities: Identity[], incoming: Identity | null | undefined): Identity[] {
  if (!incoming) return identities;
  const existingIndex = identities.findIndex((item) => item.id === incoming.id);
  if (existingIndex === -1) return [...identities, incoming];
  const existing = identities[existingIndex]!;
  if (existing.updatedAt > incoming.updatedAt) {
    return identities.map((item) => (item.id === incoming.id ? existing : item));
  }
  return identities.map((item) => (item.id === incoming.id ? incoming : item));
}

export function upsertParticipant(participants: Participant[], incoming: Participant | null | undefined): Participant[] {
  if (!incoming) return participants;
  const existingIndex = participants.findIndex((item) => item.id === incoming.id);
  if (existingIndex === -1) return [...participants, incoming];
  const existing = participants[existingIndex]!;
  if (existing.updatedAt > incoming.updatedAt) {
    return participants.map((item) => (item.id === incoming.id ? existing : item));
  }
  return participants.map((item) => (item.id === incoming.id ? incoming : item));
}

export function upsertMany<T extends { id: string }>(items: T[], nextItems: T[]): T[] {
  if (nextItems.length === 0) return items;
  const incomingById = new Map(nextItems.map((item) => [item.id, item]));
  const existingIds = new Set(items.map((item) => item.id));
  const result = items.map((item) => incomingById.get(item.id) ?? item);

  for (const item of nextItems) {
    if (existingIds.has(item.id)) continue;
    result.push(incomingById.get(item.id) ?? item);
    existingIds.add(item.id);
  }

  return result;
}

function resolveMessagesVisibility(messages: Message[]): Message[] {
  const whisperAssistantCreatedAtByParticipant = new Map<string, string[]>();
  for (const message of messages) {
    if (message.role !== "assistant" || message.visibility !== "whisper" || !message.senderParticipantId) continue;
    const createdAts = whisperAssistantCreatedAtByParticipant.get(message.senderParticipantId);
    if (createdAts) {
      createdAts.push(message.createdAt);
    } else {
      whisperAssistantCreatedAtByParticipant.set(message.senderParticipantId, [message.createdAt]);
    }
  }
  for (const createdAts of whisperAssistantCreatedAtByParticipant.values()) {
    createdAts.sort();
  }
  return messages.map((message) => {
    const visibility = resolveMessageVisibilityFromIndex(message, whisperAssistantCreatedAtByParticipant);
    return message.visibility === visibility ? message : { ...message, visibility };
  });
}

function resolveMessageVisibilityFromIndex(
  message: Message,
  whisperAssistantCreatedAtByParticipant: Map<string, string[]>,
): Message["visibility"] {
  if (message.visibility === "whisper") return "whisper";
  if (message.role !== "user") return "public";

  for (const mention of message.mentions) {
    const createdAts = whisperAssistantCreatedAtByParticipant.get(mention.participantId);
    if (createdAts && hasCreatedAtAtOrAfter(createdAts, message.createdAt)) {
      return "whisper";
    }
  }

  return "public";
}

function hasCreatedAtAtOrAfter(sortedCreatedAts: string[], createdAt: string) {
  let low = 0;
  let high = sortedCreatedAts.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedCreatedAts[mid]! < createdAt) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low < sortedCreatedAts.length;
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
    agentRuns: state.agentRuns.filter((run) => run.roomId !== roomId && run.conversationId !== conversationId),
    activeRuns: state.activeRuns.filter((run) => run.roomId !== roomId && run.conversationId !== conversationId),
  };
}

