import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, MessageCircle, WifiOff } from "lucide-react";
import { enrichAgentRuns, isLocalUserMessage, resolveAgentRunVisibility, type AgentRun,
  type Conversation,
  type CreateIdentityRequest,
  type Identity,
  type LocalAgentProviderStatus,
  type Message,
  type Participant,
  type PrivateTaskSnapshot,
  type Room,
  type StreamEvent,
  type UpdateIdentityRequest,
  type UpdateMessageRequest,
  type UpdateParticipantRequest,
  type UpdateRoomRequest,
  type WsServerMessage,
} from "@group-chat/shared";
import {
  addParticipant,
  cancelRun,
  createIdentity,
  createRoom,
  deleteMessage,
  deleteParticipant,
  deleteRoom,
  deleteIdentity,
  fetchLocalAgentProviders,
  fetchSnapshot,
  type SendMessageResponse,
  sendMessage,
  setParticipantMuted,
  startPrivateTask,
  cancelPrivateTask,
  getPrivateTask,
  updateIdentity,
  updateMessage,
  updateParticipant,
  updateRoom,
  updateConversationPin,
  uploadArtifact,
} from "../api/client.js";
import { ConversationSidebar } from "./components/chat/ConversationSidebar.js";
import { ChatHeader } from "./components/chat/ChatHeader.js";
import { ConversationFilesPanel } from "./components/chat/ConversationFilesPanel.js";
import { AgentRunPanel } from "./components/chat/AgentRunPanel.js";
import { AgentThinkingPanel } from "./components/chat/AgentThinkingPanel.js";
import { RoomAgentsDialog } from "./components/chat/RoomAgentsDialog.js";
import { AgentProfileDialog } from "./components/chat/AgentProfileDialog.js";
import { MessageTimeline } from "./components/chat/MessageTimeline.js";
import { DeleteMessageConfirmDialog } from "./components/chat/DeleteMessageConfirmDialog.js";
import { Composer } from "./components/chat/Composer.js";
import { BackgroundTaskBar } from "./components/chat/BackgroundTaskBar.js";
import { AppNavRail } from "./components/nav/AppNavRail.js";
import { ProfileMenu } from "./components/settings/ProfileMenu.js";
import { SettingsDialog } from "./components/settings/SettingsDialog.js";
import { TeamMembersPage } from "./components/team/TeamMembersPage.js";
import { loadUserProfile, saveUserProfile, type LocalUserProfile } from "./user-profile.js";
import {
  countUnreadMessages,
  loadConversationReadAt,
  resolveLatestConversationActivityAt,
  saveConversationReadAt,
  type ConversationReadAtMap,
} from "./conversation-read-state.js";
import { UnreadBadge } from "./components/ui/UnreadBadge.js";
import { applyEvent, applyRoomUpdate, emptyState, normalizeSnapshot, removeActiveRun, removeDeletedRoom, removeHiddenMessages, upsert, upsertIdentity, upsertMany, upsertMessage, upsertParticipant, type AppState } from "./state.js";
import { backgroundTaskFromSnapshot, createOptimisticBackgroundTask, enrichBackgroundTask, loadDismissedBackgroundTaskIds, loadLocalTaskBarTaskIds, mergeBackgroundTask, removeLocalTaskBarTaskId, saveDismissedBackgroundTaskIds, addLocalTaskBarTaskId, type AgentRunTaskItem, type BackgroundTask } from "./background-tasks.js";
import { resolveAgentProfileParticipant, resolveMessageAgentParticipant, resolveMessageSenderLabel, messageSenderLabel } from "./chat-links.js";
import { collectMessageProcess } from "./agent-thinking.js";

const DEFAULT_CONVERSATION_SIDEBAR_WIDTH = 300;
const MIN_CONVERSATION_SIDEBAR_WIDTH = 240;
const MIN_CHAT_PANE_WIDTH = 460;
const SPLITTER_WIDTH = 8;
const DESKTOP_NAV_WIDTH = 60;
const COMPACT_NAV_WIDTH = 56;

export type ComposerRequest =
  | { type: "insert"; seq: number; content: string }
  | { type: "quote"; seq: number; quote: ComposerQuote }
  | { type: "quotes"; seq: number; quotes: ComposerQuote[] }
  | { type: "edit"; seq: number; messageId: string; content: string; mentions: Message["mentions"] };

export interface ComposerQuote {
  messageId: string;
  sender: string;
  content: string;
}

