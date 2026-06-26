import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, Loader2 } from "lucide-react";
import { defaultTuttiAgentParticipantName, enrichAgentRuns, isLocalUserMessage, parseTuttiAgentParticipantId, resolveAgentRunVisibility, type AgentRun,
  type ChatSnapshot,
  type Conversation,
  type ConversationMessagesPage,
  type CreateIdentityRequest,
  type Identity,
  type LocalAgentProviderStatus,
  type Message,
  type MessageBlock,
  type Participant,
  type PrivateTaskSnapshot,
  type RuntimeProfile,
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
  fetchConversationMessages,
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
import { MessageLinkDetailPanel } from "./components/chat/MessageLinkDetailPanel.js";
import { revealArtifactInTuttiFileManager } from "./artifact-actions.js";
import { AgentRunPanel } from "./components/chat/AgentRunPanel.js";
import { AgentThinkingPanel } from "./components/chat/AgentThinkingPanel.js";
import { RoomAgentsDialog } from "./components/chat/RoomAgentsDialog.js";
import { AgentProfileDialog } from "./components/chat/AgentProfileDialog.js";
import { MessageTimeline, type AgentForwardTarget } from "./components/chat/MessageTimeline.js";
import { DeleteMessageConfirmDialog } from "./components/chat/DeleteMessageConfirmDialog.js";
import { InvitePeopleDialog } from "./components/chat/InvitePeopleDialog.js";
import { Composer } from "./components/chat/Composer.js";
import { BackgroundTaskBar } from "./components/chat/BackgroundTaskBar.js";
import { AppNavRail } from "./components/nav/AppNavRail.js";
import { ProfileMenu } from "./components/settings/ProfileMenu.js";
import { createDraftLocalAgent } from "./identity-draft.js";
import { loadUserProfile, hydrateUserProfile, refreshUserProfileForLocale, saveUserProfile, type LocalUserProfile } from "./user-profile.js";
import {
  countUnreadMessages,
  loadConversationReadAt,
  resolveLatestConversationActivityAt,
  saveConversationReadAt,
  type ConversationReadAtMap,
} from "./conversation-read-state.js";
import { applyEvent, applyRoomUpdate, emptyState, normalizeSnapshot, removeActiveRun, removeDeletedRoom, removeHiddenMessages, upsert, upsertIdentity, upsertMany, upsertMessage, upsertParticipant, type AppState } from "./state.js";
import { backgroundTaskFromSnapshot, createOptimisticBackgroundTask, createPendingAgentReplyTargets, enrichBackgroundTask, isBackgroundTaskVisibleInConversation, isPendingAgentRunId, loadDismissedBackgroundTaskIds, loadLocalTaskBarTaskIds, mergeBackgroundTask, pendingAgentReplyKey, removeLocalTaskBarTaskId, saveDismissedBackgroundTaskIds, addLocalTaskBarTaskId, type AgentRunTaskItem, type BackgroundTask, type PendingAgentReplyTarget } from "./background-tasks.js";
import { formatSummaryLink, primaryMessageLinkId, resolveAgentProfileParticipant, resolveMessageAgentParticipant, resolveMessageSenderLabel, messageSenderLabel } from "./chat-links.js";
import { attachmentLabel, subscribeI18n, t } from "./i18n/index.js";
import { collectMessageProcess } from "./agent-thinking.js";
import { UNREAD_FEATURE_ENABLED } from "./feature-flags.js";
import { initTuttiWorkspaceContextCache, resolveArtifactAgentDraftHref } from "./tutti-bridge.js";
import { loadCachedSnapshot, saveCachedSnapshot } from "./bootstrap-cache.js";
import { buildAgentGuiDraftPrompt } from "./agent-gui-draft-prompt.js";
import { dispatchAgentGuiTask, type TuttiAgentGuiProvider } from "./agent-gui-dispatch.js";
import { localAgentLauncherAppId, resolveAgentGuiProviderFromRuntimeProvider } from "./agent-launcher-mentions.js";
import {
  fetchAvailableAgentLauncherAppIds,
  isAgentLauncherAvailable,
  readCachedAvailableAgentLauncherAppIds,
  sameStringSet,
} from "./agent-launcher-availability.js";
import { formatMessageBodyForAgentForward } from "./reference-mentions.js";
import { collectImageFileArtifactsForMessages } from "./message-artifacts.js";
import { defaultIdentityNameForRuntime, listCanonicalRuntimeProfiles, localAgentStatus } from "./runtime.js";
import { localAgentMentionSubtitle } from "./local-agent-mention-options.js";
import { groupAgentForwardSections } from "./agent-forward-format.js";

const MIN_CONVERSATION_SIDEBAR_WIDTH = 240;
const DEFAULT_CONVERSATION_SIDEBAR_WIDTH = MIN_CONVERSATION_SIDEBAR_WIDTH;
const CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY = "group-chat:conversation-sidebar-width";
const MIN_CHAT_PANE_WIDTH = 460;
const SPLITTER_WIDTH = 4;
const DESKTOP_NAV_WIDTH = 60;
const COMPACT_NAV_WIDTH = 56;
const MESSAGE_PAGE_SIZE = 10;
const MESSAGE_PRERENDER_PAGE_COUNT = 1;
const MESSAGE_PREFETCH_PAGE_COUNT = 2;

function sameLocalAgentProviders(left: LocalAgentProviderStatus[], right: LocalAgentProviderStatus[]) {
  if (left.length !== right.length) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export type ComposerRequest =
  | { type: "insert"; seq: number; content: string }
  | { type: "insertSummaryLink"; seq: number; taskId: string }
  | { type: "quote"; seq: number; quote: ComposerQuote; mentionParticipant?: ComposerMentionParticipant }
  | { type: "quotes"; seq: number; quotes: ComposerQuote[] }
  | { type: "edit"; seq: number; messageId: string; content: string; mentions: Message["mentions"]; blocks: MessageBlock[] };

export interface ComposerQuote {
  messageId: string;
  sender: string;
  content: string;
  mentions: Message["mentions"];
}

export interface ComposerMentionParticipant {
  id: string;
  displayName: string;
}

interface TimelinePageState {
  initialized: boolean;
  visibleMessageIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
}

function toChatSnapshot(state: AppState): ChatSnapshot {
  const { ready: _ready, ...snapshot } = state;
  return snapshot;
}

function messagePageCacheKey(conversationId: string, cursor: string | null | undefined) {
  return `${conversationId}:${cursor ?? "__latest__"}`;
}

function mergeVisibleMessageIds(existing: string[], nextPageIds: string[]) {
  if (nextPageIds.length === 0) return existing;
  const existingIds = new Set(existing);
  return [
    ...nextPageIds.filter((id) => !existingIds.has(id)),
    ...existing,
  ];
}

interface TimelinePageWindow {
  messageIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Virtual Tutti agent participants (id like "tutti-agent:codex") are never persisted to state.participants, so derive their label from the id instead of falling back to a generic name. */
function tuttiAgentParticipantDisplayName(participantId: string | null | undefined) {
  const provider = parseTuttiAgentParticipantId(participantId);
  return provider ? defaultTuttiAgentParticipantName(provider) : null;
}

export function App() {
  const [state, setState] = useState<AppState>(() => {
    const cachedSnapshot = loadCachedSnapshot();
    return cachedSnapshot ? normalizeSnapshot(cachedSnapshot) : emptyState;
  });
  const [localAgentProviders, setLocalAgentProviders] = useState<LocalAgentProviderStatus[]>([]);
  const [availableAgentLauncherAppIds, setAvailableAgentLauncherAppIds] = useState<Set<string>>(
    () => readCachedAvailableAgentLauncherAppIds(),
  );
  const [refreshingLocalAgentProviders, setRefreshingLocalAgentProviders] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileMenuPlacement, setProfileMenuPlacement] = useState<"rail" | "mobile" | "chat">("rail");
  const [profileMenuAnchorEl, setProfileMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [userProfile, setUserProfile] = useState<LocalUserProfile>(() => loadUserProfile());
  const saveUserProfileState = useCallback((profile: LocalUserProfile) => {
    setUserProfile(profile);
    saveUserProfile(profile);
  }, []);
  const [membersPanelOpen, setMembersPanelOpen] = useState(false);
  const [agentProfileParticipantId, setAgentProfileParticipantId] = useState<string | null>(null);
  const [agentProfileShowRemove, setAgentProfileShowRemove] = useState(false);
  const [pendingNewAgentDraft, setPendingNewAgentDraft] = useState<Identity | null>(null);
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  const [openAgentRunId, setOpenAgentRunId] = useState<string | null>(null);
  const [openAgentRunSnapshot, setOpenAgentRunSnapshot] = useState<AgentRun | null>(null);
  const [openThinkingMessageId, setOpenThinkingMessageId] = useState<string | null>(null);
  const [mentionRequest, setMentionRequest] = useState<{ participantId: string; seq: number } | null>(null);
  const [composerRequest, setComposerRequest] = useState<ComposerRequest | null>(null);
  const [conversationSidebarWidth, setConversationSidebarWidth] = useState(loadConversationSidebarWidth);
  const [resizingConversationSidebar, setResizingConversationSidebar] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => state.conversations[0]?.id ?? null);
  const [focusMessageRequest, setFocusMessageRequest] = useState<{ messageId: string; artifactId?: string; seq: number } | null>(null);
  const [focusComposerRequest, setFocusComposerRequest] = useState<{ seq: number } | null>(null);
  const [scrollToBottomRequest, setScrollToBottomRequest] = useState<{ seq: number } | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const lastSeqRef = useRef(state.ready ? state.lastSeq : 0);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileProfileButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const chatProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const deleteDialogRef = useRef<{ resolve: () => void; reject: (reason?: unknown) => void } | null>(null);
  const timelineScrollPreserverRef = useRef<{ capture: (mode?: "absolute" | "prepend") => void } | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<{ ids: string[] } | null>(null);
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [pendingReplyTargets, setPendingReplyTargets] = useState<PendingAgentReplyTarget[]>([]);

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
  const [openMessageLinkSegment, setOpenMessageLinkSegment] = useState<string | null>(null);
  const [conversationReadAt, setConversationReadAt] = useState<ConversationReadAtMap>(() => loadConversationReadAt());
  const previousConversationIdRef = useRef<string | null>(null);
  const [timelinePageStateByConversationId, setTimelinePageStateByConversationId] = useState<Record<string, TimelinePageState>>({});
  const messagePageCacheRef = useRef<Map<string, ConversationMessagesPage>>(new Map());
  const messagePageInFlightRef = useRef<Map<string, Promise<ConversationMessagesPage | null>>>(new Map());

  const refreshLocalAgentProviders = useCallback(async () => {
    setRefreshingLocalAgentProviders(true);
    try {
      const result = await fetchLocalAgentProviders();
      setLocalAgentProviders((current) => sameLocalAgentProviders(current, result.providers) ? current : result.providers);
    } catch {
      // Keep the last known provider list; transient bridge errors should not make the @ menu jump.
    } finally {
      setRefreshingLocalAgentProviders(false);
    }
  }, []);

  const refreshAvailableAgentLauncherApps = useCallback((options?: { force?: boolean }) => {
    void fetchAvailableAgentLauncherAppIds(options).then((ids) => {
      setAvailableAgentLauncherAppIds((current) => sameStringSet(current, ids) ? current : new Set(ids));
    });
  }, []);

  const mergeConversationMessagePage = useCallback((page: ConversationMessagesPage) => {
    setState((current) => {
      let messages = current.messages;
      for (const message of page.messages) {
        messages = upsertMessage(messages, message);
      }
      return {
        ...current,
        messages,
        messageBlocks: upsertMany(current.messageBlocks, page.messageBlocks),
        artifacts: upsertMany(current.artifacts, page.artifacts),
        activeRuns: enrichAgentRuns(current.activeRuns, messages),
      };
    });
  }, []);

  const loadConversationMessagePage = useCallback(async (
    conversationId: string,
    cursor: string | null,
  ): Promise<ConversationMessagesPage | null> => {
    const key = messagePageCacheKey(conversationId, cursor);
    const cached = messagePageCacheRef.current.get(key);
    if (cached) return cached;
    const inFlight = messagePageInFlightRef.current.get(key);
    if (inFlight) return inFlight;

    const request = fetchConversationMessages(conversationId, { limit: MESSAGE_PAGE_SIZE, cursor })
      .then((page) => {
        messagePageCacheRef.current.set(key, page);
        mergeConversationMessagePage(page);
        return page;
      })
      .catch(() => null)
      .finally(() => {
        messagePageInFlightRef.current.delete(key);
      });
    messagePageInFlightRef.current.set(key, request);
    return request;
  }, [mergeConversationMessagePage]);

  const prefetchConversationMessagePages = useCallback(async (conversationId: string, cursor: string | null) => {
    let nextCursor = cursor;
    for (let index = 0; index < MESSAGE_PREFETCH_PAGE_COUNT && nextCursor; index += 1) {
      const page = await loadConversationMessagePage(conversationId, nextCursor);
      if (!page?.hasMore || !page.nextCursor) break;
      nextCursor = page.nextCursor;
    }
  }, [loadConversationMessagePage]);

  const loadConversationMessagePageWindow = useCallback(async (
    conversationId: string,
    cursor: string | null,
    pageCount: number,
  ): Promise<TimelinePageWindow> => {
    let messageIds: string[] = [];
    let nextCursor = cursor;
    let hasMore = Boolean(cursor);
    for (let index = 0; index < pageCount && nextCursor; index += 1) {
      const page = await loadConversationMessagePage(conversationId, nextCursor);
      if (!page) break;
      messageIds = mergeVisibleMessageIds(
        messageIds,
        page.messages.map((message) => message.id),
      );
      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
      if (!page.hasMore || !page.nextCursor) break;
    }
    return { messageIds, nextCursor, hasMore };
  }, [loadConversationMessagePage]);

  const initializeConversationMessages = useCallback(async (conversationId: string) => {
    if (timelinePageStateByConversationId[conversationId]?.initialized) {
      const cursor = timelinePageStateByConversationId[conversationId]?.nextCursor ?? null;
      void prefetchConversationMessagePages(conversationId, cursor);
      return;
    }
    const page = await loadConversationMessagePage(conversationId, null);
    if (!page) return;
    const prerenderWindow = await loadConversationMessagePageWindow(
      conversationId,
      page.nextCursor,
      MESSAGE_PRERENDER_PAGE_COUNT,
    );
    const visibleMessageIds = mergeVisibleMessageIds(
      page.messages.map((message) => message.id),
      prerenderWindow.messageIds,
    );
    const nextCursor = prerenderWindow.messageIds.length ? prerenderWindow.nextCursor : page.nextCursor;
    const hasMore = prerenderWindow.messageIds.length ? prerenderWindow.hasMore : page.hasMore;
    setTimelinePageStateByConversationId((current) => {
      if (current[conversationId]?.initialized) return current;
      return {
        ...current,
        [conversationId]: {
          initialized: true,
          visibleMessageIds,
          nextCursor,
          hasMore,
          loadingOlder: false,
        },
      };
    });
    void prefetchConversationMessagePages(conversationId, nextCursor);
  }, [loadConversationMessagePage, loadConversationMessagePageWindow, prefetchConversationMessagePages, timelinePageStateByConversationId]);

  const loadOlderConversationMessages = useCallback(async (conversationId: string) => {
    const pageState = timelinePageStateByConversationId[conversationId];
    if (!pageState?.hasMore || !pageState.nextCursor || pageState.loadingOlder) return;
    setTimelinePageStateByConversationId((current) => ({
      ...current,
      [conversationId]: current[conversationId] ? {
        ...current[conversationId],
        loadingOlder: true,
      } : pageState,
    }));
    timelineScrollPreserverRef.current?.capture("prepend");
    const prerenderWindow = await loadConversationMessagePageWindow(
      conversationId,
      pageState.nextCursor,
      MESSAGE_PRERENDER_PAGE_COUNT,
    );
    if (!prerenderWindow.messageIds.length) {
      setTimelinePageStateByConversationId((current) => current[conversationId]
        ? { ...current, [conversationId]: { ...current[conversationId]!, loadingOlder: false } }
        : current);
      return;
    }
    setTimelinePageStateByConversationId((current) => {
      const currentPageState = current[conversationId];
      if (!currentPageState) return current;
      return {
        ...current,
        [conversationId]: {
          initialized: true,
          visibleMessageIds: mergeVisibleMessageIds(
            currentPageState.visibleMessageIds,
            prerenderWindow.messageIds,
          ),
          nextCursor: prerenderWindow.nextCursor,
          hasMore: prerenderWindow.hasMore,
          loadingOlder: false,
        },
      };
    });
    void prefetchConversationMessagePages(conversationId, prerenderWindow.nextCursor);
  }, [loadConversationMessagePageWindow, prefetchConversationMessagePages, timelinePageStateByConversationId]);

  useEffect(() => initTuttiWorkspaceContextCache(), []);

  useEffect(() => {
    let cancelled = false;
    void hydrateUserProfile().then((profile) => {
      if (!cancelled) setUserProfile(profile);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeI18n(() => {
      setUserProfile((current) => refreshUserProfileForLocale(current));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const launcherRefreshTimers = [0, 250, 900, 1800].map((delayMs) => window.setTimeout(() => {
      if (!cancelled) refreshAvailableAgentLauncherApps({ force: true });
    }, delayMs));
    fetchSnapshot(MESSAGE_PAGE_SIZE)
      .then((snapshot) => {
        if (cancelled) return;
        lastSeqRef.current = Math.max(lastSeqRef.current, snapshot.lastSeq);
        const nextState = normalizeSnapshot(snapshot);
        setState((current) => current.lastSeq > snapshot.lastSeq ? current : nextState);
        setCurrentConversationId((current) =>
          current && snapshot.conversations.some((conversation) => conversation.id === current)
            ? current
            : snapshot.conversations[0]?.id ?? null,
        );
        saveCachedSnapshot(snapshot);
      })
      .catch(() => {
        // If a cached snapshot is already rendered, keep it visible until reconnect succeeds.
      });
    void refreshLocalAgentProviders();
    return () => {
      cancelled = true;
      launcherRefreshTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [refreshAvailableAgentLauncherApps, refreshLocalAgentProviders]);

  useEffect(() => {
    if (!state.ready) return;
    const saveTimer = window.setTimeout(() => {
      saveCachedSnapshot(toChatSnapshot(state));
    }, 750);
    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [state]);

  useEffect(() => {
    if (!state.ready || !currentConversationId) return;
    void initializeConversationMessages(currentConversationId);
  }, [currentConversationId, initializeConversationMessages, state.ready]);

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

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let disposed = false;
    let hasConnected = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      clearReconnectTimer();
      const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 10_000);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (disposed) return;
      clearReconnectTimer();

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

      ws.addEventListener("open", () => {
        reconnectAttempt = 0;
        hasConnected = true;
        setIsReconnecting(false);
        ws?.send(JSON.stringify({ type: "hello", lastSeq: lastSeqRef.current }));
      });

      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as WsServerMessage;
        if (message.type === "event" && message.event) {
          handleStreamEvent(message.event);
        } else if (message.type === "replay" && message.events) {
          applyEvents(message.events);
        }
      });

      ws.addEventListener("close", () => {
        ws = null;
        if (hasConnected) setIsReconnecting(true);
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        ws?.close();
      });
    };

    connect();

    return () => {
      disposed = true;
      setIsReconnecting(false);
      clearReconnectTimer();
      ws?.close();
      ws = null;
    };
  }, [state.ready, handleStreamEvent, applyEvents]);

  const currentConversation = useMemo(
    () => state.conversations.find((item) => item.id === currentConversationId) ?? null,
    [currentConversationId, state.conversations],
  );
  const currentRoom = useMemo(
    () => currentConversation
      ? state.rooms.find((item) => item.id === currentConversation.roomId) ?? null
      : null,
    [currentConversation, state.rooms],
  );
  const currentParticipants = useMemo(
    () => currentConversation
      ? state.participants.filter((item) => item.conversationId === currentConversation.id && item.status !== "removed")
      : [],
    [currentConversation, state.participants],
  );
  const currentAgents = useMemo(
    () => currentParticipants.filter((item) => item.kind === "ai"),
    [currentParticipants],
  );
  const currentConversationMessages = useMemo(
    () => currentConversation
      ? state.messages
          .filter((item) => item.conversationId === currentConversation.id)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      : [],
    [currentConversation, state.messages],
  );
  const currentTimelinePageState = currentConversation
    ? timelinePageStateByConversationId[currentConversation.id] ?? null
    : null;
  const currentMessages = useMemo(() => {
    if (!currentTimelinePageState?.initialized) {
      return currentConversationMessages.slice(-MESSAGE_PAGE_SIZE);
    }
    const visibleIds = new Set(currentTimelinePageState.visibleMessageIds);
    const newestVisibleMessage = [...currentTimelinePageState.visibleMessageIds]
      .reverse()
      .map((id) => currentConversationMessages.find((message) => message.id === id) ?? null)
      .find((message): message is Message => Boolean(message));
    if (!newestVisibleMessage) return currentConversationMessages.slice(-MESSAGE_PAGE_SIZE);
    return currentConversationMessages.filter((message) => {
      if (visibleIds.has(message.id)) return true;
      return (
        message.createdAt.localeCompare(newestVisibleMessage.createdAt) > 0
        || (message.createdAt === newestVisibleMessage.createdAt && message.id.localeCompare(newestVisibleMessage.id) > 0)
      );
    });
  }, [currentConversationMessages, currentTimelinePageState]);
  const currentMessageIdSet = useMemo(
    () => new Set(currentMessages.map((message) => message.id)),
    [currentMessages],
  );
  const currentMessageBlocks = useMemo(
    () => currentMessageIdSet.size
      ? state.messageBlocks.filter((block) => currentMessageIdSet.has(block.messageId))
      : [],
    [currentMessageIdSet, state.messageBlocks],
  );
  const currentArtifacts = useMemo(
    () => currentConversation
      ? state.artifacts.filter((artifact) => artifact.conversationId === currentConversation.id)
      : [],
    [currentConversation, state.artifacts],
  );
  const messagesById = useMemo(
    () => new Map(state.messages.map((message) => [message.id, message])),
    [state.messages],
  );
  const currentParticipantsById = useMemo(
    () => new Map(currentParticipants.map((participant) => [participant.id, participant])),
    [currentParticipants],
  );
  const currentConversationAgentRuns = useMemo(
    () => currentConversation
      ? state.agentRuns.filter((run) => run.conversationId === currentConversation.id)
      : [],
    [currentConversation, state.agentRuns],
  );
  const agentForwardTargets = useMemo<AgentForwardTarget[]>(() => {
    const agentGuiBridgeAvailable = Boolean(window.tuttiExternal?.workspace?.openFeature);
    const targets = listCanonicalRuntimeProfiles(state.runtimeProfiles)
      .filter((profile) => profile.kind === "local-agent")
      .map((profile): AgentForwardTarget | null => {
        const provider = resolveAgentGuiProviderFromRuntimeProvider(profile.provider);
        if (!provider) return null;
        const status = localAgentStatus(profile, localAgentProviders);
        const launcherAppId = localAgentLauncherAppId(profile.provider);
        if (launcherAppId && !isAgentLauncherAvailable(
          launcherAppId,
          availableAgentLauncherAppIds,
          status?.available === true,
          agentGuiBridgeAvailable,
        )) return null;
        if (!launcherAppId && !status?.available) return null;
        const target: AgentForwardTarget = {
          provider,
          runtimeProvider: profile.provider,
          label: status?.displayName?.trim() || defaultIdentityNameForRuntime(profile, localAgentProviders),
          subtitle: status
            ? localAgentMentionSubtitle(profile, status, localAgentProviders)
            : defaultIdentityNameForRuntime(profile, localAgentProviders),
          available: true,
        };
        return target;
      })
      .filter((target): target is AgentForwardTarget => Boolean(target));
    return targets.sort((left, right) => left.label.localeCompare(right.label));
  }, [availableAgentLauncherAppIds, localAgentProviders, state.runtimeProfiles]);
  const currentActiveRuns = useMemo(
    () => currentConversation
      ? visibleActiveRuns(
          state.activeRuns.filter((run) => run.conversationId === currentConversation.id),
          messagesById,
        )
      : [],
    [currentConversation, messagesById, state.activeRuns],
  );
  const currentBackgroundTasks = useMemo(() => {
    const localTaskIds = loadLocalTaskBarTaskIds();
    return backgroundTasks.filter(
      (task) => isBackgroundTaskVisibleInConversation(
        task,
        currentConversation?.id,
        localTaskIds,
        dismissedBackgroundTaskIds,
      ),
    );
  }, [backgroundTasks, currentConversation?.id, dismissedBackgroundTaskIds]);
  const openBackgroundTask = useMemo(
    () => openBackgroundTaskId && currentConversation && !dismissedBackgroundTaskIds.has(openBackgroundTaskId)
      ? backgroundTasks.find(
          (task) =>
            task.id === openBackgroundTaskId
            && task.panelOpen
            && task.conversationId === currentConversation.id,
        ) ?? null
      : null,
    [backgroundTasks, currentConversation, dismissedBackgroundTaskIds, openBackgroundTaskId],
  );
  const enrichedOpenBackgroundTask = useMemo(
    () => openBackgroundTask
      ? {
          ...openBackgroundTask,
          sourceMessage:
            openBackgroundTask.sourceMessage
            ?? (openBackgroundTask.sourceMessageId
              ? messagesById.get(openBackgroundTask.sourceMessageId) ?? null
              : null),
          targetParticipant:
            openBackgroundTask.targetParticipant
            ?? currentParticipantsById.get(openBackgroundTask.participantId)
            ?? null,
        }
      : null,
    [currentParticipantsById, messagesById, openBackgroundTask],
  );
  const agentRunTasks: AgentRunTaskItem[] = useMemo(() => {
    const runTasks = currentActiveRuns.map((run) => {
      const visibility = resolveAgentRunVisibility(run, currentMessages);
      const participantName = currentParticipantsById.get(run.participantId ?? "")?.displayName
        ?? tuttiAgentParticipantDisplayName(run.participantId)
        ?? t("common.agent");
      return {
        id: run.id,
        type: "agent-run" as const,
        conversationId: run.conversationId,
        participantName,
        status: "running" as const,
        preview: t("app.executingPreview", { name: participantName }),
        visibility,
      };
    });
    if (!currentConversation) return runTasks;
    const settledKeys = new Set(
      currentConversationAgentRuns
        .filter((run) => run.triggerMessageId && run.participantId)
        .map((run) => pendingAgentReplyKey(run.triggerMessageId!, run.participantId!)),
    );
    const optimisticTasks = pendingReplyTargets
      .filter((pending) => pending.conversationId === currentConversation.id)
      .filter((pending) => !settledKeys.has(pending.key))
      .map((pending) => ({
        id: `pending:${pending.key}`,
        type: "agent-run" as const,
        conversationId: pending.conversationId,
        participantName: pending.participantName,
        status: "running" as const,
        preview: t("app.executingPreview", { name: pending.participantName }),
        visibility: pending.visibility,
      }));
    return [...optimisticTasks, ...runTasks];
  }, [currentActiveRuns, currentConversation, currentConversationAgentRuns, currentMessages, currentParticipantsById, pendingReplyTargets]);
  const openPendingAgentRunKey = openAgentRunId && isPendingAgentRunId(openAgentRunId)
    ? openAgentRunId.slice("pending:".length)
    : null;
  const openPendingAgentRun = openPendingAgentRunKey
    ? currentConversationAgentRuns.find(
        (run) =>
          run.triggerMessageId
          && run.participantId
          && pendingAgentReplyKey(run.triggerMessageId, run.participantId) === openPendingAgentRunKey,
      ) ?? null
    : null;
  const resolvedOpenAgentRunId = openPendingAgentRun?.id ?? openAgentRunId;
  const openAgentRun = resolvedOpenAgentRunId
    ? currentActiveRuns.find((run) => run.id === resolvedOpenAgentRunId)
      ?? currentConversationAgentRuns.find((run) => run.id === resolvedOpenAgentRunId)
      ?? (openAgentRunSnapshot?.id === resolvedOpenAgentRunId ? openAgentRunSnapshot : null)
    : null;
  const openAgentRunEvents = resolvedOpenAgentRunId
    ? state.agentRunEvents
        .filter((event) => event.runId === resolvedOpenAgentRunId)
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
    const pendingKey = isPendingAgentRunId(runId) ? runId.slice("pending:".length) : null;
    const resolvedRun = pendingKey
      ? state.activeRuns.find(
          (item) =>
            item.triggerMessageId
            && item.participantId
            && pendingAgentReplyKey(item.triggerMessageId, item.participantId) === pendingKey,
        ) ?? null
      : null;
    const run = resolvedRun ?? state.activeRuns.find((item) => item.id === runId);
    if (run) setOpenAgentRunSnapshot(run);
    setOpenAgentRunId(run?.id ?? runId);
    setOpenThinkingMessageId(null);
    setFilesPanelOpen(false);
    setOpenBackgroundTaskId(null);
  }, [state.activeRuns]);
  useEffect(() => {
    if (!openAgentRunId || !isPendingAgentRunId(openAgentRunId)) return;
    const pendingKey = openAgentRunId.slice("pending:".length);
    const run = state.activeRuns.find(
      (item) =>
        item.triggerMessageId
        && item.participantId
        && pendingAgentReplyKey(item.triggerMessageId, item.participantId) === pendingKey,
    );
    if (!run) return;
    setOpenAgentRunSnapshot(run);
    setOpenAgentRunId(run.id);
  }, [openAgentRunId, state.activeRuns]);
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
  const pendingAgentSetupIdentity = pendingNewAgentDraft;
  const agentProfileDialogIdentity = agentProfileIdentity ?? pendingAgentSetupIdentity;
  const agentProfileRuntime = agentProfileParticipant?.runtimeProfileId
    ? state.runtimeProfiles.find((item) => item.id === agentProfileParticipant.runtimeProfileId) ?? null
    : agentProfileDialogIdentity?.defaultRuntimeProfileId
      ? state.runtimeProfiles.find((item) => item.id === agentProfileDialogIdentity.defaultRuntimeProfileId) ?? null
      : null;
  const clearAgentProfileDialog = () => {
    setAgentProfileParticipantId(null);
    setAgentProfileShowRemove(false);
    setPendingNewAgentDraft(null);
  };
  const finishAgentProfileAdd = () => {
    clearAgentProfileDialog();
    setMembersPanelOpen(true);
  };
  const finishAgentProfileDialog = () => {
    clearAgentProfileDialog();
    setMembersPanelOpen(false);
  };
  const openNewAgentSetup = () => {
    setAgentProfileParticipantId(null);
    setAgentProfileShowRemove(false);
    setPendingNewAgentDraft(createDraftLocalAgent(state.runtimeProfiles, localAgentProviders));
  };
  const onCreateRoom = async () => {
    const result = await createRoom({
      title: nextDefaultRoomTitle(state.rooms),
      description: t("app.newRoomDescription"),
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
    const ok = window.confirm(t("app.deleteChatConfirm", { title: conversation.title }));
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
      runtimeProfile?: RuntimeProfile | null;
    };
    setState((current) => ({
      ...current,
      participants: upsert(current.participants, result.participant),
      runtimeProfiles: upsert(current.runtimeProfiles, result.runtimeProfile),
      messages: result.systemMessage ? upsert(current.messages, result.systemMessage) : current.messages,
    }));
    return result;
  };

  const onUpdateParticipant = async (participantId: string, input: UpdateParticipantRequest) => {
    const result = (await updateParticipant(participantId, input)) as {
      participant: Participant | null;
      runtimeProfile?: RuntimeProfile | null;
    };
    if (!result.participant) {
      throw new Error(t("app.updateAgentFailed"));
    }
    setState((current) => ({
      ...current,
      participants: upsert(current.participants, result.participant),
      runtimeProfiles: upsert(current.runtimeProfiles, result.runtimeProfile),
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
    const result = (await createIdentity(input)) as { identity: Identity; runtimeProfile?: RuntimeProfile | null };
    if (result.identity) {
      setState((current) => ({
        ...current,
        identities: upsertIdentity(current.identities, result.identity),
        runtimeProfiles: upsert(current.runtimeProfiles, result.runtimeProfile),
      }));
    }
    return result;
  };

  const onUpdateIdentity = async (identityId: string, input: UpdateIdentityRequest) => {
    const result = (await updateIdentity(identityId, input)) as {
      identity: Identity | null;
      runtimeProfile?: RuntimeProfile | null;
    };
    if (!result.identity) {
      throw new Error(t("app.agentSaveFailed"));
    }
    setState((current) => ({
      ...current,
      identities: upsertIdentity(current.identities, result.identity),
      runtimeProfiles: upsert(current.runtimeProfiles, result.runtimeProfile),
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
    timelineScrollPreserverRef.current?.capture();
    try {
      await cancelRun(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("app.cancelTaskFailed");
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
      const confirmed = window.confirm(t("app.cancelRunningTaskConfirm"));
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
    if (isPendingAgentRunId(runId)) {
      const pendingKey = runId.slice("pending:".length);
      const pending = pendingReplyTargets.find((item) => item.key === pendingKey) ?? null;
      setPendingReplyTargets((current) => current.filter((item) => item.key !== pendingKey));
      const realRun = pending
        ? state.activeRuns.find(
            (run) => run.triggerMessageId === pending.triggerMessageId && run.participantId === pending.participantId,
          )
        : null;
      if (realRun) await cancelActiveRun(realRun.id);
      return;
    }
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
        window.alert(error instanceof Error ? error.message : t("app.summaryStartFailed"));
      }
    },
    [state.messageBlocks, state.artifacts],
  );

  const openMessageLink = (messageIdSegment: string) => {
    const firstMessageId = primaryMessageLinkId(messageIdSegment);
    const message = state.messages.find((item) => item.id === firstMessageId);
    if (!message) {
      window.alert(t("app.summaryNotFound"));
      return;
    }
    setOpenMessageLinkSegment(messageIdSegment);
    setOpenBackgroundTaskId(null);
    setOpenThinkingMessageId(null);
  };

  const closeMessageLinkPanel = () => {
    setOpenMessageLinkSegment(null);
  };

  const ensureBackgroundTask = useCallback(async (taskId: string, options: { refresh?: boolean } = {}) => {
    const existing = backgroundTasks.find((task) => task.id === taskId);
    if (existing && !options.refresh) return existing;
    try {
      const { task } = await getPrivateTask(taskId);
      const nextTask = enrichBackgroundTask(task, {
        messages: state.messages,
        participants: state.participants,
      }, existing);
      setBackgroundTasks((current) => {
        const currentTask = current.find((item) => item.id === taskId);
        const enriched = currentTask === existing
          ? nextTask
          : enrichBackgroundTask(task, {
              messages: state.messages,
              participants: state.participants,
            }, currentTask);
        return [...current.filter((item) => item.id !== taskId), enriched];
      });
      return nextTask;
    } catch {
      return null;
    }
  }, [backgroundTasks, state.messages, state.participants]);

  useEffect(() => {
    if (!state.ready) return;
    const localTaskIds = [...loadLocalTaskBarTaskIds()].filter((taskId) => !dismissedBackgroundTaskIds.has(taskId));
    if (!localTaskIds.length) return;
    let cancelled = false;
    void (async () => {
      for (const taskId of localTaskIds) {
        try {
          const { task } = await getPrivateTask(taskId);
          if (cancelled) continue;
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
  }, [state.ready, dismissedBackgroundTaskIds, state.messages, state.participants]);

  const openSummaryLink = useCallback(async (taskId: string) => {
    const task = await ensureBackgroundTask(taskId, { refresh: true });
    if (!task) {
      window.alert(t("app.summaryTaskMissing"));
      return;
    }
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
    let latestWidth = conversationSidebarWidth;
    const updateWidth = (clientX: number) => {
      const rawWidth = clientX - shellRect.left - navWidth;
      latestWidth = clamp(rawWidth, MIN_CONVERSATION_SIDEBAR_WIDTH, maxSidebarWidth);
      setConversationSidebarWidth(latestWidth);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateWidth(moveEvent.clientX);
    };
    const stopResize = () => {
      saveConversationSidebarWidth(latestWidth);
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

  const registerPendingReplyTargets = useCallback((result: SendMessageResponse) => {
    if (!result.message || !result.targets?.length) return;
    const pending = createPendingAgentReplyTargets(result.message, result.targets);
    setPendingReplyTargets((current) => [
      ...current.filter((item) => item.triggerMessageId !== result.message!.id),
      ...pending,
    ]);
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
      registerPendingReplyTargets(result);
      setScrollToBottomRequest((current) => ({ seq: (current?.seq ?? 0) + 1 }));
      window.setTimeout(() => void refreshSnapshot(), 900);
      window.setTimeout(() => void refreshSnapshot(), 2500);
      return result;
    },
    [mergeSentMessage, refreshSnapshot, registerPendingReplyTargets],
  );

  const onUpdateMessage = useCallback(
    async (messageId: string, input: UpdateMessageRequest) => {
      const result = await updateMessage(messageId, input);
      setState((current) => {
        const messages = upsertMessage(current.messages, result.message);
        return {
          ...current,
          messages,
          messageBlocks: upsertMany(
            current.messageBlocks.filter((block) => block.messageId !== result.message.id),
            result.blocks ?? [],
          ),
          artifacts: upsertMany(current.artifacts, result.artifacts ?? []),
          activeRuns: enrichAgentRuns(current.activeRuns, messages),
        };
      });
      registerPendingReplyTargets(result);
      window.setTimeout(() => void refreshSnapshot(), 900);
      return result;
    },
    [registerPendingReplyTargets, refreshSnapshot],
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
          content: message.content.trim() || attachmentLabel(),
          mentions: message.mentions,
        }));
      if (quotes.length === 1) {
        const sourceMessage = messages.find((message) => message.id === quotes[0]!.messageId);
        const mentionParticipant = sourceMessage?.senderParticipantId
          ? state.participants.find((participant) => participant.id === sourceMessage.senderParticipantId)
          : null;
        setComposerRequest((current) => ({
          seq: (current?.seq ?? 0) + 1,
          type: "quote",
          quote: quotes[0]!,
          ...(mentionParticipant
            ? { mentionParticipant: { id: mentionParticipant.id, displayName: mentionParticipant.displayName } }
            : {}),
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

  const insertSummaryLinkToComposer = useCallback((taskId: string) => {
    setComposerRequest((current) => ({
      seq: (current?.seq ?? 0) + 1,
      type: "insertSummaryLink",
      taskId,
    }));
    setFocusComposerRequest((current) => ({ seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const forwardMessagesToAgent = async (messages: Message[], provider: TuttiAgentGuiProvider) => {
    const visibleMessages = messages.filter((message) => message.status !== "deleted" && message.status !== "recalled");
    if (!visibleMessages.length) return;
    const content = formatMessagesForAgentForward(
      visibleMessages,
      state.messageBlocks,
      state.artifacts,
      state.participants,
      state.identities,
      userProfile.displayName,
    );
    const mentions = visibleMessages.flatMap((message) => message.mentions ?? []);
    const prompt = buildAgentGuiDraftPrompt(content, mentions, {
      artifacts: state.artifacts,
      messages: state.messages,
      participants: state.participants,
      identities: state.identities,
      userDisplayName: userProfile.displayName,
      summaryTasks: backgroundTasks,
    });
    const opened = await dispatchAgentGuiTask({ provider, prompt });
    if (!opened) {
      window.alert(t("messageActions.forwardToAgentFailed"));
    }
  };

  const forwardSummaryToAgent = async (task: BackgroundTask, provider: TuttiAgentGuiProvider) => {
    const prompt = buildAgentGuiDraftPrompt(formatSummaryLink(task.id), [], {
      artifacts: state.artifacts,
      messages: state.messages,
      participants: state.participants,
      identities: state.identities,
      userDisplayName: userProfile.displayName,
      summaryTasks: backgroundTasks,
    });
    const opened = await dispatchAgentGuiTask({ provider, prompt });
    if (!opened) {
      window.alert(t("messageActions.forwardToAgentFailed"));
    }
  };

  const requestComposerEdit = (message: Message) => {
    setComposerRequest((current) => ({
      seq: (current?.seq ?? 0) + 1,
      type: "edit",
      messageId: message.id,
      content: message.content,
      mentions: message.mentions,
      blocks: state.messageBlocks.filter((block) => block.messageId === message.id),
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
    setFilesPanelOpen(false);
    setOpenAgentRunId(null);
    setOpenAgentRunSnapshot(null);
    setOpenThinkingMessageId(null);
    clearAgentProfileDialog();
    setMessageSelectionMode(false);
    setMentionRequest(null);
    if (!currentConversationId || !state.ready) return;
    setFocusComposerRequest((current) => ({ seq: (current?.seq ?? 0) + 1 }));
  }, [currentConversationId, state.ready]);

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
    if (!UNREAD_FEATURE_ENABLED) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const conversation of state.conversations) {
      if (conversation.id === currentConversationId) {
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
  }, [conversationReadAt, currentConversationId, state.conversations, state.messages]);

  const totalUnreadCount = useMemo(() => {
    if (!UNREAD_FEATURE_ENABLED) return 0;
    return Object.values(unreadCountsByConversation).reduce((sum, count) => sum + count, 0);
  }, [unreadCountsByConversation]);

  useEffect(() => {
    if (!UNREAD_FEATURE_ENABLED) return;
    if (!state.ready) return;

    const previousConversationId = previousConversationIdRef.current;
    if (previousConversationId && previousConversationId !== currentConversationId) {
      markConversationRead(previousConversationId);
    }
    if (currentConversationId) {
      markConversationRead(currentConversationId);
    }
    previousConversationIdRef.current = currentConversationId;
  }, [currentConversationId, markConversationRead, state.messages, state.ready]);

  const shellStyle = {
    "--conversation-sidebar-width": `${conversationSidebarWidth}px`,
    "--chat-pane-min-width": `${MIN_CHAT_PANE_WIDTH}px`,
  } as CSSProperties;

  if (!state.ready) {
    return <AppLoadingSkeleton shellStyle={shellStyle} />;
  }

  return (
    <div
      ref={appShellRef}
      style={shellStyle}
      data-resizing-sidebar={resizingConversationSidebar || undefined}
      className={"[display:grid] [grid-template-columns:60px_var(--conversation-sidebar-width)_3px_minmax(var(--chat-pane-min-width),_1fr)] [height:100vh] [overflow:hidden] [background:var(--bg)] [&[data-resizing-sidebar=true]_*]:[cursor:col-resize] max-[1080px]:[grid-template-columns:56px_var(--conversation-sidebar-width)_3px_minmax(var(--chat-pane-min-width),_1fr)] max-[760px]:[grid-template-columns:1fr]"}
    >
      <AppNavRail
        profileMenuOpen={profileMenuOpen && profileMenuPlacement === "rail"}
        onToggleProfileMenu={() => toggleProfileMenu("rail")}
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

      <ConversationSidebar
            rooms={state.rooms}
            conversations={state.conversations}
            messages={state.messages}
            currentConversationId={currentConversationId}
            unreadCounts={unreadCountsByConversation}
            onSelect={setCurrentConversationId}
            onCreateRoom={onCreateRoom}
            onTogglePin={onToggleConversationPin}
          />

          <button
            type="button"
            className={"[position:relative] [z-index:20] [width:3px] [min-width:3px] [height:100vh] [border:0] [padding:0] [background:var(--border)] [cursor:col-resize] [transition:background-color_0.12s_ease] hover:[background:var(--border-strong)] focus-visible:[outline:none] focus-visible:[background:var(--border-strong)] max-[760px]:[display:none]"}
            aria-label={t("app.resizeHandle")}
            title={t("app.resizeTitle")}
            onPointerDown={startConversationSidebarResize}
          />

          <main className={"[display:grid] [position:relative] [min-width:0] [min-height:0] [grid-template-rows:56px_minmax(0,_1fr)_auto] [background:var(--panel)]"}>
            {currentConversation && currentRoom ? (
              <>
                <ChatHeader
                  room={currentRoom}
                  conversation={currentConversation}
                  participants={currentParticipants}
                  allParticipants={state.participants}
                  identities={state.identities}
                  runtimeProfiles={state.runtimeProfiles}
                  conversations={state.conversations}
                  rooms={state.rooms}
                  artifacts={state.artifacts}
                  allMessages={state.messages}
                  allBlocks={state.messageBlocks}
                  summaryTasks={backgroundTasks}
                  agentCount={currentAgents.length}
                  messages={currentMessages}
                  agentsOpen={membersPanelOpen}
                  filesOpen={filesPanelOpen}
                  userProfile={userProfile}
                  profileMenuOpen={profileMenuOpen && profileMenuPlacement === "mobile"}
                  profileButtonRef={mobileProfileButtonRef}
                  onToggleProfileMenu={() => toggleProfileMenu("mobile")}
                  onUpdateRoom={onUpdateRoom}
                  onDeleteRoom={() => onDeleteRoom(currentRoom, currentConversation)}
                  onRoomPreviewChange={onRoomPreviewChange}
                  onToggleAgents={() => {
                    setFilesPanelOpen(false);
                    clearAgentProfileDialog();
                    setMembersPanelOpen((current) => !current);
                  }}
                  onToggleFiles={() => {
                    setMembersPanelOpen(false);
                    clearAgentProfileDialog();
                    setOpenAgentRunId(null);
                    setOpenAgentRunSnapshot(null);
                    setOpenThinkingMessageId(null);
                    setFilesPanelOpen((current) => !current);
                  }}
                  onInvitePeople={() => setInviteDialogOpen(true)}
                  onFocusMessage={(messageId) => {
                    setFocusMessageRequest((current) => ({
                      messageId,
                      seq: (current?.seq ?? 0) + 1,
                    }));
                  }}
                  onOpenMessageLink={openMessageLink}
                  onOpenSummaryLink={(taskId) => void openSummaryLink(taskId)}
                  onEnsureSummaryTask={ensureBackgroundTask}
                  onOpenArtifact={(artifact) => revealArtifactInTuttiFileManager(artifact)}
                  onOpenAgentProfile={(participant) => {
                    setPendingNewAgentDraft(null);
                    setAgentProfileShowRemove(true);
                    setAgentProfileParticipantId(participant.id);
                  }}
                />
                {isReconnecting ? <ReconnectingBanner /> : null}
                <RoomAgentsDialog
                  open={membersPanelOpen}
                  conversationId={currentConversation.id}
                  participants={currentParticipants}
                  identities={state.identities}
                  runtimeProfiles={state.runtimeProfiles}
                  localAgentProviders={localAgentProviders}
                  onClose={() => {
                    setMembersPanelOpen(false);
                    clearAgentProfileDialog();
                  }}
                  onStartAddAgent={openNewAgentSetup}
                  onOpenParticipant={(participant) => {
                    setPendingNewAgentDraft(null);
                    setAgentProfileShowRemove(true);
                    setAgentProfileParticipantId(participant.id);
                  }}
                />
                <ConversationFilesPanel
                  open={filesPanelOpen}
                  conversationId={currentConversation.id}
                  artifacts={currentArtifacts}
                  messages={currentMessages}
                  messageBlocks={currentMessageBlocks}
                  agentRuns={state.agentRuns}
                  participants={currentParticipants}
                  identities={state.identities}
                  userDisplayName={userProfile.displayName}
                  onClose={() => setFilesPanelOpen(false)}
                  onFocusMessage={({ messageId, artifactId }) => {
                    setFocusMessageRequest((current) => ({
                      messageId,
                      artifactId,
                      seq: (current?.seq ?? 0) + 1,
                    }));
                    setFilesPanelOpen(false);
                  }}
                />
                <MessageLinkDetailPanel
                  open={Boolean(openMessageLinkSegment)}
                  messageIdSegment={openMessageLinkSegment ?? ""}
                  messages={state.messages}
                  blocks={state.messageBlocks}
                  artifacts={state.artifacts}
                  participants={state.participants}
                  identities={state.identities}
                  conversations={state.conversations}
                  rooms={state.rooms}
                  runtimeProfiles={state.runtimeProfiles}
                  agentRuns={state.agentRuns}
                  agentRunEvents={state.agentRunEvents}
                  summaryTasks={backgroundTasks}
                  userProfile={userProfile}
                  onClose={closeMessageLinkPanel}
                  onOpenArtifact={(artifact) => revealArtifactInTuttiFileManager(artifact)}
                  onOpenAgentProfile={(participant) => {
                    setPendingNewAgentDraft(null);
                    setAgentProfileShowRemove(true);
                    setAgentProfileParticipantId(participant.id);
                  }}
                  onOpenMessageLink={openMessageLink}
                  onOpenSummaryLink={(taskId) => void openSummaryLink(taskId)}
                  onEnsureSummaryTask={ensureBackgroundTask}
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
                  blocks={currentMessageBlocks}
                  allBlocks={state.messageBlocks}
                  artifacts={currentArtifacts}
                  allArtifacts={state.artifacts}
                  agentRunEvents={state.agentRunEvents}
                  agentRuns={state.agentRuns}
                  participants={currentParticipants}
                  allParticipants={state.participants}
                  conversations={state.conversations}
                  rooms={state.rooms}
                  participantsCount={currentAgents.length}
                  agentForwardTargets={agentForwardTargets}
                  focusMessageRequest={focusMessageRequest}
                  scrollToBottomRequest={scrollToBottomRequest}
                  hasMoreBefore={Boolean(currentTimelinePageState?.hasMore)}
                  loadingBefore={Boolean(currentTimelinePageState?.loadingOlder)}
                  onLoadBefore={() => void loadOlderConversationMessages(currentConversation.id)}
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
                    if (options?.startAdding) {
                      openNewAgentSetup();
                      return;
                    }
                    setMembersPanelOpen(true);
                  }}
                  onOpenAgentProfile={(participant) => {
                    setFilesPanelOpen(false);
                    setMembersPanelOpen(false);
                    clearAgentProfileDialog();
                    setAgentProfileParticipantId(participant.id);
                  }}
                  onMentionParticipant={requestMention}
                  onOpenMessageLink={openMessageLink}
                  onOpenSummaryLink={(taskId) => void openSummaryLink(taskId)}
                  onInsertSummaryLink={insertSummaryLinkToComposer}
                  onEnsureSummaryTask={ensureBackgroundTask}
                  summaryTasks={backgroundTasks}
                  onQuoteMessages={requestComposerInsert}
                  onForwardMessagesToAgent={(messages, provider) => void forwardMessagesToAgent(messages, provider)}
                  onForwardSummaryToAgent={(task, provider) => void forwardSummaryToAgent(task, provider)}
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
                    if (!window.confirm(t("app.recallConfirm"))) return Promise.resolve();
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
                  onRefreshLocalAgentProviders={refreshLocalAgentProviders}
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
                  onCreateIdentity={onCreateIdentity}
                  onUpdateIdentity={onUpdateIdentity}
                />
                <div className={"[display:flex] [flex-direction:column] [flex-shrink:0] [position:relative] [z-index:20] [min-height:0] [background:var(--panel)]"}>
                  <BackgroundTaskBar
                    tasks={currentBackgroundTasks}
                    agentRuns={agentRunTasks}
                    openTaskId={openBackgroundTaskId}
                    openAgentRunId={openAgentRunId}
                    onOpenTask={(taskId) => void openSummaryLink(taskId)}
                    onDismissTask={dismissBackgroundTask}
                    onDismissAgentRun={dismissAgentRunTask}
                    onOpenAgentRun={openAgentRunPanel}
                  />
                  <div ref={setBulkToolbarHost} className={"[position:relative] [z-index:50] [min-height:0]"}>
                    <div className={messageSelectionMode ? "[visibility:hidden] [pointer-events:none]" : ""} aria-hidden={messageSelectionMode}>
                      <Composer
                        conversation={currentConversation}
                        conversationId={currentConversation.id}
                        participants={currentParticipants}
                        identities={state.identities}
                        runtimeProfiles={state.runtimeProfiles}
                        localAgentProviders={localAgentProviders}
                        allMessages={state.messages}
                        allParticipants={state.participants}
                        conversations={state.conversations}
                        rooms={state.rooms}
                        activeRuns={currentActiveRuns}
                        agentRuns={currentConversationAgentRuns}
                        onSend={onSendMessage}
                        onUpdateMessage={onUpdateMessage}
                        onUpload={uploadArtifact}
                        onCancelRun={cancelActiveRun}
                        onRefreshLocalAgentProviders={refreshLocalAgentProviders}
                        mentionRequest={mentionRequest}
                        focusRequest={focusComposerRequest}
                        composerRequest={composerRequest}
                        summaryTasks={backgroundTasks}
                        onOpenSummaryLink={openSummaryLink}
                        onOpenMessageLink={openMessageLink}
                        userDisplayName={userProfile.displayName}
                        artifacts={currentArtifacts}
                        allArtifacts={state.artifacts}
                        onFocusRoomFile={({ messageId, artifactId }) => {
                          setFocusMessageRequest((current) => ({
                            messageId,
                            artifactId,
                            seq: (current?.seq ?? 0) + 1,
                          }));
                        }}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className={"[display:grid] [min-height:100%] [place-items:center] [padding:28px] [color:var(--muted)] [text-align:center] [&_p]:[margin:8px_0_0] [&_p]:[font-size:13px]"}>
                <div className={"[display:grid] [place-items:center] [gap:12px] [max-width:320px] [border:1px_solid_var(--border)] [border-radius:14px] [padding:34px_28px] [background:var(--panel)] [box-shadow:var(--shadow-soft)]"}>
                  <span className={"[display:grid] [width:58px] [height:58px] [place-items:center] [border-radius:16px] [color:#ffffff] [background:var(--primary)]"}>
                    <Bot size={30} />
                  </span>
                  <strong className={"[color:var(--text)] [font-size:17px] [font-weight:760]"}>{t("app.selectChannel")}</strong>
                  <p>{t("app.emptyChannelHint")}</p>
                </div>
              </div>
            )}
          </main>
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
      {deletePrompt ? (
        <DeleteMessageConfirmDialog
          count={deletePrompt.ids.length}
          deleting={deletingMessages}
          onCancel={cancelDeleteMessages}
          onConfirm={() => void confirmDeleteMessages()}
        />
      ) : null}
      {inviteDialogOpen ? <InvitePeopleDialog onClose={() => setInviteDialogOpen(false)} /> : null}
    </div>
  );
}

function ReconnectingBanner() {
  return (
    <div className={"[position:absolute] [top:56px] [left:50%] [z-index:28] [display:inline-flex] [transform:translateX(-50%)] [align-items:center] [gap:6px] [border:1px_solid_var(--border)] [border-radius:999px] [padding:5px_10px] [color:var(--muted)] [background:#fffffff2] [box-shadow:var(--shadow-soft)] [font-size:12px] [font-weight:650]"}>
      <Loader2 size={13} className={"animate-spin"} aria-hidden />
      <span>{t("app.reconnecting")}</span>
    </div>
  );
}

function AppLoadingSkeleton(props: { shellStyle: CSSProperties }) {
  const sidebarRows = [0, 1, 2, 3, 4, 5];
  const messageRows = [
    { align: "start", width: "min(520px, 72%)" },
    { align: "end", width: "min(460px, 64%)" },
    { align: "start", width: "min(600px, 78%)" },
    { align: "start", width: "min(380px, 58%)" },
  ] as const;

  return (
    <div
      style={props.shellStyle}
      className={"[display:grid] [grid-template-columns:60px_var(--conversation-sidebar-width)_3px_minmax(var(--chat-pane-min-width),_1fr)] [height:100vh] [overflow:hidden] [background:var(--bg)] max-[1080px]:[grid-template-columns:56px_var(--conversation-sidebar-width)_3px_minmax(var(--chat-pane-min-width),_1fr)] max-[760px]:[grid-template-columns:1fr]"}
      aria-busy="true"
      aria-label={t("app.loading")}
    >
      <div className={"[display:flex] [height:100vh] [flex-direction:column] [align-items:center] [gap:14px] [border-right:1px_solid_var(--border)] [background:var(--panel)] [padding:12px_8px] max-[760px]:[display:none]"}>
        <SkeletonBlock className={"[width:34px] [height:34px] [border-radius:12px]"} />
        <SkeletonBlock className={"[width:32px] [height:32px] [border-radius:10px]"} />
        <SkeletonBlock className={"[width:32px] [height:32px] [border-radius:10px]"} />
        <div className={"[flex:1]"} />
        <SkeletonBlock className={"[width:34px] [height:34px] [border-radius:999px]"} />
      </div>

      <aside className={"[display:flex] [height:100vh] [min-width:0] [flex-direction:column] [background:var(--panel)] max-[760px]:[display:none]"}>
        <div className={"[display:flex] [height:52px] [align-items:center] [justify-content:space-between] [gap:12px] [padding:12px_14px_10px_16px]"}>
          <SkeletonBlock className={"[width:92px] [height:18px] [border-radius:6px]"} />
          <SkeletonBlock className={"[width:34px] [height:34px] [border-radius:12px]"} />
        </div>
        <div className={"[padding:0_8px_10px]"}>
          <SkeletonBlock className={"[width:100%] [height:36px] [border-radius:14px]"} />
        </div>
        <div className={"[display:grid] [gap:6px] [padding:2px_8px_12px]"}>
          {sidebarRows.map((row) => (
            <div key={row} className={"[display:grid] [grid-template-columns:32px_minmax(0,_1fr)] [align-items:center] [gap:8px] [min-height:56px] [padding:4px_8px]"}>
              <SkeletonBlock className={"[width:32px] [height:32px] [border-radius:11px]"} />
              <div className={"[display:grid] [gap:7px]"}>
                <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:12px]"}>
                  <SkeletonBlock className={"[width:42%] [height:13px] [border-radius:5px]"} />
                  <SkeletonBlock className={"[width:34px] [height:10px] [border-radius:5px]"} />
                </div>
                <SkeletonBlock className={"[width:76%] [height:12px] [border-radius:5px]"} />
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className={"[width:3px] [height:100vh] [background:var(--border)] max-[760px]:[display:none]"} />

      <main className={"[display:grid] [min-width:0] [min-height:0] [grid-template-rows:56px_minmax(0,_1fr)_auto] [background:var(--panel)]"}>
        <header className={"[display:flex] [height:56px] [align-items:center] [justify-content:space-between] [gap:12px] [border-bottom:1px_solid_var(--border)] [padding:0_16px]"}>
          <div className={"[display:flex] [min-width:0] [align-items:center] [gap:10px]"}>
            <SkeletonBlock className={"[width:34px] [height:34px] [border-radius:12px]"} />
            <div className={"[display:grid] [gap:7px]"}>
              <SkeletonBlock className={"[width:140px] [height:15px] [border-radius:5px]"} />
              <SkeletonBlock className={"[width:92px] [height:11px] [border-radius:5px]"} />
            </div>
          </div>
          <div className={"[display:flex] [gap:8px]"}>
            <SkeletonBlock className={"[width:32px] [height:32px] [border-radius:10px]"} />
            <SkeletonBlock className={"[width:32px] [height:32px] [border-radius:10px]"} />
          </div>
        </header>

        <div className={"[display:flex] [min-height:0] [flex-direction:column] [gap:18px] [overflow:hidden] [padding:24px_22px]"}>
          {messageRows.map((row, index) => (
            <div key={index} className={`[display:grid] [gap:8px] ${row.align === "end" ? "[justify-items:end]" : "[justify-items:start]"}`}>
              <SkeletonBlock className={"[width:104px] [height:12px] [border-radius:5px]"} />
              <SkeletonBlock className={"[height:64px] [border-radius:14px]"} style={{ width: row.width }} />
            </div>
          ))}
        </div>

        <div className={"[border-top:1px_solid_var(--border)] [padding:12px_16px_16px]"}>
          <SkeletonBlock className={"[width:100%] [height:72px] [border-radius:16px]"} />
        </div>
      </main>
    </div>
  );
}

function SkeletonBlock(props: { className: string; style?: CSSProperties }) {
  return (
    <span
      className={`app-skeleton [display:block] [overflow:hidden] [background:#0000000a] ${props.className}`}
      style={props.style}
      aria-hidden
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function loadConversationSidebarWidth() {
  if (typeof window === "undefined") return DEFAULT_CONVERSATION_SIDEBAR_WIDTH;
  const stored = Number(window.localStorage.getItem(CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_CONVERSATION_SIDEBAR_WIDTH;
  const navWidth = window.matchMedia("(max-width: 1080px)").matches ? COMPACT_NAV_WIDTH : DESKTOP_NAV_WIDTH;
  const maxWidth = Math.max(
    MIN_CONVERSATION_SIDEBAR_WIDTH,
    window.innerWidth - navWidth - SPLITTER_WIDTH - MIN_CHAT_PANE_WIDTH,
  );
  return clamp(stored, MIN_CONVERSATION_SIDEBAR_WIDTH, maxWidth);
}

function saveConversationSidebarWidth(width: number) {
  window.localStorage.setItem(CONVERSATION_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
}

function visibleActiveRuns(runs: AgentRun[], messagesById: Map<string, Message>) {
  return runs.filter((run) => {
    if (run.status !== "accepted" && run.status !== "running") return false;
    if (!run.assistantMessageId) return true;
    const assistantMessage = messagesById.get(run.assistantMessageId);
    if (!assistantMessage) return true;
    return assistantMessage.status === "pending" || assistantMessage.status === "streaming";
  });
}

function formatMessagesForComposer(messages: Message[], mode: "quote" | "summary" | "send-to-app" | "send-to-agent") {
  const lines = messages
    .filter((message) => message.status !== "deleted" && message.status !== "recalled")
    .map((message) => {
      const sender = messageSenderLabel(message);
      return `> ${sender}: ${message.content.trim() || attachmentLabel()}`;
    });
  const content = `${lines.join("\n")}\n`;
  if (mode === "summary") return t("app.summaryComposerPrompt", { content });
  if (mode === "send-to-app") return t("app.sendToAppPrompt", { content });
  if (mode === "send-to-agent") return t("app.sendToAgentPrompt", { content });
  return `${lines.join("\n")}\n\n`;
}

function formatMessagesForAgentForward(
  messages: Message[],
  blocks: AppState["messageBlocks"],
  artifacts: AppState["artifacts"],
  participants: Participant[],
  identities: Identity[],
  userDisplayName: string,
) {
  const sections = messages
    .filter((message) => message.status !== "deleted" && message.status !== "recalled")
    .map((message) => {
      const rawContent = message.content.trim();
      const body = rawContent ? formatMessageBodyForAgentForward(rawContent, message.mentions ?? []) : "";
      const messageArtifacts = collectImageFileArtifactsForMessages([message], blocks, artifacts);
      const attachmentLines = messageArtifacts.map(formatArtifactForAgentForward).filter(Boolean);
      const parts = [body, ...attachmentLines].filter(Boolean);
      return {
        senderKey: message.role === "user"
          ? "user"
          : message.senderParticipantId ?? `${message.role}:${message.senderName ?? ""}`,
        senderLabel: messageSenderLabel(message, participants, identities, userDisplayName),
        content: parts.length ? parts.join(" ") : attachmentLabel(),
      };
    });
  return groupAgentForwardSections(sections);
}

function formatArtifactForAgentForward(artifact: AppState["artifacts"][number]) {
  const href = resolveArtifactAgentDraftHref(artifact);
  if (!href) return "";
  const label = escapeMarkdownLabel(artifact.filename);
  return `[${label}](${href})`;
}

function escapeMarkdownLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function formatSummarySourcePreview(messages: Message[]) {
  const firstContent = messages[0]?.content.replace(/\s+/g, " ").trim().slice(0, 120) || attachmentLabel();
  if (messages.length <= 1) return firstContent;
  return t("messageActions.quotePreview", { count: messages.length, preview: firstContent });
}

function formatSummaryRequest(messages: Message[], blocks: AppState["messageBlocks"], artifacts: AppState["artifacts"]) {
  const lines = messages.map((message) => {
    const sender = messageSenderLabel(message);
    return `- ${sender}: ${message.content.trim() || attachmentLabel()}`;
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
    ? `\n${t("app.attachmentsHeader")}\n${messageArtifacts.map((artifact) => `- ${artifact.filename} (${artifact.mimeType}) ${artifact.textPreview ? t("app.attachmentPreview", { preview: artifact.textPreview.slice(0, 500) }) : ""}`).join("\n")}`
    : "";

  return [
    messages.length > 1
      ? t("app.summaryPromptMulti", { count: messages.length })
      : t("app.summaryPromptSingle"),
    t("app.summaryPromptFooter"),
    "",
    t("app.summaryPromptHeader"),
    ...lines,
    attachmentText,
  ].join("\n");
}

function nextDefaultRoomTitle(rooms: Room[]) {
  let maxNumber = 0;
  for (const room of rooms) {
    const match = room.title.match(/(?:AI 讨论室|AI Room)\s*(\d+)/);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
  }
  return t("app.defaultRoomTitle", { number: maxNumber + 1 });
}
