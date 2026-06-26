import {
  DEFAULT_PARTICIPANT_LISTEN_MODE,
  isMessageVisibleToParticipant,
  type AddParticipantRequest,
  type AgentRun,
  type AgentRunEvent,
  type Artifact,
  type Conversation,
  type CreateIdentityRequest,
  type CreateRoomRequest,
  type Identity,
  type Message,
  type MessageBlock,
  type Participant,
  type ParticipantListenMode,
  type PrivateTaskRequest,
  type PrivateTaskSnapshot,
  type PrivateTaskType,
  type SendMessageRequest,
  type SpeakingOrder,
  type UpdateConversationRulesRequest,
  type UpdateConversationPolicyRequest,
  type UpdateIdentityRequest,
  type UpdateMessageRequest,
  type UpdateParticipantRequest,
  type UpdateRoomRequest,
  type UploadArtifactRequest,
  type ReplyMode,
  type RuntimeProfile,
  resolveMentionSpeakingOrder,
  sanitizeMentionTargetForAgentContext,
  stripAssistantSkillDetails,
} from "@group-chat/shared";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { nanoid } from "nanoid";
import { buildEffectiveRoleDescription } from "./agent-instructions.js";
import { enrichAssistantContentWithWorkspaceResourceLinks } from "./assistant-reference-enrichment.js";
import { sha256ForFile } from "./artifact-content-hash.js";
import { AgentToolTokenStore } from "./agent-tool-tokens.js";
import { AgentWorkspaceService } from "./agent-workspace.js";
import { ChatRepository } from "./chat-repository.js";
import {
  extractLocalFilePathsFromContent,
  inferMimeTypeForPath,
  linkRunFileArtifactPathsInContent,
  shouldImportRunFileArtifactPath,
} from "./run-file-artifacts.js";
import { participantWorkspaceRoot, roomArtifactRoot } from "../local/paths.js";
import { NO_REPLY_MARKER } from "../runtimes/local-agent-protocol.js";
import { createRuntimeProviderRegistry } from "../runtimes/runtime-registry.js";
import { RuntimeProviderUnsupportedError, type RuntimeReplyContext, type RuntimeStreamEvent } from "../runtimes/runtime-provider.js";
import { EventHub } from "../ws/event-hub.js";

const AUTO_IMPORT_RUN_FILE_MAX_BYTES = 50 * 1024 * 1024;

export class ChatService {
  private readonly workspaces = new AgentWorkspaceService();
  private readonly runtimes = createRuntimeProviderRegistry();
  private readonly activeReplyKeys = new Set<string>();
  private readonly cancelledRunIds = new Set<string>();
  private readonly cancelledPrivateTaskIds = new Set<string>();
  private readonly activePrivateTasks = new Map<string, {
    participantId: string;
    cancel: (reason: string) => Promise<void> | void;
  }>();
  private recoveredReplyQueue = false;
  private bootstrapMaintenanceStarted = false;

  constructor(
    private readonly repo: ChatRepository,
    private readonly events: EventHub,
    private readonly toolTokens: AgentToolTokenStore,
  ) {}

  warmup() {
    this.repo.ensureSeedData();
    this.backfillAssistantFilePathArtifacts();
    this.scheduleBootstrapMaintenance();
  }

  bootstrap(options: { messageLimitPerConversation?: number } = {}) {
    this.repo.ensureSeedData();
    this.backfillAssistantFilePathArtifacts();
    this.scheduleBootstrapMaintenance();
    return this.repo.filterHiddenFromSnapshot(this.repo.snapshot(options));
  }

  listConversationMessages(conversationId: string, options: { limit?: number; cursor?: string | null } = {}) {
    return this.repo.listConversationMessagePage(conversationId, options);
  }

  async listLocalAgentProviders() {
    return {
      providers: await this.runtimes.listLocalAgentProviders(),
    };
  }

  createRoom(input: CreateRoomRequest) {
    const bundle = this.repo.createRoom(input);
    this.materializeParticipants(bundle.conversation, bundle.participants);
    this.events.emit({
      type: "room.created",
      roomId: bundle.room.id,
      conversationId: bundle.conversation.id,
      payload: bundle,
    });
    return bundle;
  }

  deleteRoom(roomId: string) {
    const result = this.repo.deleteRoom(roomId);
    if (result) {
      this.events.emit({
        type: "room.deleted",
        roomId,
        conversationId: result.conversation?.id ?? null,
        payload: {
          roomId,
          conversationId: result.conversation?.id ?? null,
        },
      });
    }
    return result?.room ?? null;
  }

  updateRoom(roomId: string, input: UpdateRoomRequest) {
    const bundle = this.repo.updateRoom(roomId, input);
    if (bundle) {
      this.materializeParticipants(bundle.conversation, bundle.participants);
      this.events.emit({
        type: "room.updated",
        roomId: bundle.room.id,
        conversationId: bundle.conversation.id,
        payload: bundle,
      });
    }
    return bundle;
  }

  createIdentity(input: CreateIdentityRequest) {
    const identity = this.repo.createIdentity(this.resolveIdentityInput(input));
    this.workspaces.materializeIdentity(identity);
    this.events.emit({
      type: "identity.created",
      payload: { identity, runtimeProfile: this.getRuntimeProfile(identity.defaultRuntimeProfileId) },
    });
    return identity;
  }

  updateIdentity(identityId: string, input: UpdateIdentityRequest) {
    const identity = this.repo.updateIdentity(identityId, this.resolveIdentityInput(input, identityId));
    if (identity) {
      this.workspaces.materializeIdentity(identity);
      for (const participant of this.repo.listActiveParticipantsByIdentity(identity.id)) {
        const conversation = this.repo.getConversation(participant.conversationId);
        if (conversation) this.materializeParticipant(conversation, participant);
      }
      this.events.emit({
        type: "identity.updated",
        payload: { identity, runtimeProfile: this.getRuntimeProfile(identity.defaultRuntimeProfileId) },
      });
    }
    return identity;
  }

  async deleteIdentity(identityId: string) {
    const result = this.repo.deleteIdentity(identityId);
    if (result) {
      await Promise.all(
        result.removedParticipants.map((participant) =>
          this.cancelParticipantWork(participant.id, "Participant removed from room")
        ),
      );
      for (const participant of result.removedParticipants) {
        const conversation = this.repo.getConversation(participant.conversationId);
        this.events.emit({
          type: "participant.updated",
          roomId: conversation?.roomId ?? null,
          conversationId: participant.conversationId,
          payload: { participant },
        });
      }
      this.events.emit({
        type: "identity.deleted",
        payload: { identityId, removedParticipants: result.removedParticipants },
      });
    }
    return result?.identity ?? null;
  }

  addParticipant(conversationId: string, input: AddParticipantRequest) {
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const participant = this.repo.addParticipantFromIdentity(conversationId, {
      ...input,
      listenMode: input.listenMode ?? DEFAULT_PARTICIPANT_LISTEN_MODE,
    });
    this.materializeParticipant(conversation, participant);
    this.events.emit({
      type: "participant.created",
      roomId: conversation.roomId,
      conversationId,
      payload: { participant, runtimeProfile: this.getRuntimeProfile(participant.runtimeProfileId) },
    });
    const systemMessage = this.emitSystemNotice(conversation, `${participant.displayName} joined the room`);
    return { participant, systemMessage };
  }

