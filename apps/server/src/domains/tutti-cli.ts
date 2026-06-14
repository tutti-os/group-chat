import type { Artifact, ChatSnapshot, Conversation, Message, Participant, Room } from "@group-chat/shared";

type CliInput = Record<string, unknown>;

interface CliInvokeEnvelope {
  input?: unknown;
  outputMode?: unknown;
}

interface CliTableColumn {
  key: string;
  label: string;
}

interface CliTableOutput {
  kind: "table";
  columns: CliTableColumn[];
  rows: Record<string, string | number | boolean | null>[];
}

interface CliJsonOutput {
  kind: "json";
  value: Record<string, unknown>;
}

export type CliCommandOutput = CliTableOutput | CliJsonOutput;

interface CliWarning {
  code: string;
  message: string;
  omittedWhisperMessageCount?: number;
  omittedWhisperArtifactCount?: number;
}

export interface CliCommandError {
  error: {
    code: string;
    message: string;
  };
}

const conversationListColumns: CliTableColumn[] = [
  { key: "id", label: "Conversation ID" },
  { key: "room", label: "Room" },
  { key: "title", label: "Title" },
  { key: "participants", label: "Participants" },
  { key: "pinned", label: "Pinned" },
  { key: "last-message-at", label: "Last message" },
  { key: "updated-at", label: "Updated" },
];

const artifactListColumns: CliTableColumn[] = [
  { key: "id", label: "Artifact ID" },
  { key: "conversation", label: "Conversation" },
  { key: "filename", label: "Filename" },
  { key: "kind", label: "Kind" },
  { key: "mime-type", label: "MIME type" },
  { key: "size-bytes", label: "Bytes" },
  { key: "created-at", label: "Created" },
];

export function listConversationsCliOutput(snapshot: ChatSnapshot, envelope: CliInvokeEnvelope): CliCommandOutput | CliCommandError {
  const input = cliInput(envelope);
  if (isCliInputError(input)) return input;
  const queryInput = optionalStringInput(input, "query");
  if (isCliInputError(queryInput)) return queryInput;
  const pinnedInput = optionalBooleanInput(input, "pinned");
  if (isCliInputError(pinnedInput)) return pinnedInput;
  const limitInput = optionalIntegerInput(input, "limit");
  if (isCliInputError(limitInput)) return limitInput;
  const query = queryInput.toLocaleLowerCase();
  const pinned = pinnedInput;
  const limit = normalizeLimit(limitInput);
  const roomsById = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const participantsByConversationId = groupParticipantsByConversation(snapshot.participants);
  const publicMessagesByConversationId = groupMessagesByConversation(snapshot.messages.filter(isPublicMessage));
  const omittedWhisperMessageCount = snapshot.messages.filter(isWhisperMessage).length;

  const conversations = snapshot.conversations
    .filter((conversation) => (pinned === null ? true : conversation.pinned === pinned))
    .filter((conversation) =>
      matchesConversationQuery(
        conversation,
        roomsById.get(conversation.roomId),
        publicMessagesByConversationId.get(conversation.id) ?? [],
        query,
      )
    )
    .slice(0, limit)
    .map((conversation) => {
      const room = roomsById.get(conversation.roomId) ?? null;
      const participants = participantsByConversationId.get(conversation.id) ?? [];
      const publicMessages = publicMessagesByConversationId.get(conversation.id) ?? [];
      return conversationListItem(conversation, room, participants, publicMessages.at(-1) ?? null);
    });

  if (envelope.outputMode === "json") {
    return {
      kind: "json",
      value: {
        warnings: publicOnlyWarnings({ omittedWhisperMessageCount }),
        conversations,
        count: conversations.length,
      },
    };
  }

  return {
    kind: "table",
    columns: conversationListColumns,
    rows: conversations.map((conversation) => ({
      id: conversation.id,
      room: conversation.room,
      title: conversation.title,
      participants: conversation.participants,
      pinned: conversation.pinned,
      "last-message-at": conversation.lastMessageAt,
      "updated-at": conversation.updatedAt,
    })),
  };
}

