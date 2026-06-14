import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { nanoid } from "nanoid";
import {
  DEFAULT_PARTICIPANT_LISTEN_MODE,
  defaultReplyPolicy,
  type AddParticipantRequest,
  type AgentRun,
  type AgentRunEvent,
  type AgentRunEventType,
  type Artifact,
  type ArtifactKind,
  type ChatSnapshot,
  type CollaborationRuleEvent,
  type Conversation,
  type CreateIdentityRequest,
  type CreateRoomRequest,
  type Identity,
  type Message,
  type MessageBlock,
  type MentionTarget,
  type ParticipantListenMode,
  type Participant,
  type ReplyPolicy,
  type Room,
  type RuntimeProfile,
  type UpdateConversationRulesRequest,
  type UpdateConversationPolicyRequest,
  type UpdateIdentityRequest,
  type UpdateMessageRequest,
  type UpdateParticipantRequest,
  type UpdateRoomRequest,
  type UploadArtifactRequest,
  type PrivateTaskSnapshot,
} from "@group-chat/shared";
import { getDb, json, parseJson } from "../db/database.js";
import { ensureRoomDirs, roomArtifactRoot } from "../local/paths.js";

export interface PendingReplyQueueItem {
  id: string;
  roomId: string;
  conversationId: string;
  participantId: string;
  messageId: string;
  createdAt: string;
  updatedAt: string;
}

export class ChatRepository {
  ensureSeedData() {
    this.ensureRuntimeProfiles();
    const row = getDb().prepare(`SELECT COUNT(*) AS count FROM rooms`).get() as { count: number };
    if (row.count > 0) return;
    this.createRoom({
      title: "AI 讨论室",
      description: "默认 AI 群聊房间",
      participants: [],
    });
  }

