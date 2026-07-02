import type {
  TuttiExternalAtInsertResult,
  TuttiExternalAtProviderId
} from "@tutti-os/workspace-external-core/contracts";
import { sanitizeRichTextMentionScopeForAgentContext } from "@tutti-os/ui-rich-text/core";

export type Id = string;

export type ConversationType = "single" | "group";
export type ParticipantKind = "human" | "ai";
export type ParticipantStatus = "active" | "muted" | "removed";
export type ParticipantListenMode = "active" | "passive" | "adaptive";
export const DEFAULT_PARTICIPANT_LISTEN_MODE: ParticipantListenMode = "passive";
export const LEGACY_DEFAULT_IDENTITY_ROLE_DESCRIPTION = "You are a helpful local agent in this room.";
const LEGACY_PRESET_ROLE_DESCRIPTION_PREFIXES = [
  "You are a senior product manager agent.",
  "You are a senior product designer agent.",
  "You are a senior software engineer agent.",
  "You are a senior QA tester agent.",
  "You are a senior marketing strategist agent.",
];

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
  if (isDefaultIdentityRoleDescription(description)) {
    return "";
  }
  return description;
}

export function isDefaultIdentityRoleDescription(description: string) {
  const normalized = description.trim();
  return (
    !normalized
    || normalized === LEGACY_DEFAULT_IDENTITY_ROLE_DESCRIPTION
    || LEGACY_PRESET_ROLE_DESCRIPTION_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export function stripAssistantSkillDetails(content: string): string {
  return normalizeStrippedSkillDetails(
    stripSkillMarkdownSection(
      stripFromSkillBaseDirectory(content),
    ),
  );
}

function stripFromSkillBaseDirectory(content: string) {
  const match = content.match(/\bBase directory for this skill:\s*/i);
  if (!match || match.index === undefined) return content;
  return content.slice(0, match.index);
}

function stripSkillMarkdownSection(content: string) {
  const headingPattern = /^#{1,2}\s+\S.*$/gm;
  for (const match of content.matchAll(headingPattern)) {
    const headingIndex = match.index ?? -1;
    if (headingIndex < 0) continue;
    const prefix = content.slice(0, headingIndex);
    const section = content.slice(headingIndex);
    if (!/(?:^|\n)#{2,3}\s+User Input Tools\b/i.test(section)) continue;
    if (!/(?:^|\b)(skill|调用|call|using|invoke)(?:\b|$)/i.test(prefix)) continue;
    return content.slice(0, headingIndex);
  }
  return content;
}

function normalizeStrippedSkillDetails(content: string) {
  return content
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  speedMode: string | null;
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
  description?: string;
  supportedReasoningEfforts?: ReasoningEffort[];
}

export interface LocalAgentProviderSpeedMode {
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
  defaultModelId?: string;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort | null;
  speedModes?: LocalAgentProviderSpeedMode[];
  defaultSpeedMode?: string | null;
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
  defaultSpeedMode: string | null;
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
  contentHash: string | null;
  localPath: string;
  publicUrl: string;
  textPreview: string | null;
  createdAt: string;
}

export function isGroupChatFile(
  artifact: Pick<Artifact, "id" | "messageId">,
  messages: Array<Pick<Message, "id" | "status" | "visibility">>,
  blocks: Array<Pick<MessageBlock, "messageId" | "type" | "metadata">>,
): boolean {
  return blocks.some((block) => {
    if ((block.type !== "image" && block.type !== "file") || block.metadata?.artifactId !== artifact.id) {
      return false;
    }
    const message = messages.find((item) => item.id === block.messageId);
    return Boolean(
      message
      && message.status !== "deleted"
      && message.status !== "recalled"
      && message.visibility !== "whisper",
    );
  });
}

export function isAgentGroupChatFile(
  artifact: Pick<Artifact, "messageId" | "sourceRunId" | "kind">,
  messages: Array<Pick<Message, "id" | "status" | "visibility" | "role">>,
  agentRuns: Array<Pick<AgentRun, "id" | "visibility">>,
): boolean {
  if (artifact.kind !== "run-output" && artifact.kind !== "generated") return false;
  if (artifact.sourceRunId) {
    const run = agentRuns.find((item) => item.id === artifact.sourceRunId);
    if (run?.visibility === "public") return true;
  }
  if (!artifact.messageId) return false;
  const message = messages.find((item) => item.id === artifact.messageId);
  if (!message) return false;
  if (message.role !== "assistant") return false;
  if (message.status === "deleted" || message.status === "recalled") return false;
  return message.visibility === "public";
}

export function isVisibleGroupChatFile(
  artifact: Pick<Artifact, "id" | "messageId" | "sourceRunId" | "kind" | "conversationId">,
  messages: Array<Pick<Message, "id" | "status" | "visibility" | "role">>,
  blocks: Array<Pick<MessageBlock, "messageId" | "type" | "metadata">>,
  agentRuns: Array<Pick<AgentRun, "id" | "visibility">>,
): boolean {
  return isGroupChatFile(artifact, messages, blocks) || isAgentGroupChatFile(artifact, messages, agentRuns);
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

export function resolveArtifactLinkedMessageId(
  artifact: Pick<Artifact, "messageId" | "sourceRunId">,
  runs: Array<Pick<AgentRun, "id" | "assistantMessageId" | "triggerMessageId">>,
  messages: Array<Pick<Message, "id" | "runId" | "role">>,
): string | null {
  if (artifact.messageId) return artifact.messageId;
  if (!artifact.sourceRunId) return null;
  const run = runs.find((item) => item.id === artifact.sourceRunId);
  if (!run) return null;
  if (run.assistantMessageId) return run.assistantMessageId;
  const assistantMessage = messages.find((message) => message.runId === run.id && message.role === "assistant");
  if (assistantMessage) return assistantMessage.id;
  return run.triggerMessageId ?? null;
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

export const TUTTI_AT_PROVIDER_IDS = [
  "file",
  "workspace-issue",
  "workspace-app",
  "agent-session",
  "agent-generated-file",
] as const satisfies readonly TuttiExternalAtProviderId[];

export type TuttiAtProviderId = TuttiExternalAtProviderId;

export type TuttiReferenceInsert = TuttiExternalAtInsertResult;

export interface MentionTarget {
  participantId: Id;
  displayNameSnapshot: string;
  mentionType: "participant" | "all" | "reference";
  referenceProviderId?: TuttiAtProviderId;
  referenceEntityId?: string;
  referenceScope?: Readonly<Record<string, string>>;
  referenceInsert?: TuttiReferenceInsert;
}

export function sanitizeMentionTargetForAgentContext(mention: MentionTarget): MentionTarget {
  if (mention.mentionType !== "reference") {
    return mention;
  }
  const referenceScope = sanitizeRichTextMentionScopeForAgentContext(mention.referenceScope);
  return {
    participantId: mention.participantId,
    displayNameSnapshot: mention.displayNameSnapshot,
    mentionType: mention.mentionType,
    ...(mention.referenceProviderId ? { referenceProviderId: mention.referenceProviderId } : {}),
    ...(mention.referenceEntityId ? { referenceEntityId: mention.referenceEntityId } : {}),
    ...(referenceScope ? { referenceScope } : {}),
    ...sanitizeReferenceInsertForAgentContext(mention.referenceInsert),
  };
}

export function sanitizeMentionTargetsForAgentContext(mentions: readonly MentionTarget[]): MentionTarget[] {
  return mentions.map((mention) => sanitizeMentionTargetForAgentContext(mention));
}

export function resolveMentionTargetReferenceScope(
  mention: Pick<MentionTarget, "referenceInsert" | "referenceScope">,
): Readonly<Record<string, string>> | undefined {
  const insert = mention.referenceInsert;
  if (insert?.kind !== "mention") return mention.referenceScope;
  const legacyInsert = insert as unknown as {
    mention?: { scope?: Readonly<Record<string, string>> };
    scope?: Readonly<Record<string, string>>;
  };
  const insertScope = legacyInsert.mention?.scope ?? legacyInsert.scope;
  if (!insertScope) return mention.referenceScope;
  if (!mention.referenceScope) return insertScope;
  return {
    ...mention.referenceScope,
    ...insertScope,
  };
}

export function resolveMentionTargetReferenceLabel(
  mention: Pick<MentionTarget, "displayNameSnapshot" | "referenceEntityId" | "referenceInsert">,
): string {
  const displayName = mention.displayNameSnapshot.trim();
  if (displayName) return displayName;
  const insert = mention.referenceInsert;
  if (insert?.kind === "mention") {
    const legacyInsert = insert as unknown as { mention?: { label?: string }; label?: string };
    const insertLabel = (legacyInsert.mention?.label ?? legacyInsert.label ?? "").trim();
    if (insertLabel) return insertLabel;
  }
  return mention.referenceEntityId?.trim() ?? "";
}

function sanitizeReferenceInsertForAgentContext(
  insert: TuttiReferenceInsert | undefined,
): Pick<MentionTarget, "referenceInsert"> {
  if (!insert) return {};
  if (insert.kind !== "mention") {
    return {};
  }
  if (!insert.mention) return {};
  const entityId = insert.mention.entityId.trim();
  const label = insert.mention.label.trim().replace(/^@+/, "").trim() || entityId;
  if (!entityId || !label) return {};
  const scope = sanitizeRichTextMentionScopeForAgentContext(insert.mention.scope);
  return {
    referenceInsert: {
      kind: "mention",
      mention: {
        entityId,
        label,
        ...(scope ? { scope } : {}),
      },
    },
  };
}

export type AppReferenceKind = "file";

export type AppFileReferenceLocationType = "app-data-relative" | "app-package-relative";

export interface AppFileReferenceLocation {
  type: AppFileReferenceLocationType;
  path: string;
}

export type AppReference = AppFileReference;

export interface AppFileReference {
  kind: "file";
  displayName?: string;
  description?: string;
  location: AppFileReferenceLocation;
  sizeBytes?: number;
  mtimeMs?: number;
  mimeType?: string;
  score?: number;
  parentGroupLabel?: string;
  artifactId?: string;
  messageId?: string;
  previewUrl?: string;
}

export interface AppReferenceListTimeRange {
  fromMs?: number;
  toMs?: number;
}

export interface AppReferenceListRequest {
  parentGroupId?: string | null;
  filterText?: string | null;
  limit?: number;
  cursor?: string | null;
  kinds?: AppReferenceKind[];
  timeRange?: AppReferenceListTimeRange | null;
}

export interface AppReferenceSearchRequest {
  query: string;
  /**
   * 已选「文件类型筛选分类」id(image/video/document/webpage/other)。
   * 筛选与搜索是同一能力:query 可空、filters 非空时即「仅按类型查」。未知 id 忽略。
   */
  filters?: string[];
  limit?: number;
  cursor?: string | null;
  kinds?: AppReferenceKind[];
  timeRange?: AppReferenceListTimeRange | null;
}

export interface AppReferenceGroup {
  type: "group";
  id: string;
  displayName: string;
  description?: string | null;
  referenceCount: number;
}

export interface AppReferenceListReferenceItem {
  type: "reference";
  reference: AppReference;
}

export type AppReferenceListItem = AppReferenceGroup | AppReferenceListReferenceItem;

export interface AppReferenceListResponse {
  items: AppReferenceListItem[];
  nextCursor?: string | null;
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
  | "message.hidden"
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

export interface ConversationMessagesPage {
  conversationId: Id;
  messages: Message[];
  messageBlocks: MessageBlock[];
  artifacts: Artifact[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
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
  defaultSpeedMode?: string | null;
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
  defaultSpeedMode?: string | null;
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
  speedMode?: string | null;
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
  speedMode?: string | null;
}

export type MessageVisibility = "public" | "whisper";

export interface SendMessageRequest {
  content: string;
  artifactIds?: string[];
  parts?: Array<
    | { type: "text"; content: string }
    | { type: "artifact"; artifactId: string }
  >;
  mentions?: MentionTarget[];
  parentMessageId?: string | null;
  maxReplyRounds?: number;
  visibility?: MessageVisibility;
  /** 本地用户显示名，写入 senderName 供其他客户端展示 */
  senderName?: string | null;
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

export interface AgentContextUsage {
  participantId: Id;
  conversationId: Id;
  totalChars: number;
  estimatedTokens: number;
  rawConversationLogChars: number;
  rawConversationLogMaxChars: number;
  rawConversationLogKeepChars: number;
  memoryChars: number;
  distilledContextChars: number;
  localUserMemoryChars: number;
  conversationSummaryChars: number;
  workspaceInstructionChars: number;
  rawConversationLogExists: boolean;
  compacted: boolean;
  updatedAt: string | null;
}

export interface AgentContextCompactResponse {
  before: AgentContextUsage;
  after: AgentContextUsage;
}

export interface UpdateMessageRequest {
  content?: string;
  parts?: SendMessageRequest["parts"];
  mentions?: MentionTarget[];
  status?: Extract<MessageStatus, "deleted" | "recalled">;
}

export interface HideMessageResponse {
  messageId: Id;
  hidden: true;
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

export function isLocalUserMessage(message: Pick<Message, "role">): boolean {
  return message.role === "user";
}

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

export function isMentionAllTrigger(mentions: Array<Pick<MentionTarget, "mentionType">>) {
  return mentions.some((mention) => mention.mentionType === "all");
}

export function resolveMentionSpeakingOrder(
  order: SpeakingOrder,
  mentions: Array<Pick<MentionTarget, "mentionType" | "participantId">>,
): SpeakingOrder {
  if (isMentionAllTrigger(mentions)) return "parallel";
  const participantMentions = mentions.filter((mention) => mention.mentionType === "participant");
  const uniqueParticipantIds = new Set(participantMentions.map((mention) => mention.participantId));
  if (uniqueParticipantIds.size > 1) return "parallel";
  return order;
}

export function uniqueDisplayName(baseName: string, takenLowercase: Iterable<string>): string {
  const base = normalizeParticipantDisplayName(baseName, "Agent");
  const taken = new Set(takenLowercase);
  if (!taken.has(base.toLowerCase())) return base;
  let index = 2;
  let candidate = appendDisplayNameSuffix(base, index);
  while (taken.has(candidate.toLowerCase())) {
    index += 1;
    candidate = appendDisplayNameSuffix(base, index);
  }
  return candidate;
}

export function uniqueParticipantDisplayNameInRoom(
  baseName: string,
  participants: Array<Pick<Participant, "id" | "displayName" | "kind" | "status">>,
  options?: { excludeParticipantId?: string | null },
): string {
  const taken = participants
    .filter((participant) => participant.kind === "ai" && participant.status !== "removed")
    .filter((participant) => !options?.excludeParticipantId || participant.id !== options.excludeParticipantId)
    .map((participant) => participant.displayName.trim().toLowerCase())
    .filter(Boolean);
  return uniqueDisplayName(baseName, taken);
}

export const PARTICIPANT_DISPLAY_NAME_MAX_UNITS = 20;

export function normalizeParticipantDisplayName(displayName: string, fallback = ""): string {
  const trimmed = displayName.trim();
  return truncateParticipantDisplayName(trimmed || fallback, PARTICIPANT_DISPLAY_NAME_MAX_UNITS);
}

export function participantDisplayNameUnits(displayName: string): number {
  let units = 0;
  for (const char of [...displayName]) {
    units += participantDisplayNameCharUnits(char);
  }
  return units;
}

export function truncateParticipantDisplayName(
  displayName: string,
  maxUnits = PARTICIPANT_DISPLAY_NAME_MAX_UNITS,
  options?: { trimTrailing?: boolean },
): string {
  let units = 0;
  let result = "";
  for (const char of [...displayName]) {
    const charUnits = participantDisplayNameCharUnits(char);
    if (units + charUnits > maxUnits) break;
    result += char;
    units += charUnits;
  }
  return options?.trimTrailing === false ? result : result.trimEnd();
}

function appendDisplayNameSuffix(baseName: string, index: number) {
  const suffix = ` ${index}`;
  const prefix = truncateParticipantDisplayName(
    baseName,
    PARTICIPANT_DISPLAY_NAME_MAX_UNITS - participantDisplayNameUnits(suffix),
  );
  return `${prefix || "Agent"}${suffix}`;
}

function participantDisplayNameCharUnits(char: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)
    ? 2
    : 1;
}

const TUTTI_AGENT_PARTICIPANT_PREFIX = "tutti-agent:";

export function normalizeTuttiAgentProvider(provider: string | null | undefined) {
  const normalized = provider?.trim().toLowerCase() ?? "";
  if (normalized === "claude-code") return "claude";
  if (normalized === "claude" || normalized === "codex") return normalized;
  return normalized.replace(/[^a-z0-9_.-]/g, "");
}

export function tuttiAgentParticipantId(provider: string) {
  const normalized = normalizeTuttiAgentProvider(provider);
  return normalized ? `${TUTTI_AGENT_PARTICIPANT_PREFIX}${normalized}` : "";
}

export function parseTuttiAgentParticipantId(participantId: string | null | undefined) {
  const trimmed = participantId?.trim() ?? "";
  if (!trimmed.startsWith(TUTTI_AGENT_PARTICIPANT_PREFIX)) return "";
  return normalizeTuttiAgentProvider(trimmed.slice(TUTTI_AGENT_PARTICIPANT_PREFIX.length));
}

export function defaultTuttiAgentParticipantName(provider: string) {
  if (provider === "codex") return "Codex";
  if (provider === "claude") return "Claude Code";
  return provider || "Agent";
}

export {
  enrichAssistantContentWithWorkspaceResourceLinks,
  resolveTriggerUserMentions,
} from "./assistant-reference-enrichment.js";