export function getConversationCliOutput(snapshot: ChatSnapshot, envelope: CliInvokeEnvelope): CliJsonOutput | CliCommandError {
  const input = cliInput(envelope);
  if (isCliInputError(input)) return input;
  const conversationId = requiredStringInput(input, "conversation-id");
  if (isCliInputError(conversationId)) return conversationId;
  const recentMessageLimitInput = optionalIntegerInput(input, "recent-message-limit");
  if (isCliInputError(recentMessageLimitInput)) return recentMessageLimitInput;
  if (!conversationId) {
    return cliError("invalid_input", "conversation-id is required");
  }
  const conversation = snapshot.conversations.find((item) => item.id === conversationId) ?? null;
  if (!conversation) {
    return cliError("not_found", "Conversation not found");
  }
  const room = snapshot.rooms.find((item) => item.id === conversation.roomId) ?? null;
  const participants = snapshot.participants
    .filter((participant) => participant.conversationId === conversation.id)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const recentMessageLimit = normalizeLimit(recentMessageLimitInput);
  const conversationMessages = snapshot.messages
    .filter((message) => message.conversationId === conversation.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const publicMessages = conversationMessages.filter(isPublicMessage);
  const messageById = new Map(snapshot.messages.map((message) => [message.id, message]));
  const runById = new Map(snapshot.agentRuns.map((run) => [run.id, run]));
  const conversationArtifacts = snapshot.artifacts
    .filter((artifact) => artifact.conversationId === conversation.id);
  const publicArtifacts = conversationArtifacts
    .filter((artifact) => isPublicArtifact(artifact, messageById, runById));
  const recentMessages = publicMessages
    .slice(-recentMessageLimit)
    .map(messageSummary);
  const artifacts = publicArtifacts
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((artifact) => artifactSummary(artifact, conversation, room));
  const omittedWhisperMessageCount = conversationMessages.filter(isWhisperMessage).length;
  const omittedWhisperArtifactCount = conversationArtifacts.length - publicArtifacts.length;

  return {
    kind: "json",
    value: {
      warnings: publicOnlyWarnings({ omittedWhisperMessageCount, omittedWhisperArtifactCount }),
      conversation: conversationDetail(
        conversation,
        room,
        participants,
        publicMessages.at(-1) ?? null,
        recentMessages,
        artifacts,
      ),
    },
  };
}

export function listArtifactsCliOutput(snapshot: ChatSnapshot, envelope: CliInvokeEnvelope): CliCommandOutput | CliCommandError {
  const input = cliInput(envelope);
  if (isCliInputError(input)) return input;
  const conversationId = optionalStringInput(input, "conversation-id");
  if (isCliInputError(conversationId)) return conversationId;
  const kind = optionalStringInput(input, "kind");
  if (isCliInputError(kind)) return kind;
  const queryInput = optionalStringInput(input, "query");
  if (isCliInputError(queryInput)) return queryInput;
  const limitInput = optionalIntegerInput(input, "limit");
  if (isCliInputError(limitInput)) return limitInput;
  const query = queryInput.toLocaleLowerCase();
  const limit = normalizeLimit(limitInput);
  const conversationsById = new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation]));
  const roomsById = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const messageById = new Map(snapshot.messages.map((message) => [message.id, message]));
  const runById = new Map(snapshot.agentRuns.map((run) => [run.id, run]));

  if (conversationId && !conversationsById.has(conversationId)) {
    return cliError("not_found", "Conversation not found");
  }

  const scopedArtifacts = snapshot.artifacts
    .filter((artifact) => (conversationId ? artifact.conversationId === conversationId : true))
    .filter((artifact) => (kind ? artifact.kind === kind : true));
  const publicArtifacts = scopedArtifacts.filter((artifact) => isPublicArtifact(artifact, messageById, runById));
  const omittedWhisperArtifactCount = scopedArtifacts.length - publicArtifacts.length;
  const artifacts = publicArtifacts
    .filter((artifact) => matchesArtifactQuery(artifact, query))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map((artifact) => {
      const conversation = conversationsById.get(artifact.conversationId) ?? null;
      const room = conversation ? roomsById.get(conversation.roomId) ?? null : null;
      return artifactSummary(artifact, conversation, room);
    });

  if (envelope.outputMode === "json") {
    return {
      kind: "json",
      value: {
        warnings: publicOnlyWarnings({ omittedWhisperArtifactCount }),
        artifacts,
        count: artifacts.length,
      },
    };
  }

  return {
    kind: "table",
    columns: artifactListColumns,
    rows: artifacts.map((artifact) => ({
      id: artifact.id,
      conversation: artifact.conversationTitle,
      filename: artifact.filename,
      kind: artifact.kind,
      "mime-type": artifact.mimeType,
      "size-bytes": artifact.sizeBytes,
      "created-at": artifact.createdAt,
    })),
  };
}