  updateParticipant(participantId: string, input: UpdateParticipantRequest) {
    const current = this.repo.getParticipant(participantId);
    if (!current || current.status === "removed") return null;
    const conversation = this.repo.getConversation(current.conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const identity = input.identityId === undefined ? null : this.repo.getIdentity(input.identityId);
    if (input.identityId !== undefined && !identity) throw new Error("Identity not found");

    let nextInput: UpdateParticipantRequest = { ...input };
    const runtimeProfileId = input.runtimeProfileId ?? current.runtimeProfileId;
    if (runtimeProfileId) {
      const baseProfile = this.repo.getRuntimeProfile(runtimeProfileId);
      if (!baseProfile) throw new Error("Runtime profile not found");
      const canonicalProfile = this.resolveCanonicalRuntimeProfile(baseProfile);
      if (input.model !== undefined) {
        const resolvedProfile = this.repo.ensureRuntimeProfileForModel(canonicalProfile, input.model);
        nextInput = { ...nextInput, runtimeProfileId: resolvedProfile.id };
      } else if (input.runtimeProfileId !== undefined) {
        nextInput = { ...nextInput, runtimeProfileId: canonicalProfile.id };
      }
    } else if (input.runtimeProfileId !== undefined) {
      throw new Error("Runtime profile not found");
    }

    const participant = this.repo.updateParticipant(participantId, {
      ...nextInput,
      displayName: nextInput.displayName ?? (identity && identity.id !== current.identityId ? identity.name : undefined),
    });
    if (participant) {
      this.materializeParticipant(conversation, participant);
      this.events.emit({
        type: "participant.updated",
        roomId: conversation.roomId,
        conversationId: conversation.id,
        payload: { participant, runtimeProfile: this.getRuntimeProfile(participant.runtimeProfileId) },
      });
    }
    return participant;
  }

  getRuntimeProfile(runtimeProfileId: string | null | undefined) {
    return runtimeProfileId ? this.repo.getRuntimeProfile(runtimeProfileId) : null;
  }

  updateConversationRules(conversationId: string, input: UpdateConversationRulesRequest) {
    const result = this.repo.updateConversationRules(conversationId, input);
    if (result) {
      this.materializeParticipants(result.conversation, this.repo.listParticipants(result.conversation.id));
      this.events.emit({
        type: "conversation.updated",
        roomId: result.conversation.roomId,
        conversationId: result.conversation.id,
        payload: { conversation: result.conversation },
      });
    }
    return result;
  }

  listCollaborationRuleEvents(conversationId: string) {
    return this.repo.listCollaborationRuleEvents(conversationId);
  }

  updateConversationPolicy(conversationId: string, input: UpdateConversationPolicyRequest) {
    const normalized = normalizeReplyPolicy(input.replyPolicy);
    const conversation = this.repo.updateConversationPolicy(conversationId, { replyPolicy: normalized });
    if (conversation) {
      this.materializeParticipants(conversation, this.repo.listParticipants(conversation.id));
      this.events.emit({
        type: "conversation.updated",
        roomId: conversation.roomId,
        conversationId: conversation.id,
        payload: { conversation },
      });
    }
    return conversation;
  }

  updateConversationPinned(conversationId: string, pinned: boolean) {
    const conversation = this.repo.updateConversationPinned(conversationId, pinned);
    if (conversation) {
      this.materializeParticipants(conversation, this.repo.listParticipants(conversation.id));
      this.events.emit({
        type: "conversation.updated",
        roomId: conversation.roomId,
        conversationId: conversation.id,
        payload: { conversation },
      });
    }
    return conversation;
  }

  uploadArtifact(conversationId: string, input: UploadArtifactRequest) {
    const artifact = this.repo.createArtifact(conversationId, input);
    this.events.emit({
      type: "artifact.created",
      roomId: artifact.roomId,
      conversationId,
      payload: { artifact },
    });
    return artifact;
  }

  prepareArtifactUpload(conversationId: string, filename: string) {
    return this.repo.prepareArtifactUpload(conversationId, filename);
  }

  uploadArtifactFromFile(conversationId: string, input: { filename: string; mimeType: string; localPath: string }) {
    const artifact = this.repo.createArtifactFromFile(conversationId, input);
    this.events.emit({
      type: "artifact.created",
      roomId: artifact.roomId,
      conversationId,
      payload: { artifact },
    });
    return artifact;
  }

  async cancelRun(runId: string, reason = "Cancelled by user") {
    const run = this.repo.getAgentRun(runId);
    if (!run) return null;
    if (!["accepted", "running"].includes(run.status)) {
      return { run };
    }
    this.cancelledRunIds.add(runId);
    const participant = run.participantId ? this.repo.getParticipant(run.participantId) : null;
    const runtimeProfile = participant?.runtimeProfileId ? this.repo.getRuntimeProfile(participant.runtimeProfileId) : null;
    const provider = this.runtimes.getProvider(runtimeProfile);
    await provider.cancel(runId).catch(() => undefined);
    return this.finalizeRunCancellation(runId, reason);
  }

  private async cancelRunsForTriggerMessage(triggerMessageId: string) {
    const runs = this.repo.listActiveAgentRunsForTriggerMessage(triggerMessageId);
    await Promise.all(runs.map((run) => this.cancelRun(run.id)));
  }

  private async cancelRunsForParticipant(participantId: string, reason: string) {
    this.repo.deletePendingRepliesForParticipant(participantId);
    const runs = this.repo.listActiveAgentRunsForParticipant(participantId);
    await Promise.all(runs.map((run) => this.cancelRun(run.id, reason)));
  }

  private async cancelPrivateTasksForParticipant(participantId: string, reason: string) {
    const taskIds = [...this.activePrivateTasks.entries()]
      .filter(([, task]) => task.participantId === participantId)
      .map(([taskId]) => taskId);
    await Promise.all(taskIds.map((taskId) => this.cancelPrivateTask(taskId, reason)));
  }

  private async cancelParticipantWork(participantId: string, reason: string) {
    await Promise.all([
      this.cancelRunsForParticipant(participantId, reason),
      this.cancelPrivateTasksForParticipant(participantId, reason),
    ]);
  }

  setParticipantMuted(participantId: string, muted: boolean) {
    const participant = this.repo.updateParticipantStatus(participantId, muted ? "muted" : "active");
    if (participant) {
      const conversation = this.repo.getConversation(participant.conversationId);
      this.events.emit({
        type: "participant.updated",
        roomId: conversation?.roomId ?? null,
        conversationId: participant.conversationId,
        payload: { participant },
      });
    }
    return participant;
  }

  setParticipantListenMode(participantId: string, listenMode: ParticipantListenMode) {
    const participant = this.repo.updateParticipantListenMode(participantId, listenMode);
    if (participant) {
      const conversation = this.repo.getConversation(participant.conversationId);
      if (conversation) this.materializeParticipant(conversation, participant);
      this.events.emit({
        type: "participant.updated",
        roomId: conversation?.roomId ?? null,
        conversationId: participant.conversationId,
        payload: { participant },
      });
    }
    return participant;
  }

  async removeParticipant(participantId: string) {
    const participant = this.repo.updateParticipantStatus(participantId, "removed");
    if (participant) {
      await this.cancelParticipantWork(participant.id, "Participant removed from room");
      const conversation = this.repo.getConversation(participant.conversationId);
      this.events.emit({
        type: "participant.updated",
        roomId: conversation?.roomId ?? null,
        conversationId: participant.conversationId,
        payload: { participant },
      });
    }
    return participant;
  }

  sendMessage(conversationId: string, input: SendMessageRequest) {
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const content = input.content.trim();
    const orderedParts = input.parts?.filter((part) =>
      part.type === "artifact" ? Boolean(part.artifactId) : Boolean(part.content.trim()),
    ) ?? [];
    if (!content && !input.artifactIds?.length && !orderedParts.some((part) => part.type === "artifact")) {
      throw new Error("Message content is required");
    }

    const message = this.repo.createMessage({
      conversationId,
      role: "user",
      senderName: normalizeUserSenderName(input.senderName),
      content,
      mentions: this.normalizeMentions(conversationId, input.mentions ?? []),
      visibility: input.visibility === "whisper" ? "whisper" : "public",
      status: "success",
      parentMessageId: input.parentMessageId ?? null,
    });
    const blocks = [];
    const artifacts = [];
    this.repo.touchConversation(conversationId, content || "Attached files");
    this.events.emit({
      type: "message.created",
      roomId: conversation.roomId,
      conversationId,
      payload: { message },
    });
    const parts = orderedParts.length > 0
      ? orderedParts
      : [
          ...(content ? [{ type: "text" as const, content }] : []),
          ...(input.artifactIds ?? []).map((artifactId) => ({ type: "artifact" as const, artifactId })),
        ];
    for (const [index, part] of parts.entries()) {
      if (part.type === "text") {
        const block = this.repo.createMessageBlock({
          messageId: message.id,
          type: "main_text",
          content: part.content,
          sortOrder: index,
        });
        blocks.push(block);
        this.events.emit({
          type: "message_block.created",
          roomId: conversation.roomId,
          conversationId,
          payload: { block },
        });
        continue;
      }
      const artifactId = part.artifactId;
      const artifact = this.repo.attachArtifactToMessage(artifactId, message.id);
      if (!artifact) continue;
      artifacts.push(artifact);
      const block = this.repo.createMessageBlock({
        messageId: message.id,
        type: artifact.mimeType.startsWith("image/") ? "image" : "file",
        content: artifact.textPreview ?? "",
        metadata: { artifactId: artifact.id },
        sortOrder: index,
      });
      blocks.push(block);
      this.events.emit({
        type: "artifact.created",
        roomId: conversation.roomId,
        conversationId,
        payload: { artifact },
      });
      this.events.emit({
        type: "message_block.created",
        roomId: conversation.roomId,
        conversationId,
        payload: { block },
      });
    }

    const mentions = input.mentions ?? [];
    const targets = this.resolveTargets(conversation, mentions, content);
    this.materializeParticipants(conversation, targets);
    void this.generateReplies(conversation.roomId, conversationId, message, targets, {
      currentRound: 1,
      maxRounds: input.maxReplyRounds
        ? clampInteger(input.maxReplyRounds, 1, 8)
        : maxReplyRoundsForTrigger(conversation, mentions),
      order: resolveReplySpeakingOrder(conversation, mentions),
      seenParticipantIds: new Set(targets.map((participant) => participant.id)),
      mentionScoped: isParticipantMentionScoped(message.mentions),
    });
    return { message, blocks, artifacts, targets };
  }

  runPrivateTask(conversationId: string, input: PrivateTaskRequest) {
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const participant = this.repo.getParticipant(input.participantId);
    if (!participant || participant.conversationId !== conversationId) throw new Error("Participant not found");
    if (participant.status === "removed") throw new Error("Participant not found");
    const sourceMessage = input.sourceMessageId ? this.repo.getMessage(input.sourceMessageId) : null;
    if (input.sourceMessageId && !sourceMessage) throw new Error("Source message not found");
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Prompt is required");

    const taskId = nanoid();
    const now = new Date().toISOString();
    const syntheticUserMessage: Message = {
      id: sourceMessage?.id ?? `private-user-${taskId}`,
      conversationId,
      role: "user",
      senderParticipantId: null,
      senderName: "You",
      content: prompt,
      mentions: [{
        participantId: participant.id,
        displayNameSnapshot: participant.displayName,
        mentionType: "participant",
      }],
      visibility: "public",
      status: "success",
      branchId: sourceMessage?.branchId ?? null,
      parentMessageId: sourceMessage?.id ?? null,
      runId: null,
      tokenUsage: null,
      createdAt: now,
      updatedAt: now,
    };

    void this.executePrivateTask({
      taskId,
      roomId: conversation.roomId,
      conversationId,
      participant,
      userMessage: syntheticUserMessage,
      taskType: input.taskType ?? "summary",
      sourceMessageId: sourceMessage?.id ?? null,
      sourceMessageIds: input.sourceMessageIds?.length
        ? input.sourceMessageIds
        : sourceMessage?.id
          ? [sourceMessage.id]
          : [],
      sourcePreview: compactTaskPreview(sourceMessage?.content ?? prompt),
    });

    return { taskId };
  }

  getPrivateTask(taskId: string) {
    return this.repo.getPrivateTask(taskId);
  }

  listPrivateTasksForConversation(conversationId: string) {
    return this.repo.listPrivateTasksForConversation(conversationId);
  }

  async cancelPrivateTask(taskId: string, reason = "Cancelled by user") {
    this.cancelledPrivateTaskIds.add(taskId);
    await this.activePrivateTasks.get(taskId)?.cancel(reason);
    this.activePrivateTasks.delete(taskId);
    return { taskId, cancelled: true };
  }

  async updateMessage(messageId: string, input: UpdateMessageRequest) {
    const current = this.repo.getMessage(messageId);
    if (!current) return null;
    const conversation = this.repo.getConversation(current.conversationId);
    if (!conversation) return null;
    if (input.status === "recalled") {
      if (current.role !== "user") {
        throw new Error("Only your own messages can be recalled");
      }
      const result = this.repo.markMessageStatus(messageId, input.status);
      if (!result?.message) return null;
      this.repo.deletePendingRepliesForMessage(messageId);
      await this.cancelRunsForTriggerMessage(messageId);
      this.repo.touchConversation(conversation.id, "Message recalled");
      this.events.emit({
        type: "message.updated",
        roomId: conversation.roomId,
        conversationId: conversation.id,
        payload: { message: result.message },
      });
      for (const block of result.blocks) {
        this.events.emit({
          type: "message_block.updated",
          roomId: conversation.roomId,
          conversationId: conversation.id,
          payload: { block },
        });
      }
      return { message: result.message, blocks: result.blocks, targets: [] };
    }

    const result = this.repo.updateUserMessage(messageId, input);
    if (!result?.message) return null;
    const replacement = input.parts?.length
      ? this.repo.replaceUserMessageBlocks(messageId, input.parts)
      : null;
    this.repo.touchConversation(conversation.id, result.message.content);
    this.events.emit({
      type: "message.updated",
      roomId: conversation.roomId,
      conversationId: conversation.id,
      payload: { message: result.message },
    });
    if (replacement) {
      for (const artifact of replacement.artifacts) {
        this.events.emit({
          type: "artifact.created",
          roomId: conversation.roomId,
          conversationId: conversation.id,
          payload: { artifact },
        });
      }
      for (const block of replacement.blocks) {
        this.events.emit({
          type: "message_block.created",
          roomId: conversation.roomId,
          conversationId: conversation.id,
          payload: { block },
        });
      }
    } else if (result.block) {
      this.events.emit({
        type: "message_block.updated",
        roomId: conversation.roomId,
        conversationId: conversation.id,
        payload: { block: result.block },
      });
    }
    const targets = this.resolveTargets(conversation, result.message.mentions, result.message.content);
    void this.generateReplies(conversation.roomId, conversation.id, result.message, targets, {
      currentRound: 1,
      maxRounds: maxReplyRoundsForTrigger(conversation, result.message.mentions),
      order: resolveReplySpeakingOrder(conversation, result.message.mentions),
      seenParticipantIds: new Set(targets.map((participant) => participant.id)),
      mentionScoped: isParticipantMentionScoped(result.message.mentions),
    });
    return {
      message: result.message,
      blocks: replacement ? replacement.blocks : result.block ? [result.block] : [],
      artifacts: replacement?.artifacts ?? [],
      targets,
    };
  }

  hideMessageForLocalUser(messageId: string) {
    const current = this.repo.getMessage(messageId);
    if (!current) return null;
    const conversation = this.repo.getConversation(current.conversationId);
    if (!conversation) return null;
    this.repo.hideMessageForLocalUser(messageId, current.conversationId);
    this.events.emit({
      type: "message.hidden",
      roomId: conversation.roomId,
      conversationId: conversation.id,
      payload: { messageId },
    });
    return { messageId, hidden: true as const };
  }

  resolveMessageDeepLink(messageId: string, conversationIdHint?: string | null) {
    const normalizedMessageId = messageId.trim();
    if (!normalizedMessageId) {
      return { outcome: "not_found" as const };
    }

    const message = this.repo.getMessage(normalizedMessageId);
    const hiddenConversationId = this.repo.getHiddenMessageConversationId(normalizedMessageId);
    const hintedConversationId = conversationIdHint?.trim() || null;
    const conversationId = message?.conversationId ?? hiddenConversationId ?? hintedConversationId;
    if (!conversationId) {
      return { outcome: "not_found" as const };
    }

    const conversation = this.repo.getConversation(conversationId);
    if (!conversation || !this.repo.getRoom(conversation.roomId)) {
      return { outcome: "room_deleted" as const };
    }

    if (
      !message
      || message.status === "deleted"
      || message.status === "recalled"
      || hiddenConversationId
    ) {
      return { outcome: "message_unavailable" as const, conversationId };
    }

    return {
      outcome: "ok" as const,
      conversationId,
      messageId: normalizedMessageId,
    };
  }

  private normalizeMentions(conversationId: string, mentions: NonNullable<SendMessageRequest["mentions"]>) {
    const participants = this.repo.listParticipants(conversationId);
    const byId = new Map(participants.map((participant) => [participant.id, participant]));
    return mentions
      .map((mention) => {
        if (mention.mentionType === "reference") {
          return sanitizeMentionTargetForAgentContext({
            participantId: mention.participantId,
            displayNameSnapshot: mention.displayNameSnapshot,
            mentionType: mention.mentionType,
            referenceProviderId: mention.referenceProviderId,
            referenceEntityId: mention.referenceEntityId,
            referenceScope: mention.referenceScope,
            referenceInsert: mention.referenceInsert,
          });
        }
        if (mention.mentionType === "all") {
          return {
            participantId: mention.participantId,
            displayNameSnapshot: mention.displayNameSnapshot,
            mentionType: mention.mentionType,
          };
        }
        const participant = byId.get(mention.participantId);
        if (!participant) return null;
        return {
          participantId: mention.participantId,
          displayNameSnapshot: participant.displayName,
          mentionType: mention.mentionType,
        };
      })
      .filter((mention): mention is NonNullable<typeof mention> => mention !== null);
  }

  private materializeExistingWorkspaces() {
    const snapshot = this.repo.snapshot();
    for (const identity of snapshot.identities) {
      this.workspaces.materializeIdentity(identity);
    }
    for (const participant of snapshot.participants) {
      if (participant.status === "removed") continue;
      const conversation = snapshot.conversations.find((item) => item.id === participant.conversationId);
      if (conversation) this.materializeParticipant(conversation, participant);
    }
  }

  private backfillAssistantFilePathArtifacts() {
    const snapshot = this.repo.snapshot();
    const conversationsById = new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation]));
    const runsById = new Map(snapshot.agentRuns.map((run) => [run.id, run]));
    for (const message of snapshot.messages) {
      if (message.role !== "assistant" || !message.runId) continue;
      const conversation = conversationsById.get(message.conversationId);
      if (!conversation) continue;
      const run = runsById.get(message.runId);
      const paths = extractLocalFilePathsFromContent(message.content);
      if (!paths.length) continue;
      const fileArtifacts = this.importRunFileWriteArtifacts({
        roomId: conversation.roomId,
        conversationId: conversation.id,
        runId: message.runId,
        messageId: message.id,
        participantId: run?.participantId ?? null,
        paths,
      });
      if (!fileArtifacts.length) continue;
      const nextContent = linkRunFileArtifactPathsInContent(message.content, fileArtifacts);
      if (nextContent === message.content) continue;
      const updatedMessage = this.repo.updateMessage(message.id, { content: nextContent });
      if (updatedMessage) {
        this.events.emit({
          type: "message.updated",
          roomId: conversation.roomId,
          conversationId: conversation.id,
          runId: message.runId,
          payload: { message: updatedMessage },
        });
      }
      for (const block of this.repo.listMessageBlocks(message.id).filter((item) => item.type === "main_text")) {
        const updatedBlock = this.repo.updateMessageBlock(block.id, { content: nextContent });
        if (!updatedBlock) continue;
        this.events.emit({
          type: "message_block.updated",
          roomId: conversation.roomId,
          conversationId: conversation.id,
          runId: message.runId,
          payload: { block: updatedBlock },
        });
      }
    }
  }

  private scheduleBootstrapMaintenance() {
    if (this.bootstrapMaintenanceStarted) return;
    this.bootstrapMaintenanceStarted = true;
    setTimeout(() => {
      try {
        this.materializeExistingWorkspaces();
        this.recoverReplyQueueOnce();
      } catch (error) {
        this.bootstrapMaintenanceStarted = false;
        console.warn("[chat-service] bootstrap maintenance failed", error);
      }
    }, 0);
  }

  private materializeParticipants(conversation: Conversation, participants: Participant[]) {
    for (const participant of participants) {
      if (participant.status !== "removed") this.materializeParticipant(conversation, participant);
    }
  }

  private materializeParticipant(conversation: Conversation, participant: Participant) {
    const identity = participant.identityId ? this.repo.getIdentity(participant.identityId) : null;
    if (identity) this.workspaces.materializeIdentity(identity);
    this.workspaces.materializeParticipant({ conversation, participant, identity });
  }

  private emitSystemNotice(conversation: Conversation, content: string) {
    const message = this.repo.createMessage({
      conversationId: conversation.id,
      role: "system",
      content,
      status: "success",
    });
    this.events.emit({
      type: "message.created",
      roomId: conversation.roomId,
      conversationId: conversation.id,
      payload: { message },
    });
    return message;
  }

  private recoverReplyQueueOnce() {
    if (this.recoveredReplyQueue) return;
    this.recoveredReplyQueue = true;
    this.failInterruptedRuns();
    for (const item of this.repo.listPendingReplies()) {
      const pending = this.repo.consumePendingReply(item.conversationId, item.participantId);
      if (!pending) continue;
      const participant = this.repo.getParticipant(pending.participantId);
      const message = this.repo.getMessage(pending.messageId);
      const conversation = this.repo.getConversation(pending.conversationId);
      if (!participant || participant.kind !== "ai" || participant.status !== "active") continue;
      if (!message || !conversation) continue;
      void this.scheduleReply(pending.roomId, pending.conversationId, message, participant);
    }
  }

  private failInterruptedRuns() {
    const errorText = "Interrupted by server restart";
    for (const run of this.repo.listActiveAgentRuns()) {
      const finalRun = this.repo.updateAgentRun(run.id, { status: "failed", error: errorText });
      if (run.assistantMessageId) {
        const currentMessage = this.repo.getMessage(run.assistantMessageId);
        const finalMessage = this.repo.updateMessage(run.assistantMessageId, {
          content: currentMessage?.content || errorText,
          status: "error",
        });
        for (const block of this.repo.listMessageBlocks(run.assistantMessageId)) {
          if (block.status !== "streaming" && block.status !== "pending") continue;
          const finalBlock = this.repo.updateMessageBlock(block.id, {
            content: block.content || errorText,
            status: "error",
          });
          if (finalBlock) {
            this.events.emit({
              type: "message_block.updated",
              roomId: run.roomId,
              conversationId: run.conversationId,
              runId: run.id,
              payload: { block: finalBlock },
            });
          }
        }
        if (finalMessage) {
          this.events.emit({
            type: "message.updated",
            roomId: run.roomId,
            conversationId: run.conversationId,
            runId: run.id,
            payload: { message: finalMessage },
          });
        }
      }
      if (finalRun) {
        this.events.emit({
          type: "run.failed",
          roomId: run.roomId,
          conversationId: run.conversationId,
          runId: run.id,
          payload: { run: finalRun },
        });
      }
      this.toolTokens.revokeRun(run.id);
    }
  }

  private resolveTargets(
    conversation: Conversation,
    mentions: NonNullable<SendMessageRequest["mentions"]>,
    userText: string,
  ) {
    const activeAi = this.repo
      .listParticipants(conversation.id)
      .filter((participant) => participant.kind === "ai" && participant.status === "active");
    if (mentions.some((mention) => mention.mentionType === "all")) return [];
    const mentionedIds = new Set(mentions.map((mention) => mention.participantId));
    if (mentionedIds.size > 0) return activeAi.filter((participant) => mentionedIds.has(participant.id));
    if (conversation.replyPolicy.mode === "mentioned" || conversation.replyPolicy.mode === "selected") return [];
    return activeAi.filter((participant) => shouldAutoReply(participant, userText));
  }

  private async generateReplies(
    roomId: string,
    conversationId: string,
    userMessage: Message,
    targets: Participant[],
    options: {
      currentRound: number;
      maxRounds: number;
      order: SpeakingOrder;
      seenParticipantIds: Set<string>;
      mentionScoped?: boolean;
    },
  ) {
    const orderedTargets = orderTargets(targets, options.order);
    const effectiveOrder = orderedTargets.length > 1 ? "parallel" : options.order;
    if (effectiveOrder === "parallel") {
      const preacceptedRuns = new Map<string, AgentRun>();
      for (const participant of orderedTargets) {
        const run = this.createAcceptedAgentRun(roomId, conversationId, userMessage, participant);
        if (run) preacceptedRuns.set(participant.id, run);
      }
      const replies = await Promise.all(
        orderedTargets.map(async (participant) => ({
          assistantMessage: await this.scheduleReply(
            roomId,
            conversationId,
            userMessage,
            participant,
            preacceptedRuns.get(participant.id) ?? null,
          ),
        })),
      );
      for (const { assistantMessage } of replies) {
        await this.generateFollowupReplies(roomId, conversationId, assistantMessage, options);
      }
      return;
    }

    for (const participant of orderedTargets) {
      const assistantMessage = await this.scheduleReply(roomId, conversationId, userMessage, participant);
      await this.generateFollowupReplies(roomId, conversationId, assistantMessage, options);
    }
  }

  private async generateFollowupReplies(
    roomId: string,
    conversationId: string,
    assistantMessage: Message | null | undefined,
    options: {
      currentRound: number;
      maxRounds: number;
      order: SpeakingOrder;
      seenParticipantIds: Set<string>;
      mentionScoped?: boolean;
    },
  ) {
    if (!assistantMessage || options.currentRound >= options.maxRounds) return;
    const followupTargets = this.resolveFollowupTargets(
      conversationId,
      assistantMessage,
      options.seenParticipantIds,
      options.mentionScoped ?? false,
    );
    for (const followupTarget of followupTargets) {
      options.seenParticipantIds.add(followupTarget.id);
    }
    await this.generateReplies(roomId, conversationId, assistantMessage, followupTargets, {
      currentRound: options.currentRound + 1,
      maxRounds: options.maxRounds,
      order: options.order,
      seenParticipantIds: options.seenParticipantIds,
    });
  }

  private async scheduleReply(
    roomId: string,
    conversationId: string,
    userMessage: Message,
    participant: Participant,
    preacceptedRun: AgentRun | null = null,
  ) {
    const key = replyScheduleKey(conversationId, participant.id);
    if (this.activeReplyKeys.has(key)) {
      this.repo.upsertPendingReply({
        roomId,
        conversationId,
        participantId: participant.id,
        messageId: userMessage.id,
      });
      return;
    }

    this.activeReplyKeys.add(key);
    let requestedReply: Message | null = null;
    try {
      let nextMessage: Message | null = userMessage;
      while (nextMessage) {
        const currentParticipant = this.repo.getParticipant(participant.id);
        if (!currentParticipant || currentParticipant.status !== "active") {
          this.repo.deletePendingRepliesForParticipant(participant.id);
          break;
        }
        const latest = this.repo.getMessage(nextMessage.id);
        if (!latest || latest.status === "recalled") break;
        const generated = await this.generateForParticipant(
          roomId,
          conversationId,
          latest,
          currentParticipant,
          nextMessage.id === userMessage.id ? preacceptedRun : null,
        );
        if (nextMessage.id === userMessage.id) requestedReply = generated;
        const pending = this.repo.consumePendingReply(conversationId, participant.id);
        if (!pending) {
          nextMessage = null;
          continue;
        }
        nextMessage = this.repo.getMessage(pending.messageId);
      }
    } finally {
      this.activeReplyKeys.delete(key);
    }
    return requestedReply;
  }

  private resolveFollowupTargets(
    conversationId: string,
    assistantMessage: Message,
    seenParticipantIds: Set<string>,
    mentionScoped: boolean,
  ) {
    if (!assistantMessage.content.trim()) return [];
    if (mentionScoped) return [];
    if (assistantMessage.visibility === "whisper") return [];
    const senderParticipantId = assistantMessage.senderParticipantId;
    return this.repo
      .listParticipants(conversationId)
      .filter((participant) => {
        if (participant.kind !== "ai" || participant.status !== "active") return false;
        if (participant.id === senderParticipantId) return false;
        if (seenParticipantIds.has(participant.id)) return false;
        return shouldAutoReply(participant, assistantMessage.content);
      });
  }

  private createAcceptedAgentRun(
    roomId: string,
    conversationId: string,
    userMessage: Message,
    participant: Participant,
  ): AgentRun | null {
    const latestUserMessage = this.repo.getMessage(userMessage.id);
    if (!latestUserMessage || latestUserMessage.status === "recalled") return null;
    const currentParticipant = this.repo.getParticipant(participant.id);
    if (!currentParticipant || currentParticipant.status !== "active") return null;
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation) return null;
    const runtimeProfile = currentParticipant.runtimeProfileId ? this.repo.getRuntimeProfile(currentParticipant.runtimeProfileId) : null;
    const identity = currentParticipant.identityId ? this.repo.getIdentity(currentParticipant.identityId) : null;
    const attachments = this.repo.listArtifactsForMessage(userMessage.id);
    const recentMessages = this.repo
      .listRecentMessages(conversationId, 24)
      .filter((message) => isMessageVisibleToParticipant(message, currentParticipant.id));
    const provider = this.runtimes.getProvider(runtimeProfile);
    const runtimeContext: RuntimeReplyContext = {
      conversation,
      participant: currentParticipant,
      identity,
      runtimeProfile,
      userMessage: latestUserMessage,
      recentMessages,
      attachments,
    };
    const runDescriptor = provider.describeRun(runtimeContext);
    const run = this.repo.createAgentRun({
      roomId,
      conversationId,
      participantId: currentParticipant.id,
      assistantMessageId: null,
      triggerMessageId: latestUserMessage.id,
      runtime: runDescriptor.runtime,
      provider: runDescriptor.provider,
      model: runDescriptor.model,
      visibility: latestUserMessage.visibility,
    });
    this.events.emit({
      type: "run.accepted",
      roomId,
      conversationId,
      runId: run.id,
      payload: { run },
    });
    this.repo.updateAgentRun(run.id, { status: "running" });
    this.events.emit({
      type: "run.started",
      roomId,
      conversationId,
      runId: run.id,
      payload: { run: this.repo.getAgentRun(run.id) },
    });
    return run;
  }

  private async generateForParticipant(
    roomId: string,
    conversationId: string,
    userMessage: Message,
    participant: Participant,
    preacceptedRun: AgentRun | null = null,
  ): Promise<Message | null> {
    const latestUserMessage = this.repo.getMessage(userMessage.id);
    if (!latestUserMessage || latestUserMessage.status === "recalled") return null;
    const currentParticipant = this.repo.getParticipant(participant.id);
    if (!currentParticipant || currentParticipant.status !== "active") {
      if (preacceptedRun && ["accepted", "running"].includes(preacceptedRun.status)) {
        await this.cancelRun(preacceptedRun.id, "Participant removed from room");
      }
      return null;
    }
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation) return null;
    const runtimeProfile = currentParticipant.runtimeProfileId ? this.repo.getRuntimeProfile(currentParticipant.runtimeProfileId) : null;
    const identity = currentParticipant.identityId ? this.repo.getIdentity(currentParticipant.identityId) : null;
    const attachments = this.repo.listArtifactsForMessage(userMessage.id);
    const recentMessages = this.repo
      .listRecentMessages(conversationId, 24)
      .filter((message) => isMessageVisibleToParticipant(message, currentParticipant.id));
    const provider = this.runtimes.getProvider(runtimeProfile);
    const runtimeContext: RuntimeReplyContext = {
      conversation,
      participant: currentParticipant,
      identity,
      runtimeProfile,
      userMessage: latestUserMessage,
      recentMessages,
      attachments,
    };
    const runDescriptor = provider.describeRun(runtimeContext);
    const run = preacceptedRun
      ?? this.repo.createAgentRun({
        roomId,
        conversationId,
        participantId: currentParticipant.id,
        assistantMessageId: null,
        triggerMessageId: latestUserMessage.id,
        runtime: runDescriptor.runtime,
        provider: runDescriptor.provider,
        model: runDescriptor.model,
        visibility: latestUserMessage.visibility,
      });
    const currentRun = this.repo.getAgentRun(run.id);
    if (!currentRun || currentRun.status === "cancelled") return null;
    if (!preacceptedRun) {
      this.events.emit({
        type: "run.accepted",
        roomId,
        conversationId,
        runId: run.id,
        payload: { run },
      });
    }
    runtimeContext.runId = run.id;
    runtimeContext.toolAccess = this.toolTokens.issue({
      runId: run.id,
      participantId: currentParticipant.id,
      conversationId,
    });

    if (!preacceptedRun) {
      this.repo.updateAgentRun(run.id, { status: "running" });
    }
    const visibleReply: { message: Message | null; block: MessageBlock | null } = {
      message: null,
      block: null,
    };
    let nextRunEventSortOrder = 0;
    const runtimeEvents = {
      toolCalls: new Map<string, string>(),
    };
    const thinkingState = {
      runEventId: null as string | null,
      reasoningBlockId: null as string | null,
      content: "",
    };
    if (!preacceptedRun) {
      this.events.emit({
        type: "run.started",
        roomId,
        conversationId,
        runId: run.id,
        payload: { run: this.repo.getAgentRun(run.id) },
      });
    }

    let content = "";
    let deferredAssistantText = "";
    const deferAssistantTextToThinking = provider.id === "local-agent";
    const runFileWritePaths = new Set<string>();
    const createRunEvent = (
      type: Parameters<ChatRepository["createAgentRunEvent"]>[0]["type"],
      input: Omit<Parameters<ChatRepository["createAgentRunEvent"]>[0], "runId" | "conversationId" | "type"> = {},
    ) => {
      ensureAssistantMessage();
      const runEvent = this.repo.createAgentRunEvent({
        runId: run.id,
        conversationId,
        type,
        sortOrder: nextRunEventSortOrder++,
        ...input,
      });
      this.events.emit({
        type: "run.event.created",
        roomId,
        conversationId,
        runId: run.id,
        payload: { event: runEvent },
      });
      return runEvent;
    };

    const emitBlockCreated = (createdBlock: MessageBlock) => {
      this.events.emit({
        type: "message_block.created",
        roomId,
        conversationId,
        runId: run.id,
        payload: { block: createdBlock },
      });
    };
    const emitBlockUpdated = (updatedBlock: MessageBlock | null) => {
      if (!updatedBlock) return;
      this.events.emit({
        type: "message_block.updated",
        roomId,
        conversationId,
        runId: run.id,
        payload: { block: updatedBlock },
      });
    };
    const ensureAssistantMessage = () => {
      if (visibleReply.message && visibleReply.block) {
        return { assistantMessage: visibleReply.message, block: visibleReply.block };
      }
      visibleReply.message = this.repo.createMessage({
        conversationId,
        role: "assistant",
        senderParticipantId: currentParticipant.id,
        senderName: currentParticipant.displayName,
        content: "",
        visibility: userMessage.visibility,
        status: "streaming",
        runId: run.id,
      });
      visibleReply.block = this.repo.createMessageBlock({
        messageId: visibleReply.message.id,
        type: "main_text",
        content: "",
        status: "streaming",
      });
      this.repo.updateAgentRun(run.id, { assistantMessageId: visibleReply.message.id, status: "running" });
      this.events.emit({
        type: "message.created",
        roomId,
        conversationId,
        runId: run.id,
        payload: { message: visibleReply.message },
      });
      emitBlockCreated(visibleReply.block);
      return { assistantMessage: visibleReply.message, block: visibleReply.block };
    };
    const emitRunEventUpdated = (runEvent: AgentRunEvent | null) => {
      if (!runEvent) return;
      this.events.emit({
        type: "run.event.created",
        roomId,
        conversationId,
        runId: run.id,
        payload: { event: runEvent },
      });
    };
    const appendThinking = (text: string, finalize = false) => {
      if (text) thinkingState.content += text;
      if (!thinkingState.content && !thinkingState.runEventId && !thinkingState.reasoningBlockId) return;

      const visible = ensureAssistantMessage();
      const status = finalize ? "success" : "streaming";

      if (thinkingState.runEventId) {
        emitRunEventUpdated(
          this.repo.updateAgentRunEvent(thinkingState.runEventId, {
            content: thinkingState.content,
            status,
          }),
        );
      } else if (thinkingState.content) {
        const runEvent = createRunEvent("thinking_delta", {
          content: thinkingState.content,
          status,
        });
        thinkingState.runEventId = runEvent.id;
      }

      if (thinkingState.reasoningBlockId) {
        emitBlockUpdated(
          this.repo.updateMessageBlock(thinkingState.reasoningBlockId, {
            content: thinkingState.content,
            status,
          }),
        );
      } else if (thinkingState.content) {
        const block = this.repo.createMessageBlock({
          messageId: visible.assistantMessage.id,
          type: "reasoning",
          content: thinkingState.content,
          status,
          sortOrder: -1,
        });
        thinkingState.reasoningBlockId = block.id;
        emitBlockCreated(block);
      }
    };
    const emitToken = (token: string) => {
      const visible = ensureAssistantMessage();
      content += token;
      const updatedBlock = this.repo.updateMessageBlock(visible.block.id, {
        content,
        status: "streaming",
      });
      const updatedMessage = this.repo.updateMessage(visible.assistantMessage.id, {
        content,
        status: "streaming",
      });
      this.events.emit({
        type: "run.delta",
        roomId,
        conversationId,
        runId: run.id,
        payload: { messageId: visible.assistantMessage.id, blockId: visible.block.id, delta: token },
      });
      if (updatedBlock) {
        emitBlockUpdated(updatedBlock);
      }
      if (updatedMessage) {
        this.events.emit({
          type: "message.updated",
          roomId,
          conversationId,
          runId: run.id,
          payload: { message: updatedMessage },
        });
      }
    };
    const emitRuntimeEvent = (event: RuntimeStreamEvent) => {
      if (event.type === "text_delta") {
        if (deferAssistantTextToThinking) {
          deferredAssistantText += event.text;
          return;
        }
        emitToken(event.text);
        return;
      }
      if (event.type === "thinking_delta") {
        appendThinking(event.text);
        return;
      }
      if (event.type === "tool_call") {
        const runEvent = createRunEvent("tool_call", {
          content: formatToolCallContent(event.name, event.input),
          status: "streaming",
          metadata: {
            toolCallId: event.id,
            toolName: event.name,
            input: event.input ?? null,
          },
        });
        runtimeEvents.toolCalls.set(event.id, runEvent.id);
        return;
      }
      if (event.type === "tool_result") {
        const status = event.isError || event.status === "failed" ? "error" : "success";
        const toolName = event.name ?? "unknown_tool";
        createRunEvent("tool_result", {
          content: formatToolResultContent(event),
          status,
          metadata: {
            toolCallId: event.id,
            toolCallEventId: runtimeEvents.toolCalls.get(event.id) ?? null,
            toolName,
            output: event.output ?? null,
            summary: event.summary ?? null,
            error: event.error ?? null,
          },
        });
        return;
      }
      if (event.type === "file_write") {
        const filePath = event.path.trim();
        if (filePath) runFileWritePaths.add(filePath);
        createRunEvent("file_write", {
          content: `Wrote file: ${event.path}`,
          status: "success",
          metadata: { path: event.path },
        });
        return;
      }
      if (event.type === "status") {
        createRunEvent("status", {
          content: event.message ?? event.status ?? "",
          status: "success",
          metadata: { status: event.status ?? null },
        });
        return;
      }
      if (event.type === "stderr" && event.text.trim()) {
        createRunEvent("stderr", {
          content: event.text.trim(),
          status: "error",
        });
      }
    };

    try {
      const readiness = await provider.detect(runtimeContext);
      if (!readiness.available) {
        throw new RuntimeProviderUnsupportedError(readiness.reason ?? `${provider.id} runtime is unavailable`);
      }
      let pendingPrefix = "";
      let noReplyProbeResolved = false;
      for await (const rawEvent of provider.streamReply(runtimeContext)) {
        if (this.isRunCancelled(run.id)) {
          await this.finalizeRunCancellation(run.id, "Cancelled by user");
          return null;
        }
        const event = typeof rawEvent === "string" ? ({ type: "text_delta", text: rawEvent } as const) : rawEvent;
        if (event.type !== "text_delta") {
          emitRuntimeEvent(event);
          continue;
        }
        const token = event.text;
        if (!noReplyProbeResolved) {
          pendingPrefix += token;
          if (isPotentialNoReplyPrefix(pendingPrefix)) {
            continue;
          }
          if (isNoReplyOutput(pendingPrefix)) {
            await provider.cancel(run.id);
            await this.finalizeRunCancellation(run.id, "No reply");
            return null;
          }
          noReplyProbeResolved = true;
          emitRuntimeEvent({ type: "text_delta", text: pendingPrefix });
          pendingPrefix = "";
          continue;
        }
        emitRuntimeEvent(event);
      }
    } catch (error) {
      if (this.isRunCancelled(run.id)) {
        await this.finalizeRunCancellation(run.id, "Cancelled by user");
        return null;
      }
      const errorText = this.formatRunFailureMessage(error);
      this.publishAssistantFailure({
        roomId,
        conversationId,
        runId: run.id,
        participant,
        visibleReply,
        errorText,
        existingContent: deferAssistantTextToThinking
          ? extractLocalAgentFinalReply(deferredAssistantText)
          : content,
        visibility: userMessage.visibility,
        createRunEvent,
        emitBlockUpdated,
      });
      return null;
    }

    if (this.isRunCancelled(run.id)) {
      await this.finalizeRunCancellation(run.id, "Cancelled by user");
      return null;
    }

    const visibleOutput = deferAssistantTextToThinking
      ? extractLocalAgentFinalReply(deferredAssistantText)
      : content;
    const fallbackOutput = visibleOutput.trim()
      ? ""
      : buildEmptyLocalAgentReplyFallback(latestUserMessage, currentParticipant, identity);
    const finalVisibleOutput = visibleOutput.trim() ? visibleOutput : fallbackOutput;

    if ((!visibleReply.message || !visibleReply.block) && finalVisibleOutput.trim()) {
      ensureAssistantMessage();
    }

    if (!visibleReply.message || !visibleReply.block) {
      this.publishAssistantFailure({
        roomId,
        conversationId,
        runId: run.id,
        participant,
        visibleReply,
        errorText: nextRunEventSortOrder > 0
          ? "Agent execution finished without a text reply."
          : "Agent returned no content.",
        visibility: userMessage.visibility,
        createRunEvent,
        emitBlockUpdated,
      });
      return null;
    }

    const replyContent = stripAssistantSkillDetails(finalVisibleOutput)
      || (finalVisibleOutput.trim() ? "Skill invoked." : finalVisibleOutput);
    const enrichedReply = enrichAssistantContentWithWorkspaceResourceLinks(replyContent, userMessage.mentions);
    const runFileArtifacts = this.importRunFileWriteArtifacts({
      roomId,
      conversationId,
      runId: run.id,
      messageId: visibleReply.message.id,
      participantId: currentParticipant.id,
      paths: [
        ...runFileWritePaths,
        ...extractLocalFilePathsFromContent(enrichedReply.content),
        ...extractLocalFilePathsFromContent(deferredAssistantText),
      ],
    });
    const finalContent = linkRunFileArtifactPathsInContent(enrichedReply.content, runFileArtifacts);
    const finalBlock = this.repo.updateMessageBlock(visibleReply.block.id, { content: finalContent, status: "success" });
    appendThinking("", true);
    const finalMessage = this.repo.updateMessage(visibleReply.message.id, {
      content: finalContent,
      status: "success",
      ...(enrichedReply.mentions.length ? { mentions: enrichedReply.mentions } : {}),
    });
    const finalRun = this.repo.updateAgentRun(run.id, { status: "completed" });
    if (!finalRun) return null;
    this.repo.touchConversation(conversationId, finalContent);
    if (finalMessage) {
      this.workspaces.recordInteractionMemory({
        conversation,
        participant: currentParticipant,
        userMessage,
        assistantMessage: finalMessage,
      });
      this.publishRunArtifactLinks({
        roomId,
        conversationId,
        runId: run.id,
        messageId: finalMessage.id,
      });
    }
    emitBlockUpdated(finalBlock);
    for (const streamingBlock of this.repo
      .listMessageBlocks(visibleReply.message.id)
      .filter((item) => item.id !== visibleReply.block?.id && item.status === "streaming")) {
      emitBlockUpdated(this.repo.updateMessageBlock(streamingBlock.id, { status: "success" }));
    }
    if (finalMessage) {
      this.events.emit({
        type: "message.updated",
        roomId,
        conversationId,
        runId: run.id,
        payload: { message: finalMessage },
      });
    }
    this.events.emit({
      type: "run.completed",
      roomId,
      conversationId,
      runId: run.id,
      payload: { run: finalRun },
    });
    this.toolTokens.revokeRun(run.id);
    return finalMessage;
  }

  private async executePrivateTask(input: {
    taskId: string;
    roomId: string;
    conversationId: string;
    participant: Participant;
    userMessage: Message;
    taskType: PrivateTaskType;
    sourceMessageId: string | null;
    sourceMessageIds: string[];
    sourcePreview: string;
  }) {
    const conversation = this.repo.getConversation(input.conversationId);
    if (!conversation) return;
    const currentParticipant = this.repo.getParticipant(input.participant.id);
    if (!currentParticipant || currentParticipant.status !== "active") return;
    const runtimeProfile = currentParticipant.runtimeProfileId ? this.repo.getRuntimeProfile(currentParticipant.runtimeProfileId) : null;
    const identity = currentParticipant.identityId ? this.repo.getIdentity(currentParticipant.identityId) : null;
    const attachments = input.sourceMessageId ? this.repo.listArtifactsForMessage(input.sourceMessageId) : [];
    const recentMessages = this.repo.listRecentMessages(input.conversationId, 24);
    const provider = this.runtimes.getProvider(runtimeProfile);
    const runtimeRunId = `private-task-${input.taskId}`;
    const runtimeContext: RuntimeReplyContext = {
      conversation,
      participant: currentParticipant,
      identity,
      runtimeProfile,
      userMessage: input.userMessage,
      recentMessages,
      attachments,
      runId: runtimeRunId,
    };
    const now = new Date().toISOString();
    const buildTask = (partial: Pick<PrivateTaskSnapshot, "status" | "content" | "error" | "updatedAt">): PrivateTaskSnapshot => ({
      id: input.taskId,
      type: input.taskType,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      sourceMessageIds: input.sourceMessageIds,
      participantId: currentParticipant.id,
      participantName: currentParticipant.displayName,
      sourcePreview: input.sourcePreview,
      createdAt: now,
      ...partial,
    });
    const emitTask = (type: "private_task.started" | "private_task.delta" | "private_task.completed" | "private_task.failed" | "private_task.cancelled", payload: Record<string, unknown>) => {
      const task = payload.task as PrivateTaskSnapshot | undefined;
      if (task) this.repo.upsertPrivateTask(task);
      this.events.emit({
        type,
        roomId: input.roomId,
        conversationId: input.conversationId,
        payload,
      });
    };

    emitTask("private_task.started", {
      task: buildTask({
        status: "running",
        content: "",
        error: null,
        updatedAt: now,
      }),
    });

    let content = "";
    let cancelled = false;
    let cancelReason = "Cancelled by user";
    this.activePrivateTasks.set(input.taskId, {
      participantId: currentParticipant.id,
      cancel: async (reason) => {
        cancelled = true;
        cancelReason = reason;
        await provider.cancel(runtimeRunId).catch(() => undefined);
      },
    });

    try {
      const readiness = await provider.detect(runtimeContext);
      if (!readiness.available) {
        throw new RuntimeProviderUnsupportedError(readiness.reason ?? `${provider.id} runtime is unavailable`);
      }
      let pendingPrefix = "";
      let noReplyProbeResolved = false;
      for await (const rawEvent of provider.streamReply(runtimeContext)) {
        if (cancelled || this.cancelledPrivateTaskIds.has(input.taskId)) {
          emitTask("private_task.cancelled", {
            task: buildTask({
              status: "cancelled",
              content,
              error: cancelReason,
              updatedAt: new Date().toISOString(),
            }),
          });
          return;
        }
        const event = typeof rawEvent === "string" ? ({ type: "text_delta", text: rawEvent } as const) : rawEvent;
        if (event.type !== "text_delta") continue;
        const token = event.text;
        if (!noReplyProbeResolved) {
          pendingPrefix += token;
          if (isPotentialNoReplyPrefix(pendingPrefix)) continue;
          if (isNoReplyOutput(pendingPrefix)) {
            emitTask("private_task.completed", {
              task: buildTask({
                status: "completed",
                content: "",
                error: null,
                updatedAt: new Date().toISOString(),
              }),
            });
            return;
          }
          noReplyProbeResolved = true;
          content += pendingPrefix;
          pendingPrefix = "";
        } else {
          content += token;
        }
        emitTask("private_task.delta", {
          taskId: input.taskId,
          content,
          delta: token,
        });
        this.repo.updatePrivateTaskContent(input.taskId, content);
      }
      if (pendingPrefix && !noReplyProbeResolved) {
        content += pendingPrefix;
        emitTask("private_task.delta", {
          taskId: input.taskId,
          content,
          delta: pendingPrefix,
        });
        this.repo.updatePrivateTaskContent(input.taskId, content);
      }
      if (cancelled || this.cancelledPrivateTaskIds.has(input.taskId)) {
        emitTask("private_task.cancelled", {
          task: buildTask({
            status: "cancelled",
            content,
            error: cancelReason,
            updatedAt: new Date().toISOString(),
          }),
        });
        return;
      }
      emitTask("private_task.completed", {
        task: buildTask({
          status: "completed",
          content,
          error: null,
          updatedAt: new Date().toISOString(),
        }),
      });
    } catch (error) {
      if (cancelled || this.cancelledPrivateTaskIds.has(input.taskId)) {
        emitTask("private_task.cancelled", {
          task: buildTask({
            status: "cancelled",
            content,
            error: cancelReason,
            updatedAt: new Date().toISOString(),
          }),
        });
        return;
      }
      const errorText = error instanceof Error ? error.message : "Private task failed";
      emitTask("private_task.failed", {
        task: buildTask({
          status: "failed",
          content,
          error: errorText,
          updatedAt: new Date().toISOString(),
        }),
      });
    } finally {
      this.activePrivateTasks.delete(input.taskId);
      this.cancelledPrivateTaskIds.delete(input.taskId);
    }
  }

  private resolveIdentityInput<T extends CreateIdentityRequest | UpdateIdentityRequest>(
    input: T,
    identityId?: string,
  ): T {
    const current = identityId ? this.repo.getIdentity(identityId) : null;
    const runtimeProfileId =
      input.defaultRuntimeProfileId === undefined
        ? current?.defaultRuntimeProfileId ?? null
        : input.defaultRuntimeProfileId;
    if (!runtimeProfileId || input.model === undefined) return input;
    const baseProfile = this.repo.getRuntimeProfile(runtimeProfileId);
    if (!baseProfile) return input;
    const canonicalProfile = this.resolveCanonicalRuntimeProfile(baseProfile);
    const resolvedProfile = this.repo.ensureRuntimeProfileForModel(canonicalProfile, input.model);
    return { ...input, defaultRuntimeProfileId: resolvedProfile.id };
  }

  private resolveCanonicalRuntimeProfile(profile: RuntimeProfile) {
    if (profile.kind === "local-agent" && profile.id === `local-agent:${profile.provider}`) return profile;
    const canonical = this.repo
      .listRuntimeProfiles()
      .find(
        (item) =>
          item.kind === "local-agent" &&
          item.provider === profile.provider &&
          item.id === `local-agent:${item.provider}`,
      );
    return canonical ?? profile;
  }

  private isRunCancelled(runId: string) {
    return this.cancelledRunIds.has(runId) || this.repo.getAgentRun(runId)?.status === "cancelled";
  }

  private formatRunFailureMessage(error: unknown) {
    const raw = (error instanceof Error ? error.message : String(error)).trim();
    if (!raw) return "Agent execution failed.";
    if (/SIGTERM|timed?\s*out|timeout|AbortError|aborted|time.?limit/i.test(raw)) {
      return "Agent execution timed out or was interrupted.";
    }
    if (/local-agent command exited/i.test(raw)) {
      const detail = raw.replace(/^local-agent command exited with /, "").trim();
      return detail ? `Agent exited abnormally: ${detail}` : "Agent exited abnormally.";
    }
    if (/^Agent (执行|未|execution|returned|finished|exited)/i.test(raw)) return raw;
    return `Agent execution failed: ${raw}`;
  }

  private publishAssistantFailure(params: {
    roomId: string;
    conversationId: string;
    runId: string;
    participant: Participant;
    visibleReply: { message: Message | null; block: MessageBlock | null };
    errorText: string;
    existingContent?: string;
    visibility?: Message["visibility"];
    createRunEvent: (
      type: Parameters<ChatRepository["createAgentRunEvent"]>[0]["type"],
      input?: Omit<Parameters<ChatRepository["createAgentRunEvent"]>[0], "runId" | "conversationId" | "type">,
    ) => void;
    emitBlockUpdated: (block: MessageBlock | null) => void;
  }) {
    const strippedExistingContent = params.existingContent
      ? stripAssistantSkillDetails(params.existingContent)
      : "";
    const hasVisibleOutput = strippedExistingContent.trim().length > 0;
    const messageContent = hasVisibleOutput ? strippedExistingContent : params.errorText;
    const messageStatus: Message["status"] = hasVisibleOutput ? "success" : "error";
    const blockStatus: MessageBlock["status"] = hasVisibleOutput ? "success" : "error";
    const visibility = params.visibility ?? "public";
    params.createRunEvent("error", { content: params.errorText, status: "error" });

    if (!params.visibleReply.message || !params.visibleReply.block) {
      params.visibleReply.message = this.repo.createMessage({
        conversationId: params.conversationId,
        role: "assistant",
        senderParticipantId: params.participant.id,
        senderName: params.participant.displayName,
        content: messageContent,
        visibility,
        status: messageStatus,
        runId: params.runId,
      });
      params.visibleReply.block = this.repo.createMessageBlock({
        messageId: params.visibleReply.message.id,
        type: "main_text",
        content: messageContent,
        status: blockStatus,
      });
      this.repo.updateAgentRun(params.runId, {
        assistantMessageId: params.visibleReply.message.id,
        status: "failed",
        error: params.errorText,
      });
      this.events.emit({
        type: "message.created",
        roomId: params.roomId,
        conversationId: params.conversationId,
        runId: params.runId,
        payload: { message: params.visibleReply.message },
      });
      this.events.emit({
        type: "message_block.created",
        roomId: params.roomId,
        conversationId: params.conversationId,
        runId: params.runId,
        payload: { block: params.visibleReply.block },
      });
    } else {
      const finalBlock = this.repo.updateMessageBlock(params.visibleReply.block.id, {
        content: messageContent,
        status: blockStatus,
      });
      const finalMessage = this.repo.updateMessage(params.visibleReply.message.id, {
        content: messageContent,
        status: messageStatus,
      });
      params.emitBlockUpdated(finalBlock);
      for (const streamingBlock of this.repo
        .listMessageBlocks(params.visibleReply.message.id)
        .filter(
          (item) =>
            item.id !== params.visibleReply.block?.id
            && (item.status === "streaming" || item.status === "pending"),
        )) {
        params.emitBlockUpdated(this.repo.updateMessageBlock(streamingBlock.id, { status: blockStatus }));
      }
      if (finalMessage) {
        this.events.emit({
          type: "message.updated",
          roomId: params.roomId,
          conversationId: params.conversationId,
          runId: params.runId,
          payload: { message: finalMessage },
        });
      }
    }

    const finalRun = this.repo.updateAgentRun(params.runId, { status: "failed", error: params.errorText });
    if (params.visibleReply.message) {
      this.publishRunArtifactLinks({
        roomId: params.roomId,
        conversationId: params.conversationId,
        runId: params.runId,
        messageId: params.visibleReply.message.id,
      });
    }
    this.events.emit({
      type: "run.failed",
      roomId: params.roomId,
      conversationId: params.conversationId,
      runId: params.runId,
      payload: { run: finalRun },
    });
    this.toolTokens.revokeRun(params.runId);
  }

  private importRunFileWriteArtifacts(params: {
    roomId: string;
    conversationId: string;
    runId: string;
    messageId: string;
    participantId?: string | null;
    paths: string[];
  }): Array<{ path: string; artifact: Artifact }> {
    const linked: Array<{ path: string; artifact: Artifact }> = [];
    const artifactByPath = new Map<string, Artifact>();
    const allowedRoot = roomArtifactRoot(params.roomId);
    const workspaceRoot = params.participantId
      ? participantWorkspaceRoot(params.roomId, params.participantId)
      : allowedRoot;

    for (const rawPath of params.paths) {
      const normalizedRawPath = rawPath.replace(/\\/g, "/").trim();
      if (!normalizedRawPath) continue;
      const filePath = resolveRunOutputPath(normalizedRawPath, workspaceRoot);
      if (!isPathInsideDirectory(filePath, allowedRoot)) continue;
      if (params.participantId && !shouldImportRunFileArtifactPath(filePath, workspaceRoot)) continue;
      const existingLinkedArtifact = artifactByPath.get(filePath);
      if (existingLinkedArtifact) {
        pushRunArtifactAliases(linked, normalizedRawPath, filePath, existingLinkedArtifact);
        continue;
      }
      if (!existsSync(filePath)) continue;

      let sizeBytes = 0;
      try {
        const stat = statSync(filePath);
        if (!stat.isFile()) continue;
        sizeBytes = stat.size;
      } catch {
        continue;
      }
      if (sizeBytes > AUTO_IMPORT_RUN_FILE_MAX_BYTES) continue;

      const contentHash = sha256ForFile(filePath);
      const existingArtifact = this.repo.listArtifactsForRun(params.runId).find((artifact) => {
        const localPath = artifact.localPath.replace(/\\/g, "/");
        return localPath === filePath || Boolean(contentHash && artifact.contentHash === contentHash);
      });
      if (existingArtifact) {
        artifactByPath.set(filePath, existingArtifact);
        pushRunArtifactAliases(linked, normalizedRawPath, filePath, existingArtifact);
        continue;
      }

      let artifact: Artifact;
      try {
        const data = readFileSync(filePath);
        artifact = this.repo.createArtifact(
          params.conversationId,
          {
            filename: basename(filePath),
            mimeType: inferMimeTypeForPath(filePath),
            dataBase64: data.toString("base64"),
          },
          {
            kind: "run-output",
            messageId: params.messageId,
            sourceRunId: params.runId,
            uploadSubdir: `run-${params.runId}`,
          },
        );
      } catch {
        continue;
      }

      this.events.emit({
        type: "artifact.created",
        roomId: params.roomId,
        conversationId: params.conversationId,
        runId: params.runId,
        payload: { artifact },
      });
      artifactByPath.set(filePath, artifact);
      pushRunArtifactAliases(linked, normalizedRawPath, filePath, artifact);
    }

    return linked;
  }

  private publishRunArtifactLinks(params: {
    roomId: string;
    conversationId: string;
    runId: string;
    messageId: string;
  }) {
    for (const linked of this.repo.linkPendingRunArtifacts(params.runId, params.messageId)) {
      this.events.emit({
        type: "artifact.created",
        roomId: params.roomId,
        conversationId: params.conversationId,
        runId: params.runId,
        payload: { artifact: linked.artifact },
      });
      this.events.emit({
        type: "message_block.created",
        roomId: params.roomId,
        conversationId: params.conversationId,
        runId: params.runId,
        payload: { block: linked.block },
      });
    }
  }

  private async finalizeRunCancellation(runId: string, reason: string) {
    const run = this.repo.getAgentRun(runId);
    if (!run) return null;
    const finalRun =
      run.status === "cancelled"
        ? run
        : this.repo.updateAgentRun(runId, { status: "cancelled", error: reason }) ?? run;
    const assistantMessage = run.assistantMessageId ? this.repo.getMessage(run.assistantMessageId) : null;
    if (assistantMessage) {
      const finalMessage = this.repo.updateMessage(assistantMessage.id, {
        content: assistantMessage.content,
        status: "cancelled",
      });
      for (const block of this.repo.listMessageBlocks(assistantMessage.id)) {
        if (block.status !== "streaming" && block.status !== "pending") continue;
        const finalBlock = this.repo.updateMessageBlock(block.id, {
          content: block.content,
          status: "success",
        });
        if (finalBlock) {
          this.events.emit({
            type: "message_block.updated",
            roomId: run.roomId,
            conversationId: run.conversationId,
            runId,
            payload: { block: finalBlock },
          });
        }
      }
      if (finalMessage) {
        this.events.emit({
          type: "message.updated",
          roomId: run.roomId,
          conversationId: run.conversationId,
          runId,
          payload: { message: finalMessage },
        });
      }
    }
    this.events.emit({
      type: "run.cancelled",
      roomId: run.roomId,
      conversationId: run.conversationId,
      runId,
      payload: { run: finalRun },
    });
    this.toolTokens.revokeRun(runId);
    this.cancelledRunIds.delete(runId);
    return { run: finalRun };
  }

}

