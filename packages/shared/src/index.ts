export type Id = string;

export type ConversationType = "single" | "group";
export type ParticipantKind = "human" | "ai";
export type ParticipantStatus = "active" | "muted" | "removed";
export type ParticipantListenMode = "active" | "passive" | "adaptive";
export const DEFAULT_PARTICIPANT_LISTEN_MODE: ParticipantListenMode = "passive";
export const LEGACY_DEFAULT_IDENTITY_ROLE_DESCRIPTION = "You are a helpful local agent in this room.";

export function getIdentityRoleDescription(
  identity: Pick<Identity, "systemPrompt" | "stylePrompt"> | null | undefined,
): string {
  return [identity?.systemPrompt, identity?.stylePrompt]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function getConfiguredIdentityRoleDescription(
  identity: Pick<Identity, "systemPrompt" | "stylePrompt"> | null | undefined,
): string {
  const description = getIdentityRoleDescription(identity);
  if (!description || description === LEGACY_DEFAULT_IDENTITY_ROLE_DESCRIPTION) {
    return "";
  }
  return description;
}
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type SpeakingOrder = "sequential" | "random" | "parallel";
export type ReplyMode = "all" | "mentioned" | "selected" | "auto";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type MessageStatus = "pending" | "streaming" | "success" | "error" | "cancelled" | "deleted" | "recalled";
export type MessageBlockType =
  | "main_text"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "image"
  | "file"
  | "artifact"
  | "error";
export type MessageBlockStatus = "pending" | "streaming" | "success" | "error";
export type AgentRunStatus = "accepted" | "running" | "completed" | "failed" | "cancelled";
export type AgentRunEventType =
  | "status"
  | "thinking_delta"
  | "tool_call"
  | "tool_result"
  | "file_write"
  | "stderr"
  | "error";
export type ArtifactKind = "upload" | "generated" | "preview" | "run-output";
export type RuntimeKind = "server-demo" | "server-deepagent" | "local-agent";
export type SystemPromptMode = "native" | "prompt-prefix" | "unsupported";

export interface ReplyPolicy {
  mode: ReplyMode;
  order: SpeakingOrder;
  maxRounds: number;
  mentionFollowupRounds: number;
}

export interface Room {
  id: Id;
  title: string;
  description: string;
  avatar: string | null;
  artifactRoot: string;
  defaultReplyPolicy: ReplyPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: Id;
  roomId: Id;
  type: ConversationType;
  title: string;
  groupSystemPrompt: string;
  collaborationRules: string;
  collaborationRulesVersion: number;
  replyPolicy: ReplyPolicy;
  activeBranchId: string | null;
  pinned: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollaborationRuleEvent {
  id: Id;
  conversationId: Id;
  version: number;
  previousRules: string;
  nextRules: string;
  templateId: string | null;
  actorName: string;
  createdAt: string;
}

export interface Participant {
  id: Id;
  conversationId: Id;
  kind: ParticipantKind;
  displayName: string;
  avatar: string | null;
  runtimeProfileId: string | null;
  identityId: string | null;
  roomInstructions: string;
  status: ParticipantStatus;
  listenMode: ParticipantListenMode;
  sortOrder: number;
  reasoningEffort: ReasoningEffort | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeProfile {
  id: Id;
  kind: RuntimeKind;
  provider: string;
  model: string;
  displayName: string;
  enabled: boolean;
  trustedMode: boolean;
  systemPromptMode: SystemPromptMode;
  capabilities: {
    streaming: boolean;
    toolUse: boolean;
    reasoning: boolean;
    vision: boolean;
    resume: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LocalAgentProviderModel {
  id: string;
  label: string;
}

export interface LocalAgentProviderStatus {
  provider: string;
  displayName: string;
  available: boolean;
  authState: "ok" | "missing" | "expired" | "unknown";
  executablePath: string;
  version: string;
  configDir?: string;
  models: LocalAgentProviderModel[];
  reason?: string;
}

export interface LocalAgentProviderStatusResponse {
  providers: LocalAgentProviderStatus[];
}

export interface Identity {
  id: Id;
  name: string;
  icon: string;
  systemPrompt: string;
  stylePrompt: string;
  defaultRuntimeProfileId: string | null;
  defaultListenMode: ParticipantListenMode;
  defaultReasoningEffort: ReasoningEffort | null;
  temperature: number;
  skillIds: string[];
  toolAccessPolicy: {
    mode: "none" | "read-only" | "approved-tools";
    allowedToolIds: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: Id;
  conversationId: Id;
  role: MessageRole;
  senderParticipantId: string | null;
  senderName: string | null;
  content: string;
  mentions: MentionTarget[];
  visibility: MessageVisibility;
  status: MessageStatus;
  branchId: string | null;
  parentMessageId: string | null;
  runId: string | null;
  tokenUsage: TokenUsage | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageBlock {
  id: Id;
  messageId: Id;
  type: MessageBlockType;
  content: string;
  status: MessageBlockStatus;
  metadata: Record<string, unknown> | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: Id;
  roomId: Id;
  conversationId: Id;
  messageId: string | null;
  sourceRunId: string | null;
  kind: ArtifactKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  localPath: string;
  publicUrl: string;
  textPreview: string | null;
  createdAt: string;
}

export interface AgentRun {
  id: Id;
  conversationId: Id;
  roomId: Id;
  participantId: string | null;
  assistantMessageId: string | null;
  triggerMessageId: string | null;
  runtime: string;
  provider: string;
  model: string;
  status: AgentRunStatus;
  visibility: MessageVisibility;
  resumeMode: "fresh" | "provider-local" | "handoff";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface AgentRunEvent {
  id: Id;
  runId: Id;
  conversationId: Id;
  type: AgentRunEventType;
  content: string;
  status: MessageBlockStatus;
  metadata: Record<string, unknown> | null;
  sortOrder: number;
  createdAt: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface MentionTarget {
  participantId: Id;
  displayNameSnapshot: string;
  mentionType: "participant" | "all";
}

export type StreamEventType =
  | "room.created"
  | "room.deleted"
  | "room.updated"
  | "identity.created"
  | "identity.updated"
  | "identity.deleted"
  | "conversation.updated"
  | "participant.created"
  | "participant.updated"
  | "message.created"
  | "message.updated"
  | "message_block.created"
  | "message_block.updated"
  | "artifact.created"
  | "run.accepted"
  | "run.started"
  | "run.event.created"
  | "run.delta"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "private_task.started"
  | "private_task.delta"
  | "private_task.completed"
  | "private_task.failed"
  | "private_task.cancelled";

export interface StreamEvent<TPayload = unknown> {
  id: Id;
  seq: number;
  type: StreamEventType;
  roomId: string | null;
  conversationId: string | null;
  runId: string | null;
  payload: TPayload;
  createdAt: string;
}

export interface ChatSnapshot {
  rooms: Room[];
  conversations: Conversation[];
  participants: Participant[];
  identities: Identity[];
  runtimeProfiles: RuntimeProfile[];
  messages: Message[];
  messageBlocks: MessageBlock[];
  agentRunEvents: AgentRunEvent[];
  artifacts: Artifact[];
  agentRuns: AgentRun[];
  activeRuns: AgentRun[];
  lastSeq: number;
}

export interface CreateRoomRequest {
  title?: string;
  description?: string;
  participants?: Array<{
    displayName: string;
    kind?: ParticipantKind;
    runtimeProfileId?: string | null;
    identityId?: string | null;
    roomInstructions?: string;
  }>;
}

export interface UpdateRoomRequest {
  title?: string;
  description?: string;
  avatar?: string | null;
}

export interface CreateIdentityRequest {
  name: string;
  icon?: string;
  systemPrompt?: string;
  stylePrompt?: string;
  defaultRuntimeProfileId?: string | null;
  defaultListenMode?: ParticipantListenMode;
  defaultReasoningEffort?: ReasoningEffort | null;
  model?: string;
  temperature?: number;
}

export interface UpdateIdentityRequest {
  name?: string;
  icon?: string;
  systemPrompt?: string;
  stylePrompt?: string;
  defaultRuntimeProfileId?: string | null;
  defaultListenMode?: ParticipantListenMode;
  defaultReasoningEffort?: ReasoningEffort | null;
  model?: string;
  temperature?: number;
}

export interface UpdateConversationRulesRequest {
  collaborationRules: string;
  templateId?: string | null;
}

export interface UpdateConversationPolicyRequest {
  replyPolicy: ReplyPolicy;
}

export interface UpdateConversationPinRequest {
  pinned: boolean;
}

export interface AddParticipantRequest {
  identityId: string;
  runtimeProfileId?: string | null;
  displayName?: string;
  listenMode?: ParticipantListenMode;
  roomInstructions?: string;
  reasoningEffort?: ReasoningEffort | null;
}

export interface UpdateParticipantRequest {
  identityId?: string;
  runtimeProfileId?: string;
  model?: string;
  displayName?: string;
  avatar?: string | null;
  listenMode?: ParticipantListenMode;
  roomInstructions?: string;
  reasoningEffort?: ReasoningEffort | null;
}

export type MessageVisibility = "public" | "whisper";

export interface SendMessageRequest {
  content: string;
  artifactIds?: string[];
  mentions?: MentionTarget[];
  parentMessageId?: string | null;
  maxReplyRounds?: number;
  visibility?: MessageVisibility;
}

export type PrivateTaskType = "summary" | "agent";

export interface PrivateTaskRequest {
  participantId: Id;
  prompt: string;
  sourceMessageId?: Id | null;
  sourceMessageIds?: Id[];
  taskType?: PrivateTaskType;
}

export interface PrivateTaskSnapshot {
  id: Id;
  type: PrivateTaskType;
  conversationId: Id;
  sourceMessageId: Id | null;
  sourceMessageIds: Id[];
  participantId: Id;
  participantName: string;
  sourcePreview: string;
  status: "running" | "completed" | "failed" | "cancelled";
  content: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateMessageRequest {
  content?: string;
  mentions?: MentionTarget[];
  status?: Extract<MessageStatus, "deleted" | "recalled">;
}

export interface UploadArtifactRequest {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export interface UploadArtifactResponse {
  artifact: Artifact;
}

export interface WsClientMessage {
  type: "hello" | "subscribe" | "unsubscribe";
  lastSeq?: number;
  conversationIds?: string[];
}

export interface WsServerMessage {
  type: "hello" | "event" | "replay";
  lastSeq: number;
  event?: StreamEvent;
  events?: StreamEvent[];
}

export const defaultReplyPolicy: ReplyPolicy = {
  mode: "auto",
  order: "sequential",
  maxRounds: 1,
  mentionFollowupRounds: 1,
};

export function isMessageVisibleToParticipant(message: Message, participantId: string) {
  if (message.visibility !== "whisper") return true;
  if (message.role === "user") {
    return message.mentions.some((mention) => mention.participantId === participantId);
  }
  if (message.role === "assistant") {
    return message.senderParticipantId === participantId;
  }
  return false;
}

export function resolveMessageVisibility(message: Message, messages: Message[] = []): MessageVisibility {
  if (message.visibility === "whisper") return "whisper";
  if (message.role !== "user") return "public";

  for (const candidate of messages) {
    if (candidate.role !== "assistant" || candidate.visibility !== "whisper") continue;
    if (candidate.createdAt < message.createdAt) continue;
    if (!candidate.senderParticipantId) continue;
    if (message.mentions.some((mention) => mention.participantId === candidate.senderParticipantId)) {
      return "whisper";
    }
  }

  return "public";
}

export function isAgentRunVisibleToParticipant(run: AgentRun, participantId: string) {
  if (run.visibility !== "whisper") return true;
  return run.participantId === participantId;
}

export function resolveAgentRunVisibility(run: AgentRun, messages: Message[]): MessageVisibility {
  if (run.visibility === "whisper") return "whisper";

  if (run.triggerMessageId) {
    const trigger = messages.find((message) => message.id === run.triggerMessageId);
    if (trigger?.visibility === "whisper") return "whisper";
  }

  const linkedAssistant = run.assistantMessageId
    ? messages.find((message) => message.id === run.assistantMessageId)
    : messages.find((message) => message.runId === run.id && message.role === "assistant");
  if (linkedAssistant?.visibility === "whisper") return "whisper";

  let latestTrigger: Message | null = null;
  for (const message of messages) {
    if (message.conversationId !== run.conversationId) continue;
    if (message.role !== "user") continue;
    if (!run.participantId) continue;
    if (!message.mentions.some((mention) => mention.participantId === run.participantId)) continue;
    if (!latestTrigger || message.createdAt.localeCompare(latestTrigger.createdAt) > 0) {
      latestTrigger = message;
    }
  }
  if (latestTrigger?.visibility === "whisper") return "whisper";

  return "public";
}

export function enrichAgentRun(run: AgentRun, messages: Message[]): AgentRun {
  const visibility = resolveAgentRunVisibility(run, messages);
  const triggerMessageId = run.triggerMessageId
    ?? (() => {
      if (visibility !== "whisper") return run.triggerMessageId;
      let latestTrigger: Message | null = null;
      for (const message of messages) {
        if (message.conversationId !== run.conversationId) continue;
        if (message.role !== "user") continue;
        if (message.visibility !== "whisper") continue;
        if (!run.participantId) continue;
        if (!message.mentions.some((mention) => mention.participantId === run.participantId)) continue;
        if (!latestTrigger || message.createdAt.localeCompare(latestTrigger.createdAt) > 0) {
          latestTrigger = message;
        }
      }
      return latestTrigger?.id ?? run.triggerMessageId;
    })();
  if (visibility === run.visibility && triggerMessageId === run.triggerMessageId) return run;
  return { ...run, visibility, triggerMessageId };
}

export function enrichAgentRuns(runs: AgentRun[], messages: Message[]): AgentRun[] {
  return runs.map((run) => enrichAgentRun(run, messages));
}