export function getArtifactCliOutput(snapshot: ChatSnapshot, envelope: CliInvokeEnvelope): CliJsonOutput | CliCommandError {
  const input = cliInput(envelope);
  if (isCliInputError(input)) return input;
  const artifactId = requiredStringInput(input, "artifact-id");
  if (isCliInputError(artifactId)) return artifactId;
  if (!artifactId) {
    return cliError("invalid_input", "artifact-id is required");
  }
  const artifact = snapshot.artifacts.find((item) => item.id === artifactId) ?? null;
  if (!artifact) {
    return cliError("not_found", "Artifact not found");
  }
  const messageById = new Map(snapshot.messages.map((message) => [message.id, message]));
  const runById = new Map(snapshot.agentRuns.map((run) => [run.id, run]));
  if (!isPublicArtifact(artifact, messageById, runById)) {
    return cliError("not_found", "Artifact not found");
  }
  const conversation = snapshot.conversations.find((item) => item.id === artifact.conversationId) ?? null;
  const room = conversation ? snapshot.rooms.find((item) => item.id === conversation.roomId) ?? null : null;
  const message = artifact.messageId ? snapshot.messages.find((item) => item.id === artifact.messageId) ?? null : null;

  return {
    kind: "json",
    value: {
      warnings: publicOnlyWarnings(),
      artifact: {
        ...artifactSummary(artifact, conversation, room),
        localPath: artifact.localPath,
        publicUrl: artifact.publicUrl,
        textPreview: artifact.textPreview,
        message: message ? messageSummary(message) : null,
      },
    },
  };
}

export function cliError(code: string, message: string): CliCommandError {
  return {
    error: {
      code,
      message,
    },
  };
}

export function isCliError(output: CliCommandOutput | CliCommandError): output is CliCommandError {
  return "error" in output;
}

function cliInput(envelope: CliInvokeEnvelope): CliInput | CliCommandError {
  if (envelope.input === undefined) return {};
  if (!isRecord(envelope.input)) {
    return cliError("invalid_input", "input must be an object");
  }
  return envelope.input;
}

function isCliInputError(value: CliInput | string | number | boolean | null | CliCommandError): value is CliCommandError {
  return isRecord(value) && "error" in value;
}

function requiredStringInput(input: CliInput, key: string): string | CliCommandError {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    return cliError("invalid_input", `${key} is required`);
  }
  return value.trim();
}

function optionalStringInput(input: CliInput, key: string): string | CliCommandError {
  const value = input[key];
  if (value === undefined) return "";
  if (typeof value !== "string") {
    return cliError("invalid_input", `${key} must be a string`);
  }
  return value.trim();
}

function optionalBooleanInput(input: CliInput, key: string): boolean | null | CliCommandError {
  const value = input[key];
  if (value === undefined) return null;
  if (typeof value !== "boolean") {
    return cliError("invalid_input", `${key} must be a boolean`);
  }
  return value;
}

function optionalIntegerInput(input: CliInput, key: string): number | null | CliCommandError {
  const value = input[key];
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return cliError("invalid_input", `${key} must be an integer`);
  }
  return value;
}

function normalizeLimit(value: number | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampLimit(value);
  }
  return 20;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function groupParticipantsByConversation(participants: Participant[]) {
  const grouped = new Map<string, Participant[]>();
  for (const participant of participants) {
    const current = grouped.get(participant.conversationId) ?? [];
    current.push(participant);
    grouped.set(participant.conversationId, current);
  }
  return grouped;
}

