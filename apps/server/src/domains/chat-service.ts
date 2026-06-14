import {
  DEFAULT_PARTICIPANT_LISTEN_MODE,
  type AddParticipantRequest,
  type AgentRun,
  type Conversation,
  type CreateIdentityRequest,
  type CreateRoomRequest,
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
} from "@group-chat/shared";
import { nanoid } from "nanoid";
import { AgentToolTokenStore } from "./agent-tool-tokens.js";
import { AgentWorkspaceService } from "./agent-workspace.js";
import { ChatRepository } from "./chat-repository.js";
import { NO_REPLY_MARKER } from "../runtimes/local-agent-protocol.js";
import { createRuntimeProviderRegistry } from "../runtimes/runtime-registry.js";
import { RuntimeProviderUnsupportedError, type RuntimeReplyContext, type RuntimeStreamEvent } from "../runtimes/runtime-provider.js";
import { EventHub } from "../ws/event-hub.js";

export class ChatService {
  private readonly workspaces = new AgentWorkspaceService();
  private readonly runtimes = createRuntimeProviderRegistry();
  private readonly activeReplyKeys = new Set<string>();
  private readonly cancelledRunIds = new Set<string>();
  private readonly cancelledPrivateTaskIds = new Set<string>();
  private readonly activePrivateTasks = new Map<string, { cancel: () => Promise<void> | void }>();
  private recoveredReplyQueue = false;

  constructor(
    private readonly repo: ChatRepository,
    private readonly events: EventHub,
    private readonly toolTokens: AgentToolTokenStore,
  ) {}