  snapshot(): ChatSnapshot {
    const db = getDb();
    return {
      rooms: (db.prepare(`SELECT * FROM rooms ORDER BY created_at ASC`).all() as any[]).map(rowToRoom),
      conversations: (
        db.prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`).all() as any[]
      ).map(rowToConversation),
      participants: (
        db.prepare(`SELECT * FROM participants ORDER BY conversation_id ASC, sort_order ASC`).all() as any[]
      ).map(rowToParticipant),
      identities: (db.prepare(`SELECT * FROM identities ORDER BY created_at ASC`).all() as any[]).map(
        rowToIdentity,
      ),
      runtimeProfiles: (
        db.prepare(`SELECT * FROM runtime_profiles ORDER BY created_at ASC`).all() as any[]
      ).map(rowToRuntimeProfile),
      messages: (db.prepare(`SELECT * FROM messages ORDER BY created_at ASC`).all() as any[]).map(
        rowToMessage,
      ),
      messageBlocks: (
        db.prepare(`SELECT * FROM message_blocks ORDER BY sort_order ASC, created_at ASC`).all() as any[]
      ).map(rowToMessageBlock),
      agentRunEvents: (
        db.prepare(`SELECT * FROM agent_run_events ORDER BY created_at ASC`).all() as any[]
      ).map(rowToAgentRunEvent),
      artifacts: (db.prepare(`SELECT * FROM artifacts ORDER BY created_at ASC`).all() as any[]).map(
        rowToArtifact,
      ),
      activeRuns: (
        db.prepare(`SELECT * FROM agent_runs WHERE status IN ('accepted', 'running')`).all() as any[]
      ).map(rowToAgentRun),
      agentRuns: (db.prepare(`SELECT * FROM agent_runs ORDER BY created_at ASC`).all() as any[]).map(rowToAgentRun),
      lastSeq: (db.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM stream_events`).get() as { seq: number })
        .seq,
    };
  }

  listHiddenMessageIds(userParticipantId: string | null = null): Set<string> {
    const rows = getDb()
      .prepare(`SELECT message_id FROM hidden_messages WHERE user_participant_id = ?`)
      .all(userParticipantKey(userParticipantId)) as Array<{ message_id: string }>;
    return new Set(rows.map((row) => row.message_id));
  }

  hideMessageForLocalUser(messageId: string, conversationId: string, userParticipantId: string | null = null): boolean {
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `INSERT OR IGNORE INTO hidden_messages (message_id, conversation_id, user_participant_id, hidden_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(messageId, conversationId, userParticipantKey(userParticipantId), now);
    return result.changes > 0;
  }

  filterHiddenFromSnapshot(snapshot: ChatSnapshot): ChatSnapshot {
    return this.filterSnapshotForUser(snapshot, null);
  }

  filterSnapshotForUser(snapshot: ChatSnapshot, userParticipantId: string | null): ChatSnapshot {
    const hiddenIds = this.listHiddenMessageIds(userParticipantId);
    const hasUserContext = Boolean(userParticipantId);
    if (!hasUserContext && hiddenIds.size === 0) return snapshot;
    const messageById = new Map(snapshot.messages.map((message) => [message.id, message]));
    const runById = new Map(snapshot.agentRuns.map((run) => [run.id, run]));
    const visibleMessageCache = new Map<string, boolean>();
    const visibleRunCache = new Map<string, boolean>();

    const isMessageVisible = (message: Message): boolean => {
      if (hiddenIds.has(message.id)) return false;
      if (!hasUserContext || message.visibility !== "whisper") return true;
      const cached = visibleMessageCache.get(message.id);
      if (cached !== undefined) return cached;

      let visible = false;
      if (message.senderParticipantId === userParticipantId) {
        visible = true;
      } else if (message.role === "user") {
        visible = message.mentions.some(
          (mention) => mention.mentionType === "all" || mention.participantId === userParticipantId,
        );
      } else if (message.role === "assistant") {
        const run = message.runId ? runById.get(message.runId) : null;
        const trigger = run?.triggerMessageId ? messageById.get(run.triggerMessageId) : null;
        visible = trigger ? isMessageVisible(trigger) : message.senderParticipantId === userParticipantId;
      }
      visibleMessageCache.set(message.id, visible);
      return visible;
    };

    const isRunVisible = (run: AgentRun): boolean => {
      if (!hasUserContext || run.visibility !== "whisper") return true;
      const cached = visibleRunCache.get(run.id);
      if (cached !== undefined) return cached;

      let visible = run.participantId === userParticipantId;
      if (!visible && run.triggerMessageId) {
        const trigger = messageById.get(run.triggerMessageId);
        visible = trigger ? isMessageVisible(trigger) : false;
      }
      if (!visible && run.assistantMessageId) {
        const assistant = messageById.get(run.assistantMessageId);
        visible = assistant ? isMessageVisible(assistant) : false;
      }
      visibleRunCache.set(run.id, visible);
      return visible;
    };

    const messages = snapshot.messages.filter(isMessageVisible);
    const visibleMessageIds = new Set(messages.map((message) => message.id));
    const agentRuns = snapshot.agentRuns.filter(isRunVisible);
    const visibleRunIds = new Set(agentRuns.map((run) => run.id));
    return {
      ...snapshot,
      messages,
      messageBlocks: snapshot.messageBlocks.filter((block) => visibleMessageIds.has(block.messageId)),
      artifacts: snapshot.artifacts.filter(
        (artifact) =>
          (!artifact.messageId && !artifact.sourceRunId)
          || (artifact.messageId ? visibleMessageIds.has(artifact.messageId) : false)
          || (artifact.sourceRunId ? visibleRunIds.has(artifact.sourceRunId) : false),
      ),
      agentRuns,
      activeRuns: snapshot.activeRuns.filter(isRunVisible),
      agentRunEvents: snapshot.agentRunEvents.filter((event) => visibleRunIds.has(event.runId)),
    };
  }

  createRoom(input: CreateRoomRequest = {}) {
    const now = new Date().toISOString();
    const roomId = nanoid();
    const conversationId = nanoid();
    const policy = defaultReplyPolicy;
    const root = ensureRoomDirs(roomId);
    const title = input.title?.trim() || "New room";
    const description = input.description?.trim() || "";
    const db = getDb();
    db.prepare(
      `INSERT INTO rooms (id, title, description, artifact_root, default_reply_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(roomId, title, description, root, json(policy), now, now);
    db.prepare(
      `INSERT INTO conversations
       (id, room_id, type, title, group_system_prompt, collaboration_rules, collaboration_rules_version, reply_policy, active_branch_id, pinned, last_message, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 1, ?, NULL, 0, NULL, NULL, ?, ?)`,
    ).run(conversationId, roomId, "group", title, description, json(policy), now, now);

    const participants: NonNullable<CreateRoomRequest["participants"]> = input.participants ?? [];
    participants.forEach((participant, index) => {
      this.createParticipant(conversationId, {
        displayName: participant.displayName,
        kind: participant.kind ?? "ai",
        runtimeProfileId: participant.runtimeProfileId ?? this.getDefaultRuntimeProfileId(),
        identityId: participant.identityId ?? null,
        roomInstructions: participant.roomInstructions,
        listenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
        sortOrder: index,
      });
    });

    return this.getRoomBundle(roomId);
  }

  getRoomBundle(roomId: string) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    const conversation = this.getConversationByRoom(roomId);
    if (!conversation) throw new Error("Conversation not found");
    const participants = this.listParticipants(conversation.id);
    return { room, conversation, participants };
  }

  deleteRoom(roomId: string): { room: Room; conversation: Conversation | null } | null {
    const room = this.getRoom(roomId);
    if (!room) return null;
    const conversation = this.getConversationByRoom(roomId);
    getDb().prepare(`DELETE FROM rooms WHERE id = ?`).run(roomId);
    removeRoomArtifactRoot(room.id, room.artifactRoot);
    return { room, conversation };
  }

  updateRoom(roomId: string, input: UpdateRoomRequest) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    const conversation = this.getConversationByRoom(roomId);
    if (!conversation) throw new Error("Conversation not found");
    const now = new Date().toISOString();
    const title = input.title === undefined ? room.title : input.title.trim() || room.title;
    const description =
      input.description === undefined ? room.description : input.description.trim();
    const avatar = input.avatar === undefined ? room.avatar : input.avatar?.trim() || null;
    const db = getDb();
    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE rooms
         SET title = ?, description = ?, avatar = ?, updated_at = ?
         WHERE id = ?`,
      ).run(title, description, avatar, now, roomId);
      db.prepare(
        `UPDATE conversations
         SET title = ?, group_system_prompt = ?, updated_at = ?
         WHERE room_id = ?`,
      ).run(title, description, now, roomId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return this.getRoomBundle(roomId);
  }

  getRoom(roomId: string): Room | null {
    const row = getDb().prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId) as any;
    return row ? rowToRoom(row) : null;
  }

  getConversation(conversationId: string): Conversation | null {
    const row = getDb().prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId) as any;
    return row ? rowToConversation(row) : null;
  }

  updateConversationRules(
    conversationId: string,
    input: UpdateConversationRulesRequest,
  ): { conversation: Conversation; ruleEvent: CollaborationRuleEvent } | null {
    const current = this.getConversation(conversationId);
    if (!current) return null;
    const now = new Date().toISOString();
    const nextRules = input.collaborationRules.trim();
    const nextVersion = current.collaborationRulesVersion + 1;
    const eventId = nanoid();
    const db = getDb();
    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE conversations
         SET collaboration_rules = ?, collaboration_rules_version = ?, updated_at = ?
         WHERE id = ?`,
      ).run(nextRules, nextVersion, now, conversationId);
      db.prepare(
        `INSERT INTO collaboration_rule_events
         (id, conversation_id, version, previous_rules, next_rules, template_id, actor_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        eventId,
        conversationId,
        nextVersion,
        current.collaborationRules,
        nextRules,
        input.templateId?.trim() || null,
        "local-user",
        now,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const conversation = this.getConversation(conversationId);
    const ruleEvent = this.getCollaborationRuleEvent(eventId);
    if (!conversation || !ruleEvent) return null;
    return { conversation, ruleEvent };
  }

  getCollaborationRuleEvent(eventId: string): CollaborationRuleEvent | null {
    const row = getDb().prepare(`SELECT * FROM collaboration_rule_events WHERE id = ?`).get(eventId) as any;
    return row ? rowToCollaborationRuleEvent(row) : null;
  }

  listCollaborationRuleEvents(conversationId: string, limit = 20): CollaborationRuleEvent[] {
    const rows = getDb()
      .prepare(`SELECT * FROM collaboration_rule_events WHERE conversation_id = ? ORDER BY version DESC LIMIT ?`)
      .all(conversationId, Math.max(1, Math.min(100, Math.trunc(limit)))) as any[];
    return rows.map(rowToCollaborationRuleEvent);
  }

  updateConversationPolicy(conversationId: string, input: UpdateConversationPolicyRequest): Conversation | null {
    const current = this.getConversation(conversationId);
    if (!current) return null;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE conversations
         SET reply_policy = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(json(input.replyPolicy), now, conversationId);
    return this.getConversation(conversationId);
  }

  updateConversationPinned(conversationId: string, pinned: boolean): Conversation | null {
    const current = this.getConversation(conversationId);
    if (!current) return null;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE conversations
         SET pinned = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(pinned ? 1 : 0, now, conversationId);
    return this.getConversation(conversationId);
  }

  getConversationByRoom(roomId: string): Conversation | null {
    const row = getDb().prepare(`SELECT * FROM conversations WHERE room_id = ?`).get(roomId) as any;
    return row ? rowToConversation(row) : null;
  }

  listParticipants(conversationId: string): Participant[] {
    const rows = getDb()
      .prepare(`SELECT * FROM participants WHERE conversation_id = ? ORDER BY sort_order ASC`)
      .all(conversationId) as any[];
    return rows.map(rowToParticipant);
  }

  getParticipant(participantId: string): Participant | null {
    const row = getDb().prepare(`SELECT * FROM participants WHERE id = ?`).get(participantId) as any;
    return row ? rowToParticipant(row) : null;
  }

  createParticipant(
    conversationId: string,
    input: {
      displayName: string;
      kind: "human" | "ai";
      runtimeProfileId: string | null;
      identityId?: string | null;
      roomInstructions?: string;
      listenMode?: ParticipantListenMode;
      reasoningEffort?: string | null;
      sortOrder: number;
    },
  ): Participant {
    const now = new Date().toISOString();
    const id = nanoid();
    getDb()
      .prepare(
        `INSERT INTO participants
         (id, conversation_id, kind, display_name, avatar, runtime_profile_id, identity_id, room_instructions, status, listen_mode, sort_order, reasoning_effort, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        conversationId,
        input.kind,
        input.displayName,
        input.runtimeProfileId,
        input.identityId ?? null,
        input.roomInstructions?.trim() ?? "",
        input.listenMode ?? DEFAULT_PARTICIPANT_LISTEN_MODE,
        input.sortOrder,
        normalizeReasoningEffort(input.reasoningEffort),
        now,
        now,
      );
    return this.getParticipant(id)!;
  }

  addParticipantFromIdentity(conversationId: string, input: AddParticipantRequest): Participant {
    const identity = this.getIdentity(input.identityId);
    if (!identity) throw new Error("Identity not found");
    const runtimeProfileId = input.runtimeProfileId ?? identity.defaultRuntimeProfileId;
    if (!runtimeProfileId) throw new Error("Runtime profile is required");
    const row = getDb()
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM participants WHERE conversation_id = ?`)
      .get(conversationId) as { sort_order: number };
    return this.createParticipant(conversationId, {
      displayName: input.displayName?.trim() || identity.name,
      kind: "ai",
      runtimeProfileId,
      identityId: identity.id,
      roomInstructions: input.roomInstructions,
      listenMode: input.listenMode ?? identity.defaultListenMode ?? DEFAULT_PARTICIPANT_LISTEN_MODE,
      reasoningEffort: input.reasoningEffort ?? identity.defaultReasoningEffort,
      sortOrder: row.sort_order,
    });
  }

  updateParticipantStatus(participantId: string, status: "active" | "muted" | "removed") {
    const now = new Date().toISOString();
    getDb().prepare(`UPDATE participants SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, participantId);
    return this.getParticipant(participantId);
  }

  updateParticipantListenMode(participantId: string, listenMode: ParticipantListenMode) {
    const now = new Date().toISOString();
    getDb()
      .prepare(`UPDATE participants SET listen_mode = ?, updated_at = ? WHERE id = ?`)
      .run(listenMode, now, participantId);
    return this.getParticipant(participantId);
  }

  updateParticipant(participantId: string, input: UpdateParticipantRequest): Participant | null {
    const current = this.getParticipant(participantId);
    if (!current) return null;
    const now = new Date().toISOString();
    const next = {
      displayName: input.displayName?.trim() || current.displayName,
      runtimeProfileId: input.runtimeProfileId ?? current.runtimeProfileId,
      identityId: input.identityId ?? current.identityId,
      roomInstructions: input.roomInstructions === undefined ? current.roomInstructions : input.roomInstructions.trim(),
      listenMode: input.listenMode ?? current.listenMode,
      avatar: input.avatar === undefined ? current.avatar : input.avatar?.trim() || null,
      reasoningEffort:
        input.reasoningEffort === undefined
          ? current.reasoningEffort
          : normalizeReasoningEffort(input.reasoningEffort),
    };
    getDb()
      .prepare(
        `UPDATE participants
         SET display_name = ?, runtime_profile_id = ?, identity_id = ?, room_instructions = ?, listen_mode = ?, reasoning_effort = ?, avatar = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.displayName,
        next.runtimeProfileId,
        next.identityId,
        next.roomInstructions,
        next.listenMode,
        next.reasoningEffort,
        next.avatar,
        now,
        participantId,
      );
    return this.getParticipant(participantId);
  }

  getRuntimeProfile(runtimeProfileId: string): RuntimeProfile | null {
    const row = getDb().prepare(`SELECT * FROM runtime_profiles WHERE id = ?`).get(runtimeProfileId) as any;
    return row ? rowToRuntimeProfile(row) : null;
  }

  listRuntimeProfiles(): RuntimeProfile[] {
    const rows = getDb().prepare(`SELECT * FROM runtime_profiles ORDER BY created_at ASC`).all() as any[];
    return rows.map(rowToRuntimeProfile);
  }

  ensureRuntimeProfileForModel(baseProfile: RuntimeProfile, model: string): RuntimeProfile {
    const normalizedModel = model.trim();
    if (!normalizedModel || baseProfile.model === normalizedModel) return baseProfile;
    const id = `${baseProfile.id}__${modelSlug(normalizedModel)}`;
    const existing = this.getRuntimeProfile(id);
    if (existing) return existing;
    const now = new Date().toISOString();
    const profile: RuntimeProfile = {
      ...baseProfile,
      id,
      model: normalizedModel,
      createdAt: now,
      updatedAt: now,
    };
    getDb()
      .prepare(
        `INSERT INTO runtime_profiles
         (id, kind, provider, model, display_name, enabled, trusted_mode, system_prompt_mode, capabilities, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        profile.kind,
        profile.provider,
        profile.model,
        profile.displayName,
        profile.enabled ? 1 : 0,
        profile.trustedMode ? 1 : 0,
        profile.systemPromptMode,
        JSON.stringify(profile.capabilities),
        profile.createdAt,
        profile.updatedAt,
      );
    return profile;
  }

  private getDefaultRuntimeProfileId(): string | null {
    return this.listRuntimeProfiles().find((profile) => profile.enabled)?.id ?? null;
  }

  getIdentity(identityId: string): Identity | null {
    const row = getDb().prepare(`SELECT * FROM identities WHERE id = ?`).get(identityId) as any;
    return row ? rowToIdentity(row) : null;
  }

  createIdentity(input: CreateIdentityRequest): Identity {
    const now = new Date().toISOString();
    const id = nanoid();
    const fallbackRuntime = this.getDefaultRuntimeProfileId();
    getDb()
      .prepare(
        `INSERT INTO identities
         (id, name, icon, system_prompt, style_prompt, default_runtime_profile_id, default_listen_mode, default_reasoning_effort, temperature, skill_ids, tool_access_policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim() || "New member",
        input.icon?.trim() || "",
        input.systemPrompt?.trim() || "",
        input.stylePrompt?.trim() || "",
        input.defaultRuntimeProfileId ?? fallbackRuntime,
        input.defaultListenMode ?? DEFAULT_PARTICIPANT_LISTEN_MODE,
        normalizeReasoningEffort(input.defaultReasoningEffort),
        input.temperature ?? 0.7,
        json([]),
        json({ mode: "read-only", allowedToolIds: [] }),
        now,
        now,
      );
    return this.getIdentity(id)!;
  }

  updateIdentity(identityId: string, input: UpdateIdentityRequest): Identity | null {
    const current = this.getIdentity(identityId);
    if (!current) return null;
    const next = {
      name: input.name?.trim() || current.name,
      icon: input.icon !== undefined ? (input.icon.trim() || "") : current.icon,
      systemPrompt: input.systemPrompt ?? current.systemPrompt,
      stylePrompt: input.stylePrompt ?? current.stylePrompt,
      defaultRuntimeProfileId:
        input.defaultRuntimeProfileId === undefined
          ? current.defaultRuntimeProfileId
          : input.defaultRuntimeProfileId,
      defaultListenMode: input.defaultListenMode ?? current.defaultListenMode,
      defaultReasoningEffort:
        input.defaultReasoningEffort === undefined
          ? current.defaultReasoningEffort
          : normalizeReasoningEffort(input.defaultReasoningEffort),
      temperature: input.temperature ?? current.temperature,
      updatedAt: new Date().toISOString(),
    };
    getDb()
      .prepare(
        `UPDATE identities
         SET name = ?, icon = ?, system_prompt = ?, style_prompt = ?, default_runtime_profile_id = ?, default_listen_mode = ?, default_reasoning_effort = ?, temperature = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.icon,
        next.systemPrompt,
        next.stylePrompt,
        next.defaultRuntimeProfileId,
        next.defaultListenMode,
        next.defaultReasoningEffort,
        next.temperature,
        next.updatedAt,
        identityId,
      );
    return this.getIdentity(identityId);
  }

  identityUsageCount(identityId: string): number {
    const row = getDb()
      .prepare(
        `SELECT COUNT(DISTINCT p.conversation_id) AS count
         FROM participants p
         INNER JOIN conversations c ON c.id = p.conversation_id
         WHERE p.identity_id = ? AND p.status != 'removed' AND p.kind = 'ai'`,
      )
      .get(identityId) as { count: number };
    return row.count;
  }

  listActiveParticipantsByIdentity(identityId: string): Participant[] {
    const rows = getDb()
      .prepare(`SELECT * FROM participants WHERE identity_id = ? AND status != 'removed' ORDER BY created_at ASC`)
      .all(identityId) as any[];
    return rows.map(rowToParticipant);
  }

  deleteIdentity(identityId: string): { identity: Identity; removedParticipants: Participant[] } | null {
    const current = this.getIdentity(identityId);
    if (!current) return null;
    const now = new Date().toISOString();
    const participants = this.listActiveParticipantsByIdentity(identityId);
    getDb()
      .prepare(`UPDATE participants SET status = 'removed', updated_at = ? WHERE identity_id = ? AND status != 'removed'`)
      .run(now, identityId);
    getDb().prepare(`DELETE FROM identities WHERE id = ?`).run(identityId);
    return {
      identity: current,
      removedParticipants: participants.map((participant) => ({
        ...participant,
        status: "removed",
        updatedAt: now,
      })),
    };
  }

  createMessage(input: {
    conversationId: string;
    role: "user" | "assistant" | "system" | "tool";
    senderParticipantId?: string | null;
    senderName?: string | null;
    content?: string;
    mentions?: MentionTarget[];
    visibility?: Message["visibility"];
    status?: "pending" | "streaming" | "success" | "error" | "cancelled";
    parentMessageId?: string | null;
    runId?: string | null;
  }): Message {
    const id = nanoid();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO messages
         (id, conversation_id, role, sender_participant_id, sender_name, content, mentions, visibility, status, branch_id, parent_message_id, run_id, token_usage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.role,
        input.senderParticipantId ?? null,
        input.senderName ?? null,
        input.content ?? "",
        json(input.mentions ?? []),
        input.visibility ?? "public",
        input.status ?? "success",
        input.parentMessageId ?? null,
        input.runId ?? null,
        now,
        now,
      );
    return this.getMessage(id)!;
  }

  getMessage(messageId: string): Message | null {
    const row = getDb().prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as any;
    return row ? rowToMessage(row) : null;
  }

  listRecentMessages(conversationId: string, limit = 24): Message[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(conversationId, limit) as any[];
    return rows.reverse().map(rowToMessage);
  }

  updateMessage(
    messageId: string,
    updates: Partial<Pick<Message, "content" | "status" | "runId" | "mentions" | "visibility">>,
  ) {
    const current = this.getMessage(messageId);
    if (!current) return null;
    const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
    getDb()
      .prepare(`UPDATE messages SET content = ?, mentions = ?, visibility = ?, status = ?, run_id = ?, updated_at = ? WHERE id = ?`)
      .run(next.content, json(next.mentions), next.visibility, next.status, next.runId, next.updatedAt, messageId);
    return this.getMessage(messageId);
  }

  updateUserMessage(messageId: string, input: UpdateMessageRequest) {
    const current = this.getMessage(messageId);
    if (!current) return null;
    if (current.role !== "user") throw new Error("Only user messages can be edited");
    const content = input.content?.trim();
    if (!content) throw new Error("Message content is required");
    const message = this.updateMessage(messageId, {
      content,
      status: "success",
      mentions: input.mentions ?? current.mentions,
    });
    const mainBlock = this.listMessageBlocks(messageId).find((block) => block.type === "main_text");
    const block = mainBlock ? this.updateMessageBlock(mainBlock.id, { content, status: "success" }) : null;
    return { message, block };
  }

  markMessageStatus(messageId: string, status: "deleted" | "recalled") {
    const current = this.getMessage(messageId);
    if (!current) return null;
    const message = this.updateMessage(messageId, {
      content: "",
      status,
    });
    const blocks = this.listMessageBlocks(messageId)
      .filter((block) => block.type === "main_text")
      .map((block) => this.updateMessageBlock(block.id, { content: "", status: "success" }))
      .filter((block): block is MessageBlock => Boolean(block));
    return { message, blocks };
  }

  touchConversation(conversationId: string, lastMessage: string | null) {
    const now = new Date().toISOString();
    getDb()
      .prepare(`UPDATE conversations SET last_message = ?, last_message_at = ?, updated_at = ? WHERE id = ?`)
      .run(lastMessage, now, now, conversationId);
    return this.getConversation(conversationId);
  }

  createMessageBlock(input: {
    messageId: string;
    type: MessageBlock["type"];
    content: string;
    status?: MessageBlock["status"];
    metadata?: Record<string, unknown> | null;
    sortOrder?: number;
  }): MessageBlock {
    const id = nanoid();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO message_blocks
         (id, message_id, type, content, status, metadata, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.messageId,
        input.type,
        input.content,
        input.status ?? "success",
        input.metadata ? json(input.metadata) : null,
        input.sortOrder ?? 0,
        now,
        now,
      );
    return this.getMessageBlock(id)!;
  }

  getMessageBlock(blockId: string): MessageBlock | null {
    const row = getDb().prepare(`SELECT * FROM message_blocks WHERE id = ?`).get(blockId) as any;
    return row ? rowToMessageBlock(row) : null;
  }

  updateMessageBlock(blockId: string, updates: Partial<Pick<MessageBlock, "content" | "status" | "metadata">>) {
    const current = this.getMessageBlock(blockId);
    if (!current) return null;
    const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
    getDb()
      .prepare(`UPDATE message_blocks SET content = ?, status = ?, metadata = ?, updated_at = ? WHERE id = ?`)
      .run(next.content, next.status, next.metadata ? json(next.metadata) : null, next.updatedAt, blockId);
    return this.getMessageBlock(blockId);
  }

  listMessageBlocks(messageId: string): MessageBlock[] {
    const rows = getDb()
      .prepare(`SELECT * FROM message_blocks WHERE message_id = ? ORDER BY sort_order ASC, created_at ASC`)
      .all(messageId) as any[];
    return rows.map(rowToMessageBlock);
  }

  createAgentRun(input: {
    roomId: string;
    conversationId: string;
    participantId: string | null;
    assistantMessageId: string | null;
    triggerMessageId?: string | null;
    runtime: string;
    provider: string;
    model: string;
    visibility?: AgentRun["visibility"];
  }): AgentRun {
    const id = nanoid();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_runs
         (id, conversation_id, room_id, participant_id, assistant_message_id, trigger_message_id, runtime, provider, model, visibility, status, resume_mode, created_at, updated_at, completed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', 'fresh', ?, ?, NULL, NULL)`,
      )
      .run(
        id,
        input.conversationId,
        input.roomId,
        input.participantId,
        input.assistantMessageId,
        input.triggerMessageId ?? null,
        input.runtime,
        input.provider,
        input.model,
        input.visibility ?? "public",
        now,
        now,
      );
    return this.getAgentRun(id)!;
  }

  getAgentRun(runId: string): AgentRun | null {
    const row = getDb().prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(runId) as any;
    return row ? rowToAgentRun(row) : null;
  }

  listActiveAgentRuns(): AgentRun[] {
    const rows = getDb()
      .prepare(`SELECT * FROM agent_runs WHERE status IN ('accepted', 'running') ORDER BY created_at ASC`)
      .all() as any[];
    return rows.map(rowToAgentRun);
  }

  listActiveAgentRunsForTriggerMessage(triggerMessageId: string): AgentRun[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_runs
         WHERE trigger_message_id = ? AND status IN ('accepted', 'running')
         ORDER BY created_at ASC`,
      )
      .all(triggerMessageId) as any[];
    return rows.map(rowToAgentRun);
  }

  updateAgentRun(runId: string, updates: Partial<Pick<AgentRun, "status" | "assistantMessageId" | "error">>) {
    const current = this.getAgentRun(runId);
    if (!current) return null;
    const now = new Date().toISOString();
    const completedAt =
      updates.status && ["completed", "failed", "cancelled"].includes(updates.status) ? now : current.completedAt;
    getDb()
      .prepare(
        `UPDATE agent_runs
         SET status = ?, assistant_message_id = ?, error = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updates.status ?? current.status,
        updates.assistantMessageId ?? current.assistantMessageId,
        updates.error ?? current.error,
        completedAt,
        now,
        runId,
      );
    return this.getAgentRun(runId);
  }

  createAgentRunEvent(input: {
    runId: string;
    conversationId: string;
    type: AgentRunEventType;
    content?: string;
    status?: AgentRunEvent["status"];
    metadata?: Record<string, unknown> | null;
    sortOrder?: number;
  }): AgentRunEvent {
    const id = nanoid();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_run_events
         (id, run_id, conversation_id, type, content, status, metadata, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.conversationId,
        input.type,
        input.content ?? "",
        input.status ?? "success",
        input.metadata ? json(input.metadata) : null,
        input.sortOrder ?? 0,
        now,
      );
    return this.getAgentRunEvent(id)!;
  }

  updateAgentRunEvent(
    eventId: string,
    updates: Partial<Pick<AgentRunEvent, "content" | "status" | "metadata">>,
  ): AgentRunEvent | null {
    const current = this.getAgentRunEvent(eventId);
    if (!current) return null;
    const next = {
      ...current,
      ...updates,
      content: updates.content ?? current.content,
      status: updates.status ?? current.status,
      metadata: updates.metadata === undefined ? current.metadata : updates.metadata,
    };
    getDb()
      .prepare(`UPDATE agent_run_events SET content = ?, status = ?, metadata = ? WHERE id = ?`)
      .run(next.content, next.status, next.metadata ? json(next.metadata) : null, eventId);
    return this.getAgentRunEvent(eventId);
  }

  getAgentRunEvent(eventId: string): AgentRunEvent | null {
    const row = getDb().prepare(`SELECT * FROM agent_run_events WHERE id = ?`).get(eventId) as any;
    return row ? rowToAgentRunEvent(row) : null;
  }

  listAgentRunEvents(runId: string): AgentRunEvent[] {
    const rows = getDb()
      .prepare(`SELECT * FROM agent_run_events WHERE run_id = ? ORDER BY sort_order ASC, created_at ASC`)
      .all(runId) as any[];
    return rows.map(rowToAgentRunEvent);
  }

  upsertPendingReply(input: {
    roomId: string;
    conversationId: string;
    participantId: string;
    messageId: string;
  }): PendingReplyQueueItem {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO reply_queue (id, room_id, conversation_id, participant_id, message_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id, participant_id) DO UPDATE SET
           room_id = excluded.room_id,
           message_id = excluded.message_id,
           updated_at = excluded.updated_at`,
      )
      .run(nanoid(), input.roomId, input.conversationId, input.participantId, input.messageId, now, now);
    return this.getPendingReply(input.conversationId, input.participantId)!;
  }

  getPendingReply(conversationId: string, participantId: string): PendingReplyQueueItem | null {
    const row = getDb()
      .prepare(`SELECT * FROM reply_queue WHERE conversation_id = ? AND participant_id = ?`)
      .get(conversationId, participantId) as any;
    return row ? rowToPendingReplyQueueItem(row) : null;
  }

  consumePendingReply(conversationId: string, participantId: string): PendingReplyQueueItem | null {
    const item = this.getPendingReply(conversationId, participantId);
    if (!item) return null;
    getDb().prepare(`DELETE FROM reply_queue WHERE id = ?`).run(item.id);
    return item;
  }

  deletePendingRepliesForMessage(messageId: string) {
    getDb().prepare(`DELETE FROM reply_queue WHERE message_id = ?`).run(messageId);
  }

  listPendingReplies(): PendingReplyQueueItem[] {
    const rows = getDb().prepare(`SELECT * FROM reply_queue ORDER BY updated_at ASC`).all() as any[];
    return rows.map(rowToPendingReplyQueueItem);
  }

  createArtifact(
    conversationId: string,
    input: UploadArtifactRequest,
    options: { kind?: ArtifactKind; messageId?: string | null; sourceRunId?: string | null } = {},
  ): Artifact {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const room = this.getRoom(conversation.roomId);
    if (!room) throw new Error("Room not found");
    const roomRoot = existsSync(room.artifactRoot) ? room.artifactRoot : ensureRoomDirs(room.id);
    mkdirSync(join(roomRoot, "uploads"), { recursive: true });
    const id = nanoid();
    const filename = safeFilename(input.filename);
    const extension = extname(filename);
    const storedName = `${id}${extension}`;
    const localPath = join(roomRoot, "uploads", storedName);
    const bytes = Buffer.from(input.dataBase64, "base64");
    writeFileSync(localPath, bytes);
    const textPreview = buildTextPreview(localPath, input.mimeType);
    const publicUrl = `/local-assets/${id}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO artifacts
         (id, room_id, conversation_id, message_id, source_run_id, kind, filename, mime_type, size_bytes, local_path, public_url, text_preview, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        room.id,
        conversationId,
        options.messageId ?? null,
        options.sourceRunId ?? null,
        options.kind ?? "upload",
        filename,
        input.mimeType,
        bytes.length,
        localPath,
        publicUrl,
        textPreview,
        now,
      );
    return this.getArtifact(id)!;
  }

  attachArtifactToMessage(artifactId: string, messageId: string) {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) return null;
    if (!artifact.messageId || artifact.messageId === messageId) {
      getDb().prepare(`UPDATE artifacts SET message_id = ? WHERE id = ?`).run(messageId, artifactId);
      return this.getArtifact(artifactId);
    }
    const id = nanoid();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO artifacts
         (id, room_id, conversation_id, message_id, source_run_id, kind, filename, mime_type, size_bytes, local_path, public_url, text_preview, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        artifact.roomId,
        artifact.conversationId,
        messageId,
        artifact.sourceRunId,
        artifact.kind,
        artifact.filename,
        artifact.mimeType,
        artifact.sizeBytes,
        artifact.localPath,
        `/local-assets/${id}`,
        artifact.textPreview,
        now,
      );
    return this.getArtifact(id);
  }

  getArtifact(artifactId: string): Artifact | null {
    const row = getDb().prepare(`SELECT * FROM artifacts WHERE id = ?`).get(artifactId) as any;
    return row ? rowToArtifact(row) : null;
  }

  listArtifactsForMessage(messageId: string): Artifact[] {
    const rows = getDb()
      .prepare(`SELECT * FROM artifacts WHERE message_id = ? ORDER BY created_at ASC`)
      .all(messageId) as any[];
    return rows.map(rowToArtifact);
  }

  private ensureRuntimeProfiles() {
    const now = new Date().toISOString();
    const profiles: RuntimeProfile[] = [
      {
        id: "local-agent:codex",
        kind: "local-agent",
        provider: "codex",
        model: "codex:default",
        displayName: "Codex Local Agent",
        enabled: true,
        trustedMode: false,
        systemPromptMode: "prompt-prefix",
        capabilities: {
          streaming: true,
          toolUse: true,
          reasoning: true,
          vision: false,
          resume: true,
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "local-agent:claude",
        kind: "local-agent",
        provider: "claude",
        model: "claude:default",
        displayName: "Claude Local Agent",
        enabled: true,
        trustedMode: false,
        systemPromptMode: "prompt-prefix",
        capabilities: {
          streaming: true,
          toolUse: true,
          reasoning: true,
          vision: false,
          resume: true,
        },
        createdAt: now,
        updatedAt: now,
      },
    ];
    for (const profile of profiles) {
      getDb()
        .prepare(
          `INSERT OR IGNORE INTO runtime_profiles
           (id, kind, provider, model, display_name, enabled, trusted_mode, system_prompt_mode, capabilities, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          profile.id,
          profile.kind,
          profile.provider,
          profile.model,
          profile.displayName,
          profile.enabled ? 1 : 0,
          profile.trustedMode ? 1 : 0,
          profile.systemPromptMode,
          json(profile.capabilities),
          profile.createdAt,
          profile.updatedAt,
        );
    }
  }

  upsertPrivateTask(task: PrivateTaskSnapshot) {
    getDb()
      .prepare(
        `INSERT INTO private_tasks
         (id, conversation_id, type, source_message_id, source_message_ids, participant_id, participant_name, requester_participant_id, source_preview, status, content, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           content = excluded.content,
           error = excluded.error,
           source_preview = excluded.source_preview,
           updated_at = excluded.updated_at`,
      )
      .run(
        task.id,
        task.conversationId,
        task.type,
        task.sourceMessageId,
        json(task.sourceMessageIds ?? []),
        task.participantId,
        task.participantName,
        task.requesterParticipantId ?? null,
        task.sourcePreview,
        task.status,
        task.content,
        task.error,
        task.createdAt,
        task.updatedAt,
      );
    return this.getPrivateTask(task.id)!;
  }

  updatePrivateTaskContent(taskId: string, content: string) {
    const now = new Date().toISOString();
    getDb()
      .prepare(`UPDATE private_tasks SET content = ?, status = 'running', updated_at = ? WHERE id = ?`)
      .run(content, now, taskId);
    return this.getPrivateTask(taskId);
  }

  getPrivateTask(taskId: string): PrivateTaskSnapshot | null {
    const row = getDb().prepare(`SELECT * FROM private_tasks WHERE id = ?`).get(taskId) as any;
    return row ? rowToPrivateTask(row) : null;
  }

  listPrivateTasksForConversation(conversationId: string, requesterParticipantId: string | null = null): PrivateTaskSnapshot[] {
    const rows = requesterParticipantId
      ? getDb()
          .prepare(
            `SELECT * FROM private_tasks
             WHERE conversation_id = ? AND requester_participant_id = ?
             ORDER BY updated_at DESC`,
          )
          .all(conversationId, requesterParticipantId) as any[]
      : getDb()
          .prepare(`SELECT * FROM private_tasks WHERE conversation_id = ? ORDER BY updated_at DESC`)
          .all(conversationId) as any[];
    return rows.map(rowToPrivateTask);
  }

}

function rowToRoom(row: any): Room {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    avatar: row.avatar ?? null,
    artifactRoot: row.artifact_root,
    defaultReplyPolicy: parseJson<ReplyPolicy>(row.default_reply_policy, defaultReplyPolicy),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    roomId: row.room_id,
    type: row.type,
    title: row.title,
    groupSystemPrompt: row.group_system_prompt,
    collaborationRules: row.collaboration_rules ?? "",
    collaborationRulesVersion: row.collaboration_rules_version ?? 1,
    replyPolicy: parseJson<ReplyPolicy>(row.reply_policy, defaultReplyPolicy),
    activeBranchId: row.active_branch_id,
    pinned: row.pinned === 1,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCollaborationRuleEvent(row: any): CollaborationRuleEvent {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    version: row.version,
    previousRules: row.previous_rules,
    nextRules: row.next_rules,
    templateId: row.template_id,
    actorName: row.actor_name,
    createdAt: row.created_at,
  };
}

function rowToParticipant(row: any): Participant {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    displayName: row.display_name,
    avatar: row.avatar,
    runtimeProfileId: row.runtime_profile_id,
    identityId: row.identity_id,
    roomInstructions: row.room_instructions ?? "",
    status: row.status,
    listenMode: row.listen_mode ?? DEFAULT_PARTICIPANT_LISTEN_MODE,
    sortOrder: row.sort_order,
    reasoningEffort: row.reasoning_effort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRuntimeProfile(row: any): RuntimeProfile {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    displayName: row.display_name,
    enabled: row.enabled === 1,
    trustedMode: row.trusted_mode === 1,
    systemPromptMode: row.system_prompt_mode,
    capabilities: parseJson(row.capabilities, {
      streaming: false,
      toolUse: false,
      reasoning: false,
      vision: false,
      resume: false,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToIdentity(row: any): Identity {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    systemPrompt: row.system_prompt,
    stylePrompt: row.style_prompt,
    defaultRuntimeProfileId: row.default_runtime_profile_id,
    defaultListenMode: row.default_listen_mode ?? DEFAULT_PARTICIPANT_LISTEN_MODE,
    defaultReasoningEffort: row.default_reasoning_effort ?? null,
    temperature: row.temperature,
    skillIds: parseJson(row.skill_ids, []),
    toolAccessPolicy: parseJson(row.tool_access_policy, { mode: "none", allowedToolIds: [] }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    senderParticipantId: row.sender_participant_id,
    senderName: row.sender_name,
    content: row.content,
    mentions: parseJson<MentionTarget[]>(row.mentions, []),
    visibility: row.visibility === "whisper" ? "whisper" : "public",
    status: row.status,
    branchId: row.branch_id,
    parentMessageId: row.parent_message_id,
    runId: row.run_id,
    tokenUsage: parseJson(row.token_usage, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessageBlock(row: any): MessageBlock {
  return {
    id: row.id,
    messageId: row.message_id,
    type: row.type,
    content: row.content,
    status: row.status,
    metadata: parseJson(row.metadata, null),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToArtifact(row: any): Artifact {
  return {
    id: row.id,
    roomId: row.room_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    sourceRunId: row.source_run_id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    localPath: row.local_path,
    publicUrl: row.public_url,
    textPreview: row.text_preview,
    createdAt: row.created_at,
  };
}

function rowToAgentRun(row: any): AgentRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    roomId: row.room_id,
    participantId: row.participant_id,
    assistantMessageId: row.assistant_message_id,
    triggerMessageId: row.trigger_message_id ?? null,
    runtime: row.runtime,
    provider: row.provider,
    model: row.model,
    status: row.status,
    visibility: row.visibility === "whisper" ? "whisper" : "public",
    resumeMode: row.resume_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

function rowToAgentRunEvent(row: any): AgentRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    type: row.type,
    content: row.content,
    status: row.status,
    metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function rowToPendingReplyQueueItem(row: any): PendingReplyQueueItem {
  return {
    id: row.id,
    roomId: row.room_id,
    conversationId: row.conversation_id,
    participantId: row.participant_id,
    messageId: row.message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPrivateTask(row: any): PrivateTaskSnapshot {
  const sourceMessageIds = parseJson<string[]>(row.source_message_ids, []);
  return {
    id: row.id,
    type: row.type,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    sourceMessageIds: sourceMessageIds.length
      ? sourceMessageIds
      : row.source_message_id
        ? [row.source_message_id]
        : [],
    participantId: row.participant_id,
    participantName: row.participant_name,
    requesterParticipantId: row.requester_participant_id ?? null,
    sourcePreview: row.source_preview,
    status: row.status,
    content: row.content,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeFilename(filename: string) {
  const clean = basename(filename).replace(/[^\w.\- ()]/g, "_");
  return clean || "upload.bin";
}

function normalizeReasoningEffort(value: string | null | undefined) {
  if (!value) return null;
  return ["low", "medium", "high", "xhigh"].includes(value) ? value : null;
}

function modelSlug(model: string) {
  const slug = model.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return slug.slice(0, 80) || "default";
}

function userParticipantKey(userParticipantId: string | null | undefined) {
  return userParticipantId?.trim() || "local-user";
}

function removeRoomArtifactRoot(roomId: string, artifactRoot: string) {
  const expectedRoot = resolve(roomArtifactRoot(roomId));
  const actualRoot = resolve(artifactRoot);
  if (actualRoot !== expectedRoot) return;
  rmSync(actualRoot, { recursive: true, force: true });
}

function buildTextPreview(path: string, mimeType: string) {
  const lower = path.toLowerCase();
  const textLike =
    mimeType.startsWith("text/") ||
    lower.endsWith(".md") ||
    lower.endsWith(".json") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".log");
  if (!textLike) return null;
  const text = readFileSync(path, "utf8");
  return text.slice(0, 4000);
}