function groupMessagesByConversation(messages: Message[]) {
  const grouped = new Map<string, Message[]>();
  for (const message of messages) {
    const current = grouped.get(message.conversationId) ?? [];
    current.push(message);
    grouped.set(message.conversationId, current);
  }
  for (const group of grouped.values()) {
    group.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  return grouped;
}

function matchesConversationQuery(
  conversation: Conversation,
  room: Room | null | undefined,
  publicMessages: Message[],
  query: string,
) {
  if (!query) return true;
  const haystack = [
    conversation.id,
    conversation.title,
    conversation.groupSystemPrompt,
    room?.title,
    room?.description,
    ...publicMessages.map((message) => message.content),
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
  return haystack.includes(query);
}

function conversationListItem(
  conversation: Conversation,
  room: Room | null,
  participants: Participant[],
  latestPublicMessage: Message | null,
) {
  const activeParticipants = participants.filter((participant) => participant.status !== "removed");
  return {
    id: conversation.id,
    roomId: conversation.roomId,
    room: room?.title ?? conversation.roomId,
    title: conversation.title,
    participants: activeParticipants.length,
    pinned: conversation.pinned,
    lastMessage: latestPublicMessage?.content ?? null,
    lastMessageAt: latestPublicMessage?.createdAt ?? "",
    updatedAt: conversation.updatedAt,
    createdAt: conversation.createdAt,
  };
}

function conversationDetail(
  conversation: Conversation,
  room: Room | null,
  participants: Participant[],
  latestPublicMessage: Message | null,
  recentMessages: ReturnType<typeof messageSummary>[],
  artifacts: ReturnType<typeof artifactSummary>[],
) {
  return {
    ...conversationListItem(conversation, room, participants, latestPublicMessage),
    type: conversation.type,
    groupSystemPrompt: conversation.groupSystemPrompt,
    collaborationRules: conversation.collaborationRules,
    collaborationRulesVersion: conversation.collaborationRulesVersion,
    replyPolicy: conversation.replyPolicy,
    activeBranchId: conversation.activeBranchId,
    room: room
      ? {
          id: room.id,
          title: room.title,
          description: room.description,
          artifactRoot: room.artifactRoot,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
        }
      : null,
    participants: participants.map((participant) => ({
      id: participant.id,
      kind: participant.kind,
      displayName: participant.displayName,
      status: participant.status,
      listenMode: participant.listenMode,
      runtimeProfileId: participant.runtimeProfileId,
      identityId: participant.identityId,
      sortOrder: participant.sortOrder,
      createdAt: participant.createdAt,
      updatedAt: participant.updatedAt,
    })),
    recentMessages,
    artifacts,
    artifactCount: artifacts.length,
  };
}

function messageSummary(message: Message) {
  return {
    id: message.id,
    role: message.role,
    senderParticipantId: message.senderParticipantId,
    senderName: message.senderName,
    content: message.content,
    status: message.status,
    visibility: message.visibility,
    parentMessageId: message.parentMessageId,
    runId: message.runId,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function artifactSummary(artifact: Artifact, conversation: Conversation | null, room: Room | null) {
  return {
    id: artifact.id,
    roomId: artifact.roomId,
    roomTitle: room?.title ?? "",
    conversationId: artifact.conversationId,
    conversationTitle: conversation?.title ?? artifact.conversationId,
    messageId: artifact.messageId,
    sourceRunId: artifact.sourceRunId,
    kind: artifact.kind,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    publicUrl: artifact.publicUrl,
    localPath: artifact.localPath,
    hasTextPreview: Boolean(artifact.textPreview),
    createdAt: artifact.createdAt,
  };
}

function matchesArtifactQuery(artifact: Artifact, query: string) {
  if (!query) return true;
  return [
    artifact.id,
    artifact.filename,
    artifact.mimeType,
    artifact.kind,
    artifact.textPreview,
    artifact.messageId,
    artifact.sourceRunId,
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase()
    .includes(query);
}

function isPublicMessage(message: Message) {
  return message.visibility === "public";
}

function isWhisperMessage(message: Message) {
  return message.visibility === "whisper";
}

function isPublicArtifact(
  artifact: Artifact,
  messageById: Map<string, Message>,
  runById: Map<string, { visibility: "public" | "whisper" }>,
) {
  if (artifact.messageId) {
    return messageById.get(artifact.messageId)?.visibility === "public";
  }
  if (artifact.sourceRunId) {
    return runById.get(artifact.sourceRunId)?.visibility === "public";
  }
  return true;
}

function publicOnlyWarnings(counts: {
  omittedWhisperMessageCount?: number;
  omittedWhisperArtifactCount?: number;
} = {}): CliWarning[] {
  return [
    {
      code: "public_only",
      message: "CLI output includes public conversation data only; whisper messages and whisper-linked artifacts are omitted.",
      ...counts,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