  bootstrap() {
    this.repo.ensureSeedData();
    this.materializeExistingWorkspaces();
    this.recoverReplyQueueOnce();
    return this.repo.snapshot();
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
      payload: { identity },
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
        payload: { identity },
      });
    }
    return identity;
  }

  deleteIdentity(identityId: string) {
    const result = this.repo.deleteIdentity(identityId);
    if (result) {
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
      payload: { participant },
    });
    const systemMessage = this.emitSystemNotice(conversation, `${participant.displayName} 加入了群聊`);
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
        payload: { participant },
      });
    }
    return participant;
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

  async cancelRun(runId: string) {
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
    return this.finalizeRunCancellation(runId, "Cancelled by user");
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

  removeParticipant(participantId: string) {
    const participant = this.repo.updateParticipantStatus(participantId, "removed");
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

  sendMessage(conversationId: string, input: SendMessageRequest) {
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const content = input.content.trim();
    if (!content && !input.artifactIds?.length) throw new Error("Message content is required");

    const message = this.repo.createMessage({
      conversationId,
      role: "user",
      senderName: "You",
      content,
      mentions: this.normalizeMentions(conversationId, input.mentions ?? []),
      status: "success",
      parentMessageId: input.parentMessageId ?? null,
    });
    const textBlock = this.repo.createMessageBlock({
      messageId: message.id,
      type: "main_text",
      content,
      sortOrder: 0,
    });
    const blocks = [textBlock];
    const artifacts = [];
    this.repo.touchConversation(conversationId, content || "Attached files");
    this.events.emit({
      type: "message.created",
      roomId: conversation.roomId,
      conversationId,
      payload: { message },
    });
    this.events.emit({
      type: "message_block.created",
      roomId: conversation.roomId,
      conversationId,
      payload: { block: textBlock },
    });

    for (const [index, artifactId] of (input.artifactIds ?? []).entries()) {
      const artifact = this.repo.attachArtifactToMessage(artifactId, message.id);
      if (!artifact) continue;
      artifacts.push(artifact);
      const block = this.repo.createMessageBlock({
        messageId: message.id,
        type: artifact.mimeType.startsWith("image/") ? "image" : "file",
        content: artifact.textPreview ?? "",
        metadata: { artifactId: artifact.id },
        sortOrder: index + 1,
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
    void this.generateReplies(conversation.roomId, conversationId, message, targets, {
      currentRound: 1,
      maxRounds: input.maxReplyRounds
        ? clampInteger(input.maxReplyRounds, 1, 8)
        : maxReplyRoundsForTrigger(conversation, mentions),
      order: conversation.replyPolicy.order,
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

  cancelPrivateTask(taskId: string) {
    this.cancelledPrivateTaskIds.add(taskId);
    this.activePrivateTasks.get(taskId)?.cancel();
    this.activePrivateTasks.delete(taskId);
    return { taskId, cancelled: true };
  }

  updateMessage(messageId: string, input: UpdateMessageRequest) {
    const current = this.repo.getMessage(messageId);
    if (!current) return null;
    const conversation = this.repo.getConversation(current.conversationId);
    if (!conversation) return null;
    if (input.status === "deleted" || input.status === "recalled") {
      const result = this.repo.markMessageStatus(messageId, input.status);
      if (!result?.message) return null;
      if (input.status === "recalled") this.repo.deletePendingRepliesForMessage(messageId);
      this.repo.touchConversation(conversation.id, input.status === "recalled" ? "消息已撤回" : "消息已删除");
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
    this.repo.touchConversation(conversation.id, result.message.content);
    this.events.emit({
      type: "message.updated",
      roomId: conversation.roomId,
      conversationId: conversation.id,
      payload: { message: result.message },
    });
    if (result.block) {
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
      order: conversation.replyPolicy.order,
      seenParticipantIds: new Set(targets.map((participant) => participant.id)),
      mentionScoped: isParticipantMentionScoped(result.message.mentions),
    });
    return { message: result.message, blocks: result.block ? [result.block] : [], targets };
  }

  private normalizeMentions(conversationId: string, mentions: NonNullable<SendMessageRequest["mentions"]>) {
    const participants = this.repo.listParticipants(conversationId);
    const byId = new Map(participants.map((participant) => [participant.id, participant]));
    return mentions
      .map((mention) => {
        const participant = byId.get(mention.participantId);
        if (!participant && mention.mentionType !== "all") return null;
        return {
          participantId: mention.participantId,
          displayNameSnapshot: participant?.displayName ?? mention.displayNameSnapshot,
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
    if (mentions.some((mention) => mention.mentionType === "all")) return activeAi;
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
    if (options.order === "parallel") {
      const replies = await Promise.all(
        orderedTargets.map(async (participant) => ({
          assistantMessage: await this.scheduleReply(roomId, conversationId, userMessage, participant),
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

  private async scheduleReply(roomId: string, conversationId: string, userMessage: Message, participant: Participant) {
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
        const generated = await this.generateForParticipant(roomId, conversationId, nextMessage, participant);
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

  private async generateForParticipant(
    roomId: string,
    conversationId: string,
    userMessage: Message,
    participant: Participant,
  ): Promise<Message | null> {
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation) return null;
    const runtimeProfile = participant.runtimeProfileId ? this.repo.getRuntimeProfile(participant.runtimeProfileId) : null;
    const identity = participant.identityId ? this.repo.getIdentity(participant.identityId) : null;
    const attachments = this.repo.listArtifactsForMessage(userMessage.id);
    const recentMessages = this.repo.listRecentMessages(conversationId, 24);
    const provider = this.runtimes.getProvider(runtimeProfile);
    const runtimeContext: RuntimeReplyContext = {
      conversation,
      participant,
      identity,
      runtimeProfile,
      userMessage,
      recentMessages,
      attachments,
    };
    const runDescriptor = provider.describeRun(runtimeContext);
    const run = this.repo.createAgentRun({
      roomId,
      conversationId,
      participantId: participant.id,
      assistantMessageId: null,
      runtime: runDescriptor.runtime,
      provider: runDescriptor.provider,
      model: runDescriptor.model,
    });
    this.events.emit({
      type: "run.accepted",
      roomId,
      conversationId,
      runId: run.id,
      payload: { run },
    });
    runtimeContext.runId = run.id;
    runtimeContext.toolAccess = this.toolTokens.issue({
      runId: run.id,
      participantId: participant.id,
      conversationId,
    });

    this.repo.updateAgentRun(run.id, { status: "running" });
    const visibleReply: { message: Message | null; block: MessageBlock | null } = {
      message: null,
      block: null,
    };
    let nextRunEventSortOrder = 0;
    const runtimeEvents = {
      toolCalls: new Map<string, string>(),
    };
    this.events.emit({
      type: "run.started",
      roomId,
      conversationId,
      runId: run.id,
      payload: { run: this.repo.getAgentRun(run.id) },
    });

    let content = "";
    const createRunEvent = (
      type: Parameters<ChatRepository["createAgentRunEvent"]>[0]["type"],
      input: Omit<Parameters<ChatRepository["createAgentRunEvent"]>[0], "runId" | "conversationId" | "type"> = {},
    ) => {
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
        senderParticipantId: participant.id,
        senderName: participant.displayName,
        content: "",
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
        emitToken(event.text);
        return;
      }
      if (event.type === "thinking_delta") {
        createRunEvent("thinking_delta", { content: event.text, status: "streaming" });
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
      const errorText = error instanceof Error ? error.message : "Runtime provider failed";
      createRunEvent("error", { content: errorText, status: "error" });
      const finalBlock = visibleReply.block
        ? this.repo.updateMessageBlock(visibleReply.block.id, { content, status: "error" })
        : null;
      const finalMessage = visibleReply.message
        ? this.repo.updateMessage(visibleReply.message.id, { content, status: "error" })
        : null;
      const finalRun = this.repo.updateAgentRun(run.id, { status: "failed", error: errorText });
      emitBlockUpdated(finalBlock);
      if (visibleReply.message && visibleReply.block) {
        for (const streamingBlock of this.repo
          .listMessageBlocks(visibleReply.message.id)
          .filter((item) => item.id !== visibleReply.block?.id && (item.status === "streaming" || item.status === "pending"))) {
          emitBlockUpdated(this.repo.updateMessageBlock(streamingBlock.id, { status: "error" }));
        }
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
        type: "run.failed",
        roomId,
        conversationId,
        runId: run.id,
        payload: { run: finalRun },
      });
      this.toolTokens.revokeRun(run.id);
      return null;
    }

    if (this.isRunCancelled(run.id)) {
      await this.finalizeRunCancellation(run.id, "Cancelled by user");
      return null;
    }

    if (!visibleReply.message || !visibleReply.block) {
      const finalRun = this.repo.updateAgentRun(run.id, { status: "completed" });
      this.events.emit({
        type: "run.completed",
        roomId,
        conversationId,
        runId: run.id,
        payload: { run: finalRun },
      });
      this.toolTokens.revokeRun(run.id);
      return null;
    }

    const finalBlock = this.repo.updateMessageBlock(visibleReply.block.id, { content, status: "success" });
    const finalMessage = this.repo.updateMessage(visibleReply.message.id, { content, status: "success" });
    const finalRun = this.repo.updateAgentRun(run.id, { status: "completed" });
    if (!finalRun) return null;
    this.repo.touchConversation(conversationId, content);
    if (finalMessage) {
      this.workspaces.recordInteractionMemory({
        conversation,
        participant,
        userMessage,
        assistantMessage: finalMessage,
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
    const runtimeProfile = input.participant.runtimeProfileId ? this.repo.getRuntimeProfile(input.participant.runtimeProfileId) : null;
    const identity = input.participant.identityId ? this.repo.getIdentity(input.participant.identityId) : null;
    const attachments = input.sourceMessageId ? this.repo.listArtifactsForMessage(input.sourceMessageId) : [];
    const recentMessages = this.repo.listRecentMessages(input.conversationId, 24);
    const provider = this.runtimes.getProvider(runtimeProfile);
    const runtimeContext: RuntimeReplyContext = {
      conversation,
      participant: input.participant,
      identity,
      runtimeProfile,
      userMessage: input.userMessage,
      recentMessages,
      attachments,
    };
    const now = new Date().toISOString();
    const buildTask = (partial: Pick<PrivateTaskSnapshot, "status" | "content" | "error" | "updatedAt">): PrivateTaskSnapshot => ({
      id: input.taskId,
      type: input.taskType,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      sourceMessageIds: input.sourceMessageIds,
      participantId: input.participant.id,
      participantName: input.participant.displayName,
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
    this.activePrivateTasks.set(input.taskId, {
      cancel: () => {
        cancelled = true;
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
              error: "Cancelled by user",
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
      emitTask("private_task.completed", {
        task: buildTask({
          status: "completed",
          content,
          error: null,
          updatedAt: new Date().toISOString(),
        }),
      });
    } catch (error) {
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