export function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [localAgentProviders, setLocalAgentProviders] = useState<LocalAgentProviderStatus[]>([]);
  const [refreshingLocalAgentProviders, setRefreshingLocalAgentProviders] = useState(false);
  const [activeSection, setActiveSection] = useState<"chats" | "team">("chats");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileMenuPlacement, setProfileMenuPlacement] = useState<"rail" | "mobile" | "chat">("rail");
  const [profileMenuAnchorEl, setProfileMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<LocalUserProfile>(() => loadUserProfile());
  const saveUserProfileState = useCallback((profile: LocalUserProfile) => {
    setUserProfile(profile);
    saveUserProfile(profile);
  }, []);
  const [membersPanelOpen, setMembersPanelOpen] = useState(false);
  const [membersPanelStartAdding, setMembersPanelStartAdding] = useState(false);
  const [agentProfileParticipantId, setAgentProfileParticipantId] = useState<string | null>(null);
  const [agentProfileShowRemove, setAgentProfileShowRemove] = useState(false);
  const [pendingAgentSetupIdentityId, setPendingAgentSetupIdentityId] = useState<string | null>(null);
  const [teamFocusIdentityId, setTeamFocusIdentityId] = useState<string | null>(null);
  const [teamSelectedIdentityId, setTeamSelectedIdentityId] = useState<string | null>(null);
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  const [openAgentRunId, setOpenAgentRunId] = useState<string | null>(null);
  const [openAgentRunSnapshot, setOpenAgentRunSnapshot] = useState<AgentRun | null>(null);
  const [openThinkingMessageId, setOpenThinkingMessageId] = useState<string | null>(null);
  const [mentionRequest, setMentionRequest] = useState<{ participantId: string; seq: number } | null>(null);
  const [composerRequest, setComposerRequest] = useState<ComposerRequest | null>(null);
  const [conversationSidebarWidth, setConversationSidebarWidth] = useState(DEFAULT_CONVERSATION_SIDEBAR_WIDTH);
  const [resizingConversationSidebar, setResizingConversationSidebar] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [focusMessageRequest, setFocusMessageRequest] = useState<{ messageId: string; seq: number } | null>(null);
  const [scrollToBottomRequest, setScrollToBottomRequest] = useState<{ seq: number } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const lastSeqRef = useRef(0);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileProfileButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const chatProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const deleteDialogRef = useRef<{ resolve: () => void; reject: (reason?: unknown) => void } | null>(null);
  const timelineScrollPreserverRef = useRef<{ capture: () => void } | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<{ ids: string[] } | null>(null);
  const [deletingMessages, setDeletingMessages] = useState(false);

  const openProfileMenu = useCallback((placement: "rail" | "mobile" | "chat", anchorEl?: HTMLElement | null) => {
    setProfileMenuPlacement(placement);
    setProfileMenuAnchorEl(anchorEl ?? null);
    setProfileMenuOpen(true);
  }, []);

  const closeProfileMenu = useCallback(() => {
    setProfileMenuOpen(false);
    setProfileMenuAnchorEl(null);
  }, []);

  const toggleProfileMenu = useCallback((placement: "rail" | "mobile") => {
    setProfileMenuPlacement(placement);
    setProfileMenuOpen((current) => !current);
  }, []);
  const [bulkToolbarHost, setBulkToolbarHost] = useState<HTMLDivElement | null>(null);
  const [messageSelectionMode, setMessageSelectionMode] = useState(false);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [dismissedBackgroundTaskIds, setDismissedBackgroundTaskIds] = useState<Set<string>>(() => loadDismissedBackgroundTaskIds());
  const [openBackgroundTaskId, setOpenBackgroundTaskId] = useState<string | null>(null);
  const [conversationReadAt, setConversationReadAt] = useState<ConversationReadAtMap>(() => loadConversationReadAt());

  const refreshLocalAgentProviders = useCallback(async () => {
    setRefreshingLocalAgentProviders(true);
    try {
      const result = await fetchLocalAgentProviders();
      setLocalAgentProviders(result.providers);
    } catch {
      setLocalAgentProviders([]);
    } finally {
      setRefreshingLocalAgentProviders(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot().then((snapshot) => {
      if (cancelled) return;
      lastSeqRef.current = snapshot.lastSeq;
      setState(normalizeSnapshot(snapshot));
      setCurrentConversationId((current) => current ?? snapshot.conversations[0]?.id ?? null);
    });
    void refreshLocalAgentProviders();
    return () => {
      cancelled = true;
    };
  }, [refreshLocalAgentProviders]);

  const applyEvents = useCallback((events: StreamEvent[]) => {
    if (events.length === 0) return;
    setState((current) => {
      let next = current;
      const pending = [...events].sort((left, right) => left.seq - right.seq);
      for (const event of pending) {
        if (event.seq <= lastSeqRef.current) continue;
        next = applyEvent(next, event);
        lastSeqRef.current = event.seq;
      }
      return next;
    });
  }, []);

  const applyPrivateTaskSnapshot = useCallback((snapshot: PrivateTaskSnapshot) => {
    if (!loadLocalTaskBarTaskIds().has(snapshot.id)) return;
    setBackgroundTasks((current) => {
      const existing = current.find((task) => task.id === snapshot.id);
      if (existing) {
        return current.map((task) => (task.id === snapshot.id ? mergeBackgroundTask(task, snapshot) : task));
      }
      return [...current, {
        ...snapshot,
        panelOpen: false,
        sourceMessage: null,
        sourceMessageIds: snapshot.sourceMessageIds?.length
          ? snapshot.sourceMessageIds
          : snapshot.sourceMessageId
            ? [snapshot.sourceMessageId]
            : [],
        targetParticipant: null,
      }];
    });
  }, []);

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "private_task.started" || event.type === "private_task.completed" || event.type === "private_task.failed" || event.type === "private_task.cancelled") {
      const task = payload.task as PrivateTaskSnapshot | undefined;
      if (task) applyPrivateTaskSnapshot(task);
      if (event.seq) lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
      return;
    }
    if (event.type === "private_task.delta") {
      const taskId = payload.taskId as string | undefined;
      const content = payload.content as string | undefined;
      if (taskId && typeof content === "string" && loadLocalTaskBarTaskIds().has(taskId)) {
        setBackgroundTasks((current) =>
          current.map((task) =>
            task.id === taskId ? { ...task, content, status: "running", updatedAt: new Date().toISOString() } : task,
          ),
        );
      }
      if (event.seq) lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
      return;
    }
    applyEvents([event]);
  }, [applyEvents, applyPrivateTaskSnapshot]);

  useEffect(() => {
    if (!state.ready) return;
    setConnectionStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    ws.addEventListener("open", () => {
      setConnectionStatus("connected");
      ws.send(JSON.stringify({ type: "hello", lastSeq: lastSeqRef.current }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as WsServerMessage;
      if (message.type === "event" && message.event) {
        handleStreamEvent(message.event);
      } else if (message.type === "replay" && message.events) {
        applyEvents(message.events);
      }
    });
    ws.addEventListener("close", () => setConnectionStatus("disconnected"));
    ws.addEventListener("error", () => setConnectionStatus("disconnected"));
    return () => ws.close();
  }, [state.ready, handleStreamEvent, applyEvents]);

  const currentConversation = state.conversations.find((item) => item.id === currentConversationId) ?? null;
  const currentRoom = currentConversation
    ? state.rooms.find((item) => item.id === currentConversation.roomId) ?? null
    : null;
  const currentParticipants = currentConversation
    ? state.participants.filter((item) => item.conversationId === currentConversation.id && item.status !== "removed")
    : [];
  const currentAgents = currentParticipants.filter((item) => item.kind === "ai");
  const currentMessages = currentConversation
    ? state.messages
        .filter((item) => item.conversationId === currentConversation.id)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    : [];
  const currentActiveRuns = currentConversation
    ? visibleActiveRuns(
        state.activeRuns.filter((run) => run.conversationId === currentConversation.id),
        state.messages,
      )
    : [];
  const currentBackgroundTasks = currentConversation
    ? backgroundTasks.filter(
        (task) =>
          task.conversationId === currentConversation.id
          && loadLocalTaskBarTaskIds().has(task.id)
          && !dismissedBackgroundTaskIds.has(task.id),
      )
    : [];
  const openBackgroundTask = openBackgroundTaskId && currentConversation && !dismissedBackgroundTaskIds.has(openBackgroundTaskId)
    ? backgroundTasks.find(
        (task) =>
          task.id === openBackgroundTaskId
          && task.panelOpen
          && task.conversationId === currentConversation.id,
      ) ?? null
    : null;
  const enrichedOpenBackgroundTask = openBackgroundTask
    ? {
        ...openBackgroundTask,
        sourceMessage:
          openBackgroundTask.sourceMessage
          ?? (openBackgroundTask.sourceMessageId
            ? state.messages.find((message) => message.id === openBackgroundTask.sourceMessageId) ?? null
            : null),
        targetParticipant:
          openBackgroundTask.targetParticipant
          ?? currentParticipants.find((participant) => participant.id === openBackgroundTask.participantId)
          ?? null,
      }
    : null;
  const agentRunTasks: AgentRunTaskItem[] = currentActiveRuns.map((run) => {
    const visibility = resolveAgentRunVisibility(run, currentMessages);
    const participantName = currentParticipants.find((participant) => participant.id === run.participantId)?.displayName ?? "Agent";
    return {
      id: run.id,
      type: "agent-run",
      conversationId: run.conversationId,
      participantName,
      status: "running",
      preview: `${participantName} 执行中`,
      visibility,
    };
  });
  const openAgentRun = openAgentRunId
    ? currentActiveRuns.find((run) => run.id === openAgentRunId)
      ?? (openAgentRunSnapshot?.id === openAgentRunId ? openAgentRunSnapshot : null)
    : null;
  const openAgentRunEvents = openAgentRunId
    ? state.agentRunEvents
        .filter((event) => event.runId === openAgentRunId)
        .slice()
        .sort((left, right) => {
          if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
          return left.createdAt.localeCompare(right.createdAt);
        })
    : [];
  const openAgentRunParticipant = openAgentRun
    ? currentParticipants.find((participant) => participant.id === openAgentRun.participantId) ?? null
    : null;
  const openAgentRunPanel = useCallback((runId: string) => {
    const run = state.activeRuns.find((item) => item.id === runId);
    if (run) setOpenAgentRunSnapshot(run);
    setOpenAgentRunId(runId);
    setOpenThinkingMessageId(null);
    setFilesPanelOpen(false);
    setOpenBackgroundTaskId(null);
  }, [state.activeRuns]);
  const openMessageThinking = useCallback((message: Message) => {
    setOpenThinkingMessageId(message.id);
    setOpenAgentRunId(null);
    setOpenAgentRunSnapshot(null);
    setFilesPanelOpen(false);
    setOpenBackgroundTaskId(null);
  }, []);
  const openThinkingMessage = openThinkingMessageId
    ? state.messages.find((message) => message.id === openThinkingMessageId) ?? null
    : null;
  const openThinkingParticipant = openThinkingMessage
    ? resolveMessageAgentParticipant(openThinkingMessage, currentParticipants, state.participants)
    : null;
  const openThinkingIdentity = openThinkingParticipant?.identityId
    ? state.identities.find((identity) => identity.id === openThinkingParticipant.identityId) ?? null
    : null;
  const openThinkingSections = openThinkingMessage
    ? collectMessageProcess(
        openThinkingMessage,
        state.messageBlocks.filter((block) => block.messageId === openThinkingMessage.id),
        state.agentRunEvents,
        state.agentRuns,
      )
    : [];
  const openThinkingParticipantName = openThinkingMessage
    ? resolveMessageSenderLabel(openThinkingMessage, openThinkingParticipant, openThinkingIdentity, userProfile.displayName)
    : "Agent";
  const agentProfileParticipant = agentProfileParticipantId && currentConversation
    ? resolveAgentProfileParticipant(
        agentProfileParticipantId,
        currentConversation.id,
        currentParticipants,
        state.participants,
      )
    : null;
  const agentProfileIdentity = agentProfileParticipant?.identityId
    ? state.identities.find((item) => item.id === agentProfileParticipant.identityId) ?? null
    : null;
  const pendingAgentSetupIdentity = pendingAgentSetupIdentityId
    ? state.identities.find((item) => item.id === pendingAgentSetupIdentityId) ?? null
    : null;
  const agentProfileDialogIdentity = agentProfileIdentity ?? pendingAgentSetupIdentity;
  const agentProfileRuntime = agentProfileParticipant?.runtimeProfileId
    ? state.runtimeProfiles.find((item) => item.id === agentProfileParticipant.runtimeProfileId) ?? null
    : agentProfileDialogIdentity?.defaultRuntimeProfileId
      ? state.runtimeProfiles.find((item) => item.id === agentProfileDialogIdentity.defaultRuntimeProfileId) ?? null
      : null;
  const clearAgentProfileDialog = () => {
    setAgentProfileParticipantId(null);
    setAgentProfileShowRemove(false);
    setPendingAgentSetupIdentityId(null);
  };
  const finishAgentProfileAdd = () => {
    clearAgentProfileDialog();
    setMembersPanelOpen(true);
    setMembersPanelStartAdding(false);
  };
  const finishAgentProfileDialog = () => {
    clearAgentProfileDialog();
    setMembersPanelOpen(false);
    setMembersPanelStartAdding(false);
  };
  const openTeamIdentity = (identityId: string) => {
    finishAgentProfileDialog();
    setTeamFocusIdentityId(identityId);
    setActiveSection("team");
  };
  const onCreateRoom = async () => {
    const result = await createRoom({
      title: nextDefaultRoomTitle(state.rooms),
      description: "新的 AI 群聊房间",
    });
    const bundle = result as { room: Room; conversation: Conversation; participants?: Participant[] };
    setState((current) => ({
      ...current,
      rooms: upsert(current.rooms, bundle.room),
      conversations: upsert(current.conversations, bundle.conversation),
      participants: upsertMany(current.participants, bundle.participants ?? []),
    }));
    setCurrentConversationId(bundle.conversation.id);
  };

  const onDeleteRoom = async (room: Room, conversation: Conversation) => {
    const ok = window.confirm(`Delete chat "${conversation.title}"? Historical messages and local files will be removed.`);
    if (!ok) return;
    try {
      await deleteRoom(room.id);
      setState((current) => removeDeletedRoom(current, room.id, conversation.id));
      setCurrentConversationId((current) =>
        current === conversation.id
          ? state.conversations.find((item) => item.id !== conversation.id)?.id ?? null
          : current,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete chat";
      if (message.includes("Room not found")) {
        setState((current) => removeDeletedRoom(current, room.id, conversation.id));
        setCurrentConversationId((current) =>
          current === conversation.id
            ? state.conversations.find((item) => item.id !== conversation.id)?.id ?? null
            : current,
        );
        return;
      }
      window.alert(message);
    }
  };

  const onRoomPreviewChange = useCallback((roomId: string, input: UpdateRoomRequest) => {
    setState((current) => applyRoomUpdate(current, roomId, input));
  }, []);

  const onUpdateRoom = async (roomId: string, input: UpdateRoomRequest) => {
    setState((current) => applyRoomUpdate(current, roomId, input));
    const result = (await updateRoom(roomId, input)) as {
      room: Room;
      conversation: Conversation;
      participants: Participant[];
    };
    setState((current) => ({
      ...current,
      rooms: upsert(current.rooms, result.room),
      conversations: upsert(current.conversations, result.conversation),
      participants: upsertMany(current.participants, result.participants ?? []),
    }));
  };

  const onToggleConversationPin = async (conversation: Conversation, pinned: boolean) => {
    setState((current) => ({
      ...current,
      conversations: upsert(current.conversations, { ...conversation, pinned }),
    }));
    try {
      const result = await updateConversationPin(conversation.id, { pinned });
      setState((current) => ({
        ...current,
        conversations: upsert(current.conversations, result.conversation),
      }));
    } catch {
      setState((current) => ({
        ...current,
        conversations: upsert(current.conversations, conversation),
      }));
    }
  };

  const onRemoveParticipant = async (participantId: string) => {
    const result = (await deleteParticipant(participantId)) as { participant: Participant | null };
    if (!result.participant) return;
    setState((current) => ({
      ...current,
      participants: upsert(current.participants, result.participant),
    }));
  };

  const onAddParticipant = async (conversationId: string, input: Parameters<typeof addParticipant>[1]) => {
    const result = (await addParticipant(conversationId, input)) as {
      participant: Participant;
      systemMessage?: Message | null;
    };
    setState((current) => ({
      ...current,
      participants: upsert(current.participants, result.participant),
      messages: result.systemMessage ? upsert(current.messages, result.systemMessage) : current.messages,
    }));
    return result;
  };

  const onUpdateParticipant = async (participantId: string, input: UpdateParticipantRequest) => {
    const result = (await updateParticipant(participantId, input)) as { participant: Participant | null };
    if (!result.participant) {
      throw new Error("无法更新 Agent 配置");
    }
    setState((current) => ({
      ...current,
      participants: upsert(current.participants, result.participant),
    }));
    return result;
  };

  const onToggleMute = async (participantId: string, muted: boolean) => {
    setState((current) => {
      const existing = current.participants.find((item) => item.id === participantId);
      if (!existing) return current;
      return {
        ...current,
        participants: upsertParticipant(current.participants, {
          ...existing,
          status: muted ? "muted" : "active",
          updatedAt: new Date().toISOString(),
        }),
      };
    });

    try {
      const result = (await setParticipantMuted(participantId, muted)) as { participant: Participant | null };
      if (!result.participant) throw new Error("Unable to update mute state");
      setState((current) => ({
        ...current,
        participants: upsertParticipant(current.participants, result.participant),
      }));
    } catch (error) {
      setState((current) => {
        const existing = current.participants.find((item) => item.id === participantId);
        if (!existing) return current;
        return {
          ...current,
          participants: upsert(current.participants, {
            ...existing,
            status: muted ? "active" : "muted",
          }),
        };
      });
      throw error;
    }
  };

  const onCreateIdentity = async (input: CreateIdentityRequest) => {
    const result = (await createIdentity(input)) as { identity: Identity };
    if (result.identity) {
      setState((current) => ({
        ...current,
        identities: upsertIdentity(current.identities, result.identity),
      }));
    }
    return result;
  };

  const onUpdateIdentity = async (identityId: string, input: UpdateIdentityRequest) => {
    const result = (await updateIdentity(identityId, input)) as { identity: Identity | null };
    if (!result.identity) {
      throw new Error("Agent 不存在或保存失败");
    }
    setState((current) => ({
      ...current,
      identities: upsertIdentity(current.identities, result.identity),
    }));
    return result;
  };

  const requestMention = (participant: Participant) => {
    setMentionRequest((current) => ({
      participantId: participant.id,
      seq: (current?.seq ?? 0) + 1,
    }));
  };

  const openBackgroundTaskPanel = (taskId: string) => {
    setBackgroundTasks((current) => current.map((task) => ({ ...task, panelOpen: task.id === taskId })));
    setOpenBackgroundTaskId(taskId);
    setOpenThinkingMessageId(null);
  };

  const closeBackgroundTaskPanel = () => {
    setBackgroundTasks((current) => current.map((task) => ({ ...task, panelOpen: false })));
    setOpenBackgroundTaskId(null);
  };

  const cancelActiveRun = useCallback(async (runId: string) => {
    try {
      await cancelRun(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "取消任务失败";
      if (!/not found|404/i.test(message)) {
        window.alert(message);
        return;
      }
    }
    setState((current) => removeActiveRun(current, runId));
    setOpenAgentRunId((current) => (current === runId ? null : current));
    setOpenAgentRunSnapshot((current) => (current?.id === runId ? null : current));
  }, []);

  const dismissBackgroundTask = (taskId: string) => {
    const task = backgroundTasks.find((item) => item.id === taskId);
    if (!task) return;
    if (task.status === "running") {
      const confirmed = window.confirm("这个任务还在进行中，确定要取消并移除吗？");
      if (!confirmed) return;
      void cancelPrivateTask(taskId);
    }
    setDismissedBackgroundTaskIds((current) => {
      const next = new Set(current);
      next.add(taskId);
      saveDismissedBackgroundTaskIds(next);
      return next;
    });
    removeLocalTaskBarTaskId(taskId);
    setBackgroundTasks((current) => current.filter((item) => item.id !== taskId));
    setOpenBackgroundTaskId((current) => (current === taskId ? null : current));
  };

  const dismissAgentRunTask = async (runId: string) => {
    const run = currentActiveRuns.find((item) => item.id === runId);
    if (!run) return;
    const participantName = currentParticipants.find((item) => item.id === run.participantId)?.displayName ?? "Agent";
    if (!window.confirm(`确定要取消 ${participantName} 正在执行的任务吗？`)) return;
    await cancelActiveRun(runId);
  };

  const startBackgroundSummary = useCallback(
    async (messages: Message[], participant: Participant) => {
      const validMessages = messages.filter((message) => message.status !== "deleted" && message.status !== "recalled");
      if (!validMessages.length) return;
      const primaryMessage = validMessages[0]!;
      const prompt = formatSummaryRequest(validMessages, state.messageBlocks, state.artifacts);
      const sourcePreview = formatSummarySourcePreview(validMessages);
      try {
        const { taskId } = await startPrivateTask(primaryMessage.conversationId, {
          participantId: participant.id,
          prompt,
          sourceMessageId: primaryMessage.id,
          sourceMessageIds: validMessages.map((message) => message.id),
          taskType: "summary",
        });
        addLocalTaskBarTaskId(taskId);
        let nextTask: BackgroundTask;
        try {
          const { task } = await getPrivateTask(taskId);
          nextTask = backgroundTaskFromSnapshot({
            snapshot: task,
            sourceMessages: validMessages,
            targetParticipant: participant,
          });
        } catch {
          nextTask = createOptimisticBackgroundTask({
            id: taskId,
            type: "summary",
            conversationId: primaryMessage.conversationId,
            sourceMessages: validMessages,
            targetParticipant: participant,
            sourcePreview,
          });
        }
        setBackgroundTasks((current) => {
          const existing = current.find((task) => task.id === taskId);
          if (existing) {
            if (existing.status !== "running" && nextTask.status === "running") return current;
            return current.map((task) => (task.id === taskId ? mergeBackgroundTask(task, nextTask) : task));
          }
          return [...current.filter((task) => task.id !== taskId), nextTask];
        });
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "无法开始总结");
      }
    },
    [state.messageBlocks, state.artifacts],
  );

  const openMessageLink = (messageId: string) => {
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) {
      window.alert("没有找到这条消息，可能已经不在本地快照中。");
      return;
    }
    setActiveSection("chats");
    setCurrentConversationId(message.conversationId);
    setFocusMessageRequest((current) => ({
      messageId,
      seq: (current?.seq ?? 0) + 1,
    }));
  };

  const ensureBackgroundTask = useCallback(async (taskId: string) => {
    const existing = backgroundTasks.find((task) => task.id === taskId);
    if (existing) return existing;
    try {
      const { task } = await getPrivateTask(taskId);
      let nextTask: BackgroundTask | null = null;
      setBackgroundTasks((current) => {
        const currentTask = current.find((item) => item.id === taskId);
        nextTask = enrichBackgroundTask(task, {
          messages: state.messages,
          participants: state.participants,
        }, currentTask);
        return [...current.filter((item) => item.id !== taskId), nextTask!];
      });
      return nextTask;
    } catch {
      return null;
    }
  }, [backgroundTasks, state.messages, state.participants]);

  useEffect(() => {
    if (!currentConversationId || !state.ready) return;
    const localTaskIds = [...loadLocalTaskBarTaskIds()].filter((taskId) => !dismissedBackgroundTaskIds.has(taskId));
    if (!localTaskIds.length) return;
    let cancelled = false;
    void (async () => {
      for (const taskId of localTaskIds) {
        try {
          const { task } = await getPrivateTask(taskId);
          if (cancelled || task.conversationId !== currentConversationId) continue;
          setBackgroundTasks((current) => {
            if (current.some((item) => item.id === taskId)) return current;
            const enriched = enrichBackgroundTask(task, {
              messages: state.messages,
              participants: state.participants,
            });
            return [...current, enriched];
          });
        } catch {
          // ignore missing local task
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentConversationId, state.ready, dismissedBackgroundTaskIds, state.messages, state.participants]);

  const openSummaryLink = useCallback(async (taskId: string) => {
    const task = await ensureBackgroundTask(taskId);
    if (!task) {
      window.alert("没有找到这条总结，可能已被移除。");
      return;
    }
    setActiveSection("chats");
    if (task.conversationId !== currentConversationId) {
      setCurrentConversationId(task.conversationId);
    }
    openBackgroundTaskPanel(taskId);
  }, [ensureBackgroundTask, currentConversationId]);

  const startConversationSidebarResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.matchMedia("(max-width: 760px)").matches) return;
    event.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const shellRect = shell.getBoundingClientRect();
    const navWidth = window.matchMedia("(max-width: 1080px)").matches ? COMPACT_NAV_WIDTH : DESKTOP_NAV_WIDTH;
    const maxSidebarWidth = Math.max(
      MIN_CONVERSATION_SIDEBAR_WIDTH,
      shellRect.width - navWidth - SPLITTER_WIDTH - MIN_CHAT_PANE_WIDTH,
    );
    const updateWidth = (clientX: number) => {
      const rawWidth = clientX - shellRect.left - navWidth;
      setConversationSidebarWidth(clamp(rawWidth, MIN_CONVERSATION_SIDEBAR_WIDTH, maxSidebarWidth));
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateWidth(moveEvent.clientX);
    };
    const stopResize = () => {
      setResizingConversationSidebar(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
    };
    setResizingConversationSidebar(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    updateWidth(event.clientX);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
  };

  const refreshSnapshot = useCallback(async () => {
    const snapshot = await fetchSnapshot();
    lastSeqRef.current = Math.max(lastSeqRef.current, snapshot.lastSeq);
    setState(normalizeSnapshot(snapshot));
    setCurrentConversationId((current) => current ?? snapshot.conversations[0]?.id ?? null);
  }, []);

  const mergeSentMessage = useCallback((result: SendMessageResponse) => {
    setState((current) => {
      const messages = upsertMessage(current.messages, result.message);
      return {
        ...current,
        messages,
        messageBlocks: upsertMany(current.messageBlocks, result.blocks ?? []),
        artifacts: upsertMany(current.artifacts, result.artifacts ?? []),
        activeRuns: enrichAgentRuns(current.activeRuns, messages),
      };
    });
  }, []);

  const onSendMessage = useCallback(
    async (...args: Parameters<typeof sendMessage>) => {
      const result = await sendMessage(...args);
      mergeSentMessage(result);
      setScrollToBottomRequest((current) => ({ seq: (current?.seq ?? 0) + 1 }));
      window.setTimeout(() => void refreshSnapshot(), 900);
      window.setTimeout(() => void refreshSnapshot(), 2500);
      return result;
    },
    [mergeSentMessage, refreshSnapshot],
  );

  const onUpdateMessage = useCallback(
    async (messageId: string, input: UpdateMessageRequest) => {
      const result = await updateMessage(messageId, input);
      mergeSentMessage(result);
      window.setTimeout(() => void refreshSnapshot(), 900);
      return result;
    },
    [mergeSentMessage, refreshSnapshot],
  );


  const requestDeleteMessages = useCallback((messageIds: string[]) => {
    const ids = [...new Set(messageIds)];
    if (ids.length === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      deleteDialogRef.current = { resolve, reject };
      setDeletePrompt({ ids });
    });
  }, []);

  const cancelDeleteMessages = useCallback(() => {
    deleteDialogRef.current?.reject(new Error("cancelled"));
    deleteDialogRef.current = null;
    setDeletePrompt(null);
  }, []);

  const confirmDeleteMessages = useCallback(async () => {
    if (!deletePrompt) return;
    setDeletingMessages(true);
    try {
      const ids = deletePrompt.ids;
      timelineScrollPreserverRef.current?.capture();
      await Promise.all(ids.map((id) => deleteMessage(id)));
      setState((current) => removeHiddenMessages(current, ids));
      setDeletePrompt(null);
      deleteDialogRef.current?.resolve();
      deleteDialogRef.current = null;
    } finally {
      setDeletingMessages(false);
    }
  }, [deletePrompt]);

  const requestComposerInsert = (messages: Message[], mode: "quote" | "summary" | "send-to-app" | "send-to-agent" = "quote") => {
    if (mode === "quote") {
      const quotes = messages
        .filter((message) => message.status !== "deleted" && message.status !== "recalled")
        .map((message) => ({
          messageId: message.id,
          sender: messageSenderLabel(message, state.participants, state.identities, userProfile.displayName),
          content: message.content.trim() || "[附件]",
        }));
      if (quotes.length === 1) {
        setComposerRequest((current) => ({
          seq: (current?.seq ?? 0) + 1,
          type: "quote",
          quote: quotes[0]!,
        }));
        return;
      }
      setComposerRequest((current) => ({
        seq: (current?.seq ?? 0) + 1,
        type: "quotes",
        quotes,
      }));
      return;
    }
    setComposerRequest((current) => ({
      seq: (current?.seq ?? 0) + 1,
      type: "insert",
      content: formatMessagesForComposer(messages, mode),
    }));
  };

  const requestComposerEdit = (message: Message) => {
    setComposerRequest((current) => ({
      seq: (current?.seq ?? 0) + 1,
      type: "edit",
      messageId: message.id,
      content: message.content,
      mentions: message.mentions,
    }));
  };

  useEffect(() => {
    if (!state.ready) return;
    if (currentConversationId && !state.conversations.some((item) => item.id === currentConversationId)) {
      setCurrentConversationId(state.conversations[0]?.id ?? null);
    } else if (!currentConversationId && state.conversations[0]) {
      setCurrentConversationId(state.conversations[0].id);
    }
  }, [currentConversationId, state.conversations, state.ready]);

  useEffect(() => {
    setMembersPanelOpen(false);
    setMembersPanelStartAdding(false);
    setFilesPanelOpen(false);
    setOpenAgentRunId(null);
    setOpenAgentRunSnapshot(null);
    setOpenThinkingMessageId(null);
    clearAgentProfileDialog();
    setMessageSelectionMode(false);
    setMentionRequest(null);
  }, [currentConversationId]);

  useEffect(() => {
    if (!openAgentRunId) return;
    const run = state.activeRuns.find((item) => item.id === openAgentRunId);
    if (run) setOpenAgentRunSnapshot(run);
  }, [openAgentRunId, state.activeRuns]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (profileButtonRef.current?.contains(target)) return;
      if (mobileProfileButtonRef.current?.contains(target)) return;
      if (profileMenuRef.current?.contains(target)) return;
      if (mobileProfileMenuRef.current?.contains(target)) return;
      if (chatProfileMenuRef.current?.contains(target)) return;
      if (profileMenuAnchorEl?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-profile-trigger="message-avatar"]')) return;
      closeProfileMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeProfileMenu, profileMenuAnchorEl, profileMenuOpen]);

  const markConversationRead = useCallback((conversationId: string) => {
    const lastReadAt = resolveLatestConversationActivityAt(conversationId, state.messages);
    setConversationReadAt((current) => {
      if (current[conversationId] === lastReadAt) return current;
      const next = { ...current, [conversationId]: lastReadAt };
      saveConversationReadAt(next);
      return next;
    });
  }, [state.messages]);

  const unreadCountsByConversation = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const conversation of state.conversations) {
      if (activeSection === "chats" && conversation.id === currentConversationId) {
        counts[conversation.id] = 0;
        continue;
      }
      counts[conversation.id] = countUnreadMessages(
        conversation.id,
        state.messages,
        conversationReadAt[conversation.id],
      );
    }
    return counts;
  }, [activeSection, conversationReadAt, currentConversationId, state.conversations, state.messages]);

  const totalUnreadCount = useMemo(
    () => Object.values(unreadCountsByConversation).reduce((sum, count) => sum + count, 0),
    [unreadCountsByConversation],
  );

  useEffect(() => {
    if (!state.ready || activeSection !== "chats" || !currentConversationId) return;
    markConversationRead(currentConversationId);
  }, [activeSection, currentConversationId, markConversationRead, state.messages, state.ready]);

  if (!state.ready) {
    return <div className={"[display:grid] [height:100vh] [place-items:center] [color:var(--muted)] [font-size:13px]"}>Loading group-chat...</div>;
  }

  const shellStyle = {
    "--conversation-sidebar-width": `${conversationSidebarWidth}px`,
    "--chat-pane-min-width": `${MIN_CHAT_PANE_WIDTH}px`,
  } as CSSProperties;

  return (
    <div
      ref={appShellRef}
      style={shellStyle}
      data-resizing-sidebar={resizingConversationSidebar || undefined}
      className={"[display:grid] [grid-template-columns:60px_var(--conversation-sidebar-width)_8px_minmax(var(--chat-pane-min-width),_1fr)] [height:100vh] [overflow:hidden] [background:var(--bg)] [&[data-resizing-sidebar=true]_*]:[cursor:col-resize] max-[1080px]:[grid-template-columns:56px_var(--conversation-sidebar-width)_8px_minmax(var(--chat-pane-min-width),_1fr)] max-[760px]:[grid-template-columns:1fr]"}
    >
      <AppNavRail
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        profileMenuOpen={profileMenuOpen && profileMenuPlacement === "rail"}
        onToggleProfileMenu={() => toggleProfileMenu("rail")}
        onOpenSettings={() => setSettingsOpen(true)}
        profileButtonRef={profileButtonRef}
        profileMenuRef={profileMenuRef}
        userProfile={userProfile}
        onSaveProfile={(profile) => {
          saveUserProfileState(profile);
          closeProfileMenu();
        }}
        onCloseProfileMenu={closeProfileMenu}
        totalUnreadCount={totalUnreadCount}
      />

      {activeSection === "team" ? (
        <TeamMembersPage
          identities={state.identities}
          participants={state.participants}
          conversations={state.conversations}
          rooms={state.rooms}
          runtimeProfiles={state.runtimeProfiles}
          localAgentProviders={localAgentProviders}
          focusIdentityId={teamFocusIdentityId}
          selectedIdentityId={teamSelectedIdentityId}
          onSelectedIdentityIdChange={setTeamSelectedIdentityId}
          onCreateIdentity={onCreateIdentity}
          onUpdateIdentity={onUpdateIdentity}
          onDeleteIdentity={deleteIdentity}
          onOpenConversation={(conversationId) => {
            setTeamFocusIdentityId(null);
            setActiveSection("chats");
            setCurrentConversationId(conversationId);
          }}
        />
      ) : (
        <>
          <ConversationSidebar
            rooms={state.rooms}
            conversations={state.conversations}
            messages={state.messages}
            currentConversationId={currentConversationId}
            unreadCounts={unreadCountsByConversation}
            onSelect={setCurrentConversationId}
            onCreateRoom={onCreateRoom}
            onDeleteRoom={onDeleteRoom}
            onTogglePin={onToggleConversationPin}
          />

          <button
            type="button"
            className={"[position:relative] [z-index:20] [width:8px] [min-width:8px] [height:100vh] [border:0] [border-left:4px_solid_var(--border)] [border-right:1px_solid_transparent] [padding:0] [background:var(--panel)] [cursor:col-resize] [transition:background-color_0.12s_ease,_border-color_0.12s_ease] hover:[border-left-color:var(--border-strong)] hover:[background:#00000008] focus-visible:[outline:none] focus-visible:[background:#0000000d] max-[760px]:[display:none]"}
            aria-label="拖拽调整会话列表和聊天窗口宽度"
            title="拖拽调整窗口大小"
            onPointerDown={startConversationSidebarResize}
          />

          <main className={"[display:grid] [position:relative] [min-width:0] [min-height:0] [grid-template-rows:56px_minmax(0,_1fr)_auto_auto] [background:var(--panel)]"}>
            {currentConversation && currentRoom ? (
              <>
                <ChatHeader
                  room={currentRoom}
                  conversation={currentConversation}
                  participants={currentParticipants}
                  agentCount={currentAgents.length}
                  messages={currentMessages}
                  agentsOpen={membersPanelOpen}
                  filesOpen={filesPanelOpen}
                  userProfile={userProfile}
                  profileMenuOpen={profileMenuOpen && profileMenuPlacement === "mobile"}
                  profileButtonRef={mobileProfileButtonRef}
                  onToggleProfileMenu={() => toggleProfileMenu("mobile")}
                  onUpdateRoom={onUpdateRoom}
                  onRoomPreviewChange={onRoomPreviewChange}
                  onToggleAgents={() => {
                    setFilesPanelOpen(false);
                    clearAgentProfileDialog();
                    setMembersPanelStartAdding(false);
                    setMembersPanelOpen((current) => !current);
                  }}
                  onToggleFiles={() => {
                    setMembersPanelOpen(false);
                    setMembersPanelStartAdding(false);
                    clearAgentProfileDialog();
                    setOpenAgentRunId(null);
                    setOpenAgentRunSnapshot(null);
                    setOpenThinkingMessageId(null);
                    setFilesPanelOpen((current) => !current);
                  }}
                  onInvitePeople={() => window.alert("本地版暂不支持邀请其他人加入房间。云端多人协作版将支持邀请队友和他们的 Agent 进房间。")}
                  onFocusMessage={(messageId) => {
                    setFocusMessageRequest((current) => ({
                      messageId,
                      seq: (current?.seq ?? 0) + 1,
                    }));
                  }}
                />
                <ConnectionBanner status={connectionStatus} />
                <RoomAgentsDialog
                  open={membersPanelOpen}
                  startAdding={membersPanelStartAdding}
                  conversationId={currentConversation.id}
                  participants={currentParticipants}
                  identities={state.identities}
                  runtimeProfiles={state.runtimeProfiles}
                  localAgentProviders={localAgentProviders}
                  onClose={() => {
                    setMembersPanelOpen(false);
                    setMembersPanelStartAdding(false);
                    clearAgentProfileDialog();
                  }}
                  onConfigureNewAgent={(identity) => {
                    setPendingAgentSetupIdentityId(identity.id);
                    setAgentProfileParticipantId(null);
                    setAgentProfileShowRemove(false);
                    setMembersPanelStartAdding(false);
                  }}
                  onOpenParticipant={(participant) => {
                    setPendingAgentSetupIdentityId(null);
                    setAgentProfileShowRemove(true);
                    setAgentProfileParticipantId(participant.id);
                  }}
                />
                <ConversationFilesPanel
                  open={filesPanelOpen}
                  conversationId={currentConversation.id}
                  artifacts={state.artifacts}
                  messages={currentMessages}
                  onClose={() => setFilesPanelOpen(false)}
                  onFocusMessage={(messageId) => {
                    setFocusMessageRequest((current) => ({
                      messageId,
                      seq: (current?.seq ?? 0) + 1,
                    }));
                    setFilesPanelOpen(false);
                  }}
                />
                <AgentRunPanel
                  open={Boolean(openAgentRunId && openAgentRun)}
                  run={openAgentRun}
                  participant={openAgentRunParticipant}
                  events={openAgentRunEvents}
                  running={Boolean(openAgentRun && currentActiveRuns.some((run) => run.id === openAgentRun.id))}
                  onClose={() => {
                    setOpenAgentRunId(null);
                    setOpenAgentRunSnapshot(null);
                  }}
                  onFocusMessage={(messageId) => {
                    setFocusMessageRequest((current) => ({
                      messageId,
                      seq: (current?.seq ?? 0) + 1,
                    }));
                  }}
                />
                <AgentThinkingPanel
                  open={Boolean(openThinkingMessage)}
                  participantName={openThinkingParticipantName}
                  sections={openThinkingSections}
                  onClose={() => setOpenThinkingMessageId(null)}
                />
                <MessageTimeline
                  key={currentConversation.id}
                  messages={currentMessages}
                  allMessages={state.messages}
                  blocks={state.messageBlocks}
                  artifacts={state.artifacts}
                  agentRunEvents={state.agentRunEvents}
                  agentRuns={state.agentRuns}
                  participants={currentParticipants}
                  allParticipants={state.participants}
                  conversations={state.conversations}
                  rooms={state.rooms}
                  participantsCount={currentAgents.length}
                  focusMessageRequest={focusMessageRequest}
                  scrollToBottomRequest={scrollToBottomRequest}
                  bulkToolbarHost={bulkToolbarHost}
                  userProfile={userProfile}
                  identities={state.identities}
                  runtimeProfiles={state.runtimeProfiles}
                  onOpenUserProfile={(anchor) => openProfileMenu("chat", anchor)}
                  onViewThinking={openMessageThinking}
                  onRegisterScrollPreserver={(preserver) => {
                    timelineScrollPreserverRef.current = preserver;
                  }}
                  onSelectionModeChange={setMessageSelectionMode}
                  onOpenMembers={(options) => {
                    clearAgentProfileDialog();
                    setMembersPanelStartAdding(options?.startAdding ?? false);
                    setMembersPanelOpen(true);
                  }}
                  onOpenAgentProfile={(participant) => {
                    setFilesPanelOpen(false);
                    setMembersPanelOpen(false);
                    setMembersPanelStartAdding(false);
                    clearAgentProfileDialog();
                    setAgentProfileParticipantId(participant.id);
                  }}
                  onMentionParticipant={requestMention}
                  onOpenMessageLink={openMessageLink}
                  onOpenSummaryLink={(taskId) => void openSummaryLink(taskId)}
                  onEnsureSummaryTask={ensureBackgroundTask}
                  summaryTasks={backgroundTasks}
                  onQuoteMessages={requestComposerInsert}
                  onStartSummary={startBackgroundSummary}
                  openBackgroundTask={enrichedOpenBackgroundTask}
                  onCloseBackgroundTaskPanel={closeBackgroundTaskPanel}
                  onFocusMessage={(messageId) => {
                    setFocusMessageRequest((current) => ({
                      messageId,
                      seq: (current?.seq ?? 0) + 1,
                    }));
                  }}
                  onEditMessage={requestComposerEdit}
                  onDeleteMessage={async (message) => {
                    try {
                      await requestDeleteMessages([message.id]);
                    } catch {
                      // cancelled
                    }
                  }}
                  onDeleteMessages={async (messages) => {
                    try {
                      await requestDeleteMessages(messages.map((message) => message.id));
                    } catch {
                      // cancelled
                    }
                  }}
                  onRecallMessage={(message) => {
                    if (!isLocalUserMessage(message)) return Promise.resolve();
                    if (!window.confirm("确定撤回这条消息吗？撤回后 Agent 不会再回复这条消息。")) return Promise.resolve();
                    timelineScrollPreserverRef.current?.capture();
                    return onUpdateMessage(message.id, { status: "recalled" });
                  }}
                />
                <AgentProfileDialog
                  participant={agentProfileParticipant}
                  setupIdentity={pendingAgentSetupIdentity}
                  conversationId={currentConversation.id}
                  roomParticipants={currentParticipants}
                  identity={agentProfileDialogIdentity}
                  runtimeProfile={agentProfileRuntime}
                  runtimeProfiles={state.runtimeProfiles}
                  localAgentProviders={localAgentProviders}
                  showRemove={agentProfileShowRemove}
                  onClose={clearAgentProfileDialog}
                  onMention={(participant) => {
                    finishAgentProfileDialog();
                    requestMention(participant);
                  }}
                  onAddParticipant={onAddParticipant}
                  onUpdateParticipant={onUpdateParticipant}
                  onToggleMute={onToggleMute}
                  onRemoveParticipant={onRemoveParticipant}
                  onRemoved={clearAgentProfileDialog}
                  onSaved={pendingAgentSetupIdentity ? finishAgentProfileAdd : finishAgentProfileDialog}
                  onOpenIdentity={openTeamIdentity}
                />
                <BackgroundTaskBar
                  tasks={currentBackgroundTasks}
                  agentRuns={agentRunTasks}
                  openTaskId={openBackgroundTaskId}
                  openAgentRunId={openAgentRunId}
                  onOpenTask={openBackgroundTaskPanel}
                  onDismissTask={dismissBackgroundTask}
                  onDismissAgentRun={dismissAgentRunTask}
                  onOpenAgentRun={openAgentRunPanel}
                />
                <div ref={setBulkToolbarHost} className={"[position:relative] [min-height:0]"}>
                  <div className={messageSelectionMode ? "[visibility:hidden] [pointer-events:none]" : ""} aria-hidden={messageSelectionMode}>
                    <Composer
                      conversation={currentConversation}
                      conversationId={currentConversation.id}
                      participants={currentParticipants}
                      identities={state.identities}
                      runtimeProfiles={state.runtimeProfiles}
                      allMessages={state.messages}
                      allParticipants={state.participants}
                      conversations={state.conversations}
                      rooms={state.rooms}
                      activeRuns={currentActiveRuns}
                      onSend={onSendMessage}
                      onUpdateMessage={onUpdateMessage}
                      onUpload={uploadArtifact}
                      onCancelRun={cancelActiveRun}
                      mentionRequest={mentionRequest}
                      composerRequest={composerRequest}
                      summaryTasks={backgroundTasks}
                      userDisplayName={userProfile.displayName}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className={"[display:grid] [min-height:100%] [place-items:center] [padding:28px] [color:var(--muted)] [text-align:center] [&_p]:[margin:8px_0_0] [&_p]:[font-size:13px]"}>
                <div className={"[display:grid] [place-items:center] [gap:12px] [max-width:320px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:34px_28px] [background:var(--panel)] [box-shadow:var(--shadow-soft)]"}>
                  <span className={"[display:grid] [width:58px] [height:58px] [place-items:center] [border-radius:16px] [color:#ffffff] [background:var(--primary)]"}>
                    <Bot size={30} />
                  </span>
                  <strong className={"[color:var(--text)] [font-size:17px] [font-weight:760]"}>选择一个协同频道</strong>
                  <p>从左侧进入会话，或新建房间启动一组 Agent 协同。</p>
                </div>
              </div>
            )}
          </main>
        </>
      )}
      <MobileSectionNav activeSection={activeSection} onChange={setActiveSection} totalUnreadCount={totalUnreadCount} />
      {profileMenuOpen && profileMenuPlacement === "mobile" ? (
        <div className={"[display:none] max-[760px]:[display:block]"}>
          <ProfileMenu
            menuRef={mobileProfileMenuRef}
            profile={userProfile}
            anchor="mobile"
            onSave={(profile) => {
              saveUserProfileState(profile);
              closeProfileMenu();
            }}
            onClose={closeProfileMenu}
          />
        </div>
      ) : null}
      {profileMenuOpen && profileMenuPlacement === "chat" ? (
        <ProfileMenu
          menuRef={chatProfileMenuRef}
          profile={userProfile}
          anchor="chat"
          anchorEl={profileMenuAnchorEl}
          onSave={(profile) => {
            saveUserProfileState(profile);
            closeProfileMenu();
          }}
          onClose={closeProfileMenu}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          runtimeProfiles={state.runtimeProfiles}
          localAgentProviders={localAgentProviders}
          localAgentProvidersRefreshing={refreshingLocalAgentProviders}
          onRefreshLocalAgentProviders={refreshLocalAgentProviders}
          userProfile={userProfile}
          onSaveProfile={(profile) => {
            saveUserProfileState(profile);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {deletePrompt ? (
        <DeleteMessageConfirmDialog
          count={deletePrompt.ids.length}
          deleting={deletingMessages}
          onCancel={cancelDeleteMessages}
          onConfirm={() => void confirmDeleteMessages()}
        />
      ) : null}
    </div>
  );
}

function ConnectionBanner(props: { status: "connecting" | "connected" | "disconnected" }) {
  if (props.status === "connected") return null;
  const text = props.status === "connecting" ? "正在连接实时消息..." : "实时连接已断开，刷新页面后会重新连接。";
  return (
    <div className={"[position:absolute] [top:56px] [left:50%] [z-index:28] [display:inline-flex] [transform:translateX(-50%)] [align-items:center] [gap:6px] [border:1px_solid_var(--border)] [border-radius:999px] [padding:5px_10px] [color:var(--muted)] [background:#fffffff2] [box-shadow:var(--shadow-soft)] [font-size:12px] [font-weight:650]"}>
      <WifiOff size={13} />
      <span>{text}</span>
    </div>
  );
}

function MobileSectionNav(props: {
  activeSection: "chats" | "team";
  onChange: (section: "chats" | "team") => void;
  totalUnreadCount: number;
}) {
  return (
    <nav className={"[position:fixed] [left:50%] [bottom:12px] [z-index:80] [display:none] [transform:translateX(-50%)] [gap:6px] [border:1px_solid_var(--border)] [border-radius:999px] [padding:6px] [background:var(--panel)] [box-shadow:var(--shadow)] max-[760px]:[display:flex]"} aria-label="Mobile section navigation">
      <button
        type="button"
        className={`[position:relative] [display:inline-flex] [height:40px] [align-items:center] [gap:7px] [border:0] [border-radius:999px] [padding:0_16px] [color:var(--muted)] [background:transparent] [font-size:13px] [font-weight:650] ${props.activeSection === "chats" ? "![color:#ffffff] [background:var(--primary)]" : ""}`}
        onClick={() => props.onChange("chats")}
      >
        <MessageCircle size={17} />
        消息
        {props.totalUnreadCount > 0 ? (
          <UnreadBadge count={props.totalUnreadCount} size="md" className={"[top:-4px] [right:-2px] [border-color:var(--panel)]"} />
        ) : null}
      </button>
      <button
        type="button"
        className={`[display:inline-flex] [height:40px] [align-items:center] [gap:7px] [border:0] [border-radius:999px] [padding:0_16px] [color:var(--muted)] [background:transparent] [font-size:13px] [font-weight:650] ${props.activeSection === "team" ? "![color:#ffffff] [background:var(--primary)]" : ""}`}
        onClick={() => props.onChange("team")}
      >
        <Bot size={17} />
        角色
      </button>
    </nav>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function visibleActiveRuns(runs: AgentRun[], messages: Message[]) {
  return runs.filter((run) => {
    if (run.status !== "accepted" && run.status !== "running") return false;
    if (!run.assistantMessageId) return true;
    const assistantMessage = messages.find((message) => message.id === run.assistantMessageId);
    if (!assistantMessage) return true;
    return assistantMessage.status === "pending" || assistantMessage.status === "streaming";
  });
}

function formatMessagesForComposer(messages: Message[], mode: "quote" | "summary" | "send-to-app" | "send-to-agent") {
  const lines = messages
    .filter((message) => message.status !== "deleted" && message.status !== "recalled")
    .map((message) => {
      const sender = messageSenderLabel(message);
      return `> ${sender}: ${message.content.trim() || "[附件]"}`;
    });
  if (mode === "summary") return `请总结并处理以下消息：\n\n${lines.join("\n")}\n`;
  if (mode === "send-to-app") return `请把以下对话整理后发送给应用：\n\n${lines.join("\n")}\n`;
  if (mode === "send-to-agent") return `请把以下对话整理后发送给 Agent：\n\n${lines.join("\n")}\n`;
  return `${lines.join("\n")}\n\n`;
}

function formatSummarySourcePreview(messages: Message[]) {
  const firstContent = messages[0]?.content.replace(/\s+/g, " ").trim().slice(0, 120) || "[附件]";
  if (messages.length <= 1) return firstContent;
  return `引用 ${messages.length} 条消息 · ${firstContent}`;
}

function formatSummaryRequest(messages: Message[], blocks: AppState["messageBlocks"], artifacts: AppState["artifacts"]) {
  const lines = messages.map((message) => {
    const sender = messageSenderLabel(message);
    return `- ${sender}: ${message.content.trim() || "[附件]"}`;
  });
  const messageArtifacts = messages.flatMap((message) =>
    blocks
      .filter((block) => block.messageId === message.id && (block.type === "image" || block.type === "file"))
      .map((block) => {
        const artifactId = typeof block.metadata?.artifactId === "string" ? block.metadata.artifactId : null;
        return artifactId ? artifacts.find((artifact) => artifact.id === artifactId) ?? null : null;
      })
      .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact)),
  );
  const attachmentText = messageArtifacts.length
    ? `\n附件：\n${messageArtifacts.map((artifact) => `- ${artifact.filename} (${artifact.mimeType}) ${artifact.textPreview ? `预览：${artifact.textPreview.slice(0, 500)}` : ""}`).join("\n")}`
    : "";

  return [
    messages.length > 1
      ? `请总结下面这 ${messages.length} 条消息，提炼关键结论、行动项和需要关注的信息。`
      : "请总结下面这条消息，提炼关键结论、行动项和需要关注的信息。",
    "只输出总结结果，不要复述这条指令。",
    "",
    "消息内容：",
    ...lines,
    attachmentText,
  ].join("\n");
}

function nextDefaultRoomTitle(rooms: Room[]) {
  let maxNumber = 0;
  for (const room of rooms) {
    const match = room.title.match(/AI 讨论室\s*(\d+)/);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
  }
  return `AI 讨论室 ${maxNumber + 1}`;
}