function isPathInsideDirectory(filePath: string, directory: string) {
  const relativePath = relative(resolve(directory), resolve(filePath));
  return Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function resolveRunOutputPath(filePath: string, workspaceRoot: string) {
  return isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceRoot, filePath);
}

function extractLocalAgentFinalReply(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  if (text.length <= 500 && !LOCAL_AGENT_PROCESS_TEXT_PATTERN.test(text)) return text;

  const headingMatch = /(?:^|\n)\s{0,3}(?:#{1,6}\s*)?(?:最终(?:结论|回复|结果)|最终输出|完成结果|结果)\s*[:：]?\s*(?:\n|$)/i.exec(text);
  if (headingMatch?.index !== undefined) {
    const afterHeading = text.slice(headingMatch.index + headingMatch[0].length).trim();
    if (afterHeading) return afterHeading;
  }

  const finalStart = localAgentFinalReplyStartIndex(text);
  if (finalStart >= 0) return trimLeadingSentenceBoundary(text.slice(finalStart));

  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs.slice(-2).join("\n\n");

  const sentences = splitChineseSentences(text);
  if (sentences.length > 1) return sentences.slice(-2).join("");
  return text;
}

const LOCAL_AGENT_PROCESS_TEXT_PATTERN = /我(?:先|会先|准备|将|正在|现在|接下来|随后)|当前工作区|读取本地|检查/;
const LOCAL_AGENT_PROCESS_MARKER_PATTERN = /我(?:先|会先|准备|将|正在|现在|接下来|随后)|当前工作区|读取本地|检查/g;
const LOCAL_AGENT_FINAL_MARKER_PATTERN = /已(?:完成|创建|生成|写入|更新|保存|验证)|(?:文件路径|入口文件|输出文件|结果文件)\s*[:：]|(?:可以|可直接).{0,24}(?:打开|使用|查看)/g;

function localAgentFinalReplyStartIndex(text: string) {
  let lastProcessIndex = -1;
  for (const match of text.matchAll(LOCAL_AGENT_PROCESS_MARKER_PATTERN)) {
    lastProcessIndex = Math.max(lastProcessIndex, match.index ?? -1);
  }

  const candidates = [...text.matchAll(LOCAL_AGENT_FINAL_MARKER_PATTERN)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);
  if (candidates.length === 0) return -1;

  const afterProcess = candidates.filter((index) => index > lastProcessIndex);
  if (afterProcess.length > 0) return Math.min(...afterProcess);

  const lateCandidates = candidates.filter((index) => index >= text.length * 0.45);
  return lateCandidates.length > 0 ? Math.min(...lateCandidates) : candidates.at(-1)!;
}

function trimLeadingSentenceBoundary(value: string) {
  return value.replace(/^[\s。！？!?,，、；;：:]+/, "").trim();
}

function splitChineseSentences(text: string) {
  const sentences: string[] = [];
  let buffer = "";
  for (const char of text) {
    buffer += char;
    if ("。！？!?".includes(char)) {
      const sentence = buffer.trim();
      if (sentence) sentences.push(sentence);
      buffer = "";
    }
  }
  const tail = buffer.trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function buildEmptyLocalAgentReplyFallback(
  userMessage: Message,
  participant: Participant,
  identity: Identity | null,
) {
  if (!isDirectAgentMention(userMessage, participant.id)) return "";
  if (isIdentityQuestion(userMessage.content)) {
    const roleDescription = buildEffectiveRoleDescription(participant, identity).trim();
    const roleSummary = roleDescription
      ? `我在这个群里的设定是：${truncatePreview(roleDescription)}`
      : "我还没有配置更具体的角色设定。";
    return `我是${participant.displayName}。${roleSummary}`;
  }
  return `我是${participant.displayName}，刚才没有生成有效的最终回复。`;
}

function isDirectAgentMention(message: Message, participantId: string) {
  return message.mentions.some(
    (mention) =>
      mention.mentionType === "all"
      || (mention.mentionType === "participant" && mention.participantId === participantId),
  );
}

function isIdentityQuestion(content: string) {
  return /你是谁|你是誰|who are you|介绍.*自己|自我介绍/i.test(content);
}

function pushRunArtifactAliases(
  linked: Array<{ path: string; artifact: Artifact }>,
  rawPath: string,
  filePath: string,
  artifact: Artifact,
) {
  const aliases = new Set([rawPath, filePath]);
  for (const alias of aliases) {
    linked.push({ path: alias, artifact });
  }
}

function resolveReplySpeakingOrder(
  conversation: Conversation,
  mentions: NonNullable<SendMessageRequest["mentions"]>,
): SpeakingOrder {
  return resolveMentionSpeakingOrder(conversation.replyPolicy.order, mentions);
}

function isParticipantMentionScoped(mentions: Message["mentions"]) {
  return mentions.some((mention) => mention.mentionType === "participant");
}

function maxReplyRoundsForTrigger(
  conversation: Conversation,
  mentions: NonNullable<SendMessageRequest["mentions"]>,
) {
  const hasParticipantMention = mentions.some((mention) => mention.mentionType === "participant");
  const maxRounds = hasParticipantMention
    ? 1 + conversation.replyPolicy.mentionFollowupRounds
    : conversation.replyPolicy.maxRounds;
  return Math.max(1, maxRounds);
}

function isPotentialNoReplyPrefix(value: string) {
  const normalized = normalizeNoReplyOutput(value);
  return normalized.length < NO_REPLY_MARKER.length && NO_REPLY_MARKER.startsWith(normalized);
}

function isNoReplyOutput(value: string) {
  return normalizeNoReplyOutput(value) === NO_REPLY_MARKER;
}

function normalizeNoReplyOutput(value: string) {
  return value.trim().replace(/^`+|`+$/g, "");
}

function formatToolCallContent(toolName: string, input: unknown) {
  const preview = previewJson(input);
  return preview ? `Calling ${toolName}\n\n${preview}` : `Calling ${toolName}`;
}

function formatToolResultContent(event: Extract<RuntimeStreamEvent, { type: "tool_result" }>) {
  if (event.error) return event.error;
  if (event.summary) return event.summary;
  const preview = previewJson(event.output);
  return preview || `${event.name ?? "Tool"} completed`;
}

function toolNameForCall(toolCalls: Map<string, string>, toolCallId: string, repo: ChatRepository) {
  const blockId = toolCalls.get(toolCallId);
  if (!blockId) return undefined;
  const toolName = repo.getMessageBlock(blockId)?.metadata?.toolName;
  return typeof toolName === "string" ? toolName : undefined;
}

function previewJson(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return truncatePreview(value);
  try {
    return truncatePreview(JSON.stringify(value, null, 2));
  } catch {
    return truncatePreview(String(value));
  }
}

function truncatePreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > 1600 ? `${trimmed.slice(0, 1600)}...` : trimmed;
}

const replyModes: ReplyMode[] = ["all", "mentioned", "selected", "auto"];
const speakingOrders: SpeakingOrder[] = ["sequential", "random", "parallel"];

function normalizeReplyPolicy(policy: UpdateConversationPolicyRequest["replyPolicy"]) {
  if (!replyModes.includes(policy.mode)) throw new Error("Invalid reply mode");
  if (!speakingOrders.includes(policy.order)) throw new Error("Invalid speaking order");
  return {
    mode: policy.mode,
    order: policy.order,
    maxRounds: clampInteger(policy.maxRounds, 1, 5),
    mentionFollowupRounds: clampInteger(policy.mentionFollowupRounds, 0, 4),
  };
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function orderTargets(targets: Participant[], order: SpeakingOrder) {
  if (order !== "random") return targets;
  const shuffled = [...targets];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

function shouldAutoReply(participant: Participant, userText: string) {
  if (participant.listenMode === "passive") return false;
  if (participant.listenMode === "active") return true;
  return shouldAdaptiveReply(userText);
}

function replyScheduleKey(conversationId: string, participantId: string) {
  return `${conversationId}:${participantId}`;
}

function compactTaskPreview(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 120) || "[附件]";
}

function shouldAdaptiveReply(userText: string) {
  const text = userText.trim();
  if (!text) return true;
  if (/[?？]/.test(text)) return true;
  return /(?:怎么|如何|为什么|是否|可以|帮|建议|方案|计划|评审|看看|讨论|下一步|next|plan|review|help|should|how|why)/i.test(
    text,
  );
}

function normalizeUserSenderName(senderName?: string | null) {
  const trimmed = senderName?.trim();
  return trimmed || "You";
}
