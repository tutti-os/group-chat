import type { UploadArtifactRequest } from "@group-chat/shared";
import { isAgentRunVisibleToParticipant, isMessageVisibleToParticipant, enrichAgentRun } from "@group-chat/shared";
import { participantWorkspaceRoot } from "../local/paths.js";
import { EventHub } from "../ws/event-hub.js";
import { AgentToolTokenStore, type AgentToolCredential } from "./agent-tool-tokens.js";
import { ChatRepository } from "./chat-repository.js";

export class AgentToolGateway {
  constructor(
    private readonly repo: ChatRepository,
    private readonly events: EventHub,
    private readonly tokens: AgentToolTokenStore,
  ) {}

  getContext(participantId: string, credential: AgentToolCredential) {
    const grant = this.tokens.authorize(participantId, credential);
    const participant = this.repo.getParticipant(participantId);
    if (!participant || participant.status === "removed") throw new Error("Participant not found");
    const conversation = this.repo.getConversation(participant.conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.id !== grant.conversationId) throw new Error("Agent tool token does not match conversation");
    const room = this.repo.getRoom(conversation.roomId);
    if (!room) throw new Error("Room not found");

    const snapshot = this.repo.snapshot();
    const messages = snapshot.messages
      .filter((message) => message.conversationId === conversation.id)
      .filter((message) => isMessageVisibleToParticipant(message, participant.id))
      .slice(-30);
    const messageIds = new Set(messages.map((message) => message.id));
    return {
      room,
      conversation,
      participant,
      workspaceRoot: participantWorkspaceRoot(room.id, participant.id),
      participants: snapshot.participants.filter(
        (item) => item.conversationId === conversation.id && item.status !== "removed",
      ),
      messages,
      messageBlocks: snapshot.messageBlocks.filter((block) => messageIds.has(block.messageId)),
      artifacts: snapshot.artifacts.filter((artifact) => artifact.conversationId === conversation.id),
      activeRuns: snapshot.activeRuns.filter(
        (run) =>
          run.conversationId === conversation.id
          && isAgentRunVisibleToParticipant(
            enrichAgentRun(run, snapshot.messages),
            participant.id,
          ),
      ),
      toolRun: {
        runId: grant.runId,
        expiresAt: grant.expiresAt,
      },
    };
  }

  getArtifact(participantId: string, artifactId: string, credential: AgentToolCredential) {
    const context = this.getContext(participantId, credential);
    const artifact = this.repo.getArtifact(artifactId);
    if (!artifact || artifact.conversationId !== context.conversation.id) throw new Error("Artifact not found");
    return { artifact };
  }

  sendMessage(participantId: string, input: { content: string }, credential: AgentToolCredential) {
    const context = this.getContext(participantId, credential);
    const content = input.content.trim();
    if (!content) throw new Error("Message content is required");
    const message = this.repo.createMessage({
      conversationId: context.conversation.id,
      role: "assistant",
      senderParticipantId: context.participant.id,
      senderName: context.participant.displayName,
      content,
      status: "success",
    });
    const block = this.repo.createMessageBlock({
      messageId: message.id,
      type: "main_text",
      content,
      status: "success",
    });
    this.repo.touchConversation(context.conversation.id, content);
    this.events.emit({
      type: "message.created",
      roomId: context.room.id,
      conversationId: context.conversation.id,
      payload: { message },
    });
    this.events.emit({
      type: "message_block.created",
      roomId: context.room.id,
      conversationId: context.conversation.id,
      payload: { block },
    });
    return { message, block };
  }

  saveArtifact(
    participantId: string,
    input: UploadArtifactRequest & { messageId?: string | null; runId?: string | null },
    credential: AgentToolCredential,
  ) {
    const context = this.getContext(participantId, credential);
    const sourceRunId = input.runId ?? context.toolRun.runId;
    let artifact = this.repo.createArtifact(context.conversation.id, input, {
      kind: sourceRunId ? "run-output" : "generated",
      messageId: input.messageId ?? null,
      sourceRunId,
    });
    this.events.emit({
      type: "artifact.created",
      roomId: context.room.id,
      conversationId: context.conversation.id,
      runId: sourceRunId,
      payload: { artifact },
    });

    if (sourceRunId && !input.messageId) {
      const run = context.activeRuns.find((item) => item.id === sourceRunId);
      if (run?.assistantMessageId) {
        const linked = this.repo.linkRunArtifactToMessage(artifact.id, run.assistantMessageId);
        if (linked) {
          artifact = linked.artifact;
          this.events.emit({
            type: "artifact.created",
            roomId: context.room.id,
            conversationId: context.conversation.id,
            runId: sourceRunId,
            payload: { artifact: linked.artifact },
          });
          this.events.emit({
            type: "message_block.created",
            roomId: context.room.id,
            conversationId: context.conversation.id,
            runId: sourceRunId,
            payload: { block: linked.block },
          });
        }
      }
    }

    return { artifact };
  }
}
