import type { Message, Participant, PrivateTaskSnapshot, PrivateTaskType } from "@group-chat/shared";
import { t } from "./i18n/index.js";

export interface BackgroundTask extends PrivateTaskSnapshot {
  panelOpen: boolean;
  sourceMessage: Message | null;
  sourceMessageIds: string[];
  targetParticipant: Participant | null;
}

export interface AgentRunTaskItem {
  id: string;
  type: "agent-run";
  conversationId: string;
  participantName: string;
  status: "running";
  preview: string;
  visibility: "public" | "whisper";
}

export interface PendingAgentReplyTarget {
  key: string;
  conversationId: string;
  participantId: string;
  participantName: string;
  triggerMessageId: string;
  visibility: "public" | "whisper";
}

export function pendingAgentReplyKey(triggerMessageId: string, participantId: string) {
  return `${triggerMessageId}:${participantId}`;
}

export function isPendingAgentRunId(runId: string) {
  return runId.startsWith("pending:");
}

export function createPendingAgentReplyTargets(
  message: Pick<Message, "id" | "conversationId" | "visibility">,
  targets: Participant[],
): PendingAgentReplyTarget[] {
  return targets.map((target) => ({
    key: pendingAgentReplyKey(message.id, target.id),
    conversationId: message.conversationId,
    participantId: target.id,
    participantName: target.displayName,
    triggerMessageId: message.id,
    visibility: message.visibility ?? "public",
  }));
}

export function createOptimisticBackgroundTask(input: {
  id: string;
  type: PrivateTaskType;
  conversationId: string;
  sourceMessages: Message[];
  targetParticipant: Participant;
  sourcePreview: string;
}): BackgroundTask {
  const now = new Date().toISOString();
  const primaryMessage = input.sourceMessages[0]!;
  return {
    id: input.id,
    type: input.type,
    conversationId: input.conversationId,
    sourceMessageId: primaryMessage.id,
    participantId: input.targetParticipant.id,
    participantName: input.targetParticipant.displayName,
    sourcePreview: input.sourcePreview,
    status: "running",
    content: "",
    error: null,
    createdAt: now,
    updatedAt: now,
    panelOpen: false,
    sourceMessage: primaryMessage,
    sourceMessageIds: input.sourceMessages.map((message) => message.id),
    targetParticipant: input.targetParticipant,
  };
}

export function backgroundTaskFromSnapshot(input: {
  snapshot: PrivateTaskSnapshot;
  sourceMessages: Message[];
  targetParticipant: Participant;
}): BackgroundTask {
  const primaryMessage = input.sourceMessages[0] ?? null;
  return {
    ...input.snapshot,
    sourceMessageIds: input.snapshot.sourceMessageIds?.length
      ? input.snapshot.sourceMessageIds
      : input.sourceMessages.map((message) => message.id),
    panelOpen: false,
    sourceMessage: primaryMessage,
    targetParticipant: input.targetParticipant,
  };
}

export function enrichBackgroundTask(
  snapshot: PrivateTaskSnapshot,
  context: { messages: Message[]; participants: Participant[] },
  current?: BackgroundTask | null,
): BackgroundTask {
  const sourceMessageIds = snapshot.sourceMessageIds?.length
    ? snapshot.sourceMessageIds
    : snapshot.sourceMessageId
      ? [snapshot.sourceMessageId]
      : [];
  const sourceMessages = sourceMessageIds
    .map((messageId) => context.messages.find((message) => message.id === messageId) ?? null)
    .filter((message): message is Message => Boolean(message));
  return {
    ...snapshot,
    sourceMessageIds,
    panelOpen: current?.panelOpen ?? false,
    sourceMessage: current?.sourceMessage ?? sourceMessages[0] ?? null,
    targetParticipant:
      current?.targetParticipant
      ?? context.participants.find((participant) => participant.id === snapshot.participantId)
      ?? null,
  };
}

export function mergeBackgroundTasks(
  current: BackgroundTask[],
  snapshots: PrivateTaskSnapshot[],
  context: { messages: Message[]; participants: Participant[] },
) {
  const next = [...current];
  for (const snapshot of snapshots) {
    const index = next.findIndex((task) => task.id === snapshot.id);
    if (index >= 0) {
      next[index] = mergeBackgroundTask(next[index]!, snapshot);
      continue;
    }
    next.push(enrichBackgroundTask(snapshot, context));
  }
  return next;
}

export function mergeBackgroundTask(current: BackgroundTask, snapshot: PrivateTaskSnapshot): BackgroundTask {
  const sourceMessageIds = snapshot.sourceMessageIds?.length
    ? snapshot.sourceMessageIds
    : snapshot.sourceMessageId
      ? [snapshot.sourceMessageId]
      : current.sourceMessageIds;
  return {
    ...current,
    ...snapshot,
    sourceMessageIds,
    panelOpen: current.panelOpen,
    sourceMessage: current.sourceMessage,
    targetParticipant: current.targetParticipant,
  };
}

export function backgroundTaskLabel(task: BackgroundTask) {
  if (task.type === "summary") {
    const countPrefix = task.sourceMessageIds.length > 1
      ? t("task.summaryCountPrefix", { count: task.sourceMessageIds.length })
      : "";
    return t("task.summaryLabel", { countPrefix, name: task.participantName });
  }
  return t("task.agentLabel", { name: task.participantName });
}

export function backgroundTaskStatusLabel(task: BackgroundTask) {
  if (task.status === "running") return t("task.statusRunning");
  if (task.status === "completed") return t("task.statusCompleted");
  if (task.status === "failed") return t("task.statusFailed");
  return t("task.statusCancelled");
}

const DISMISSED_TASK_IDS_KEY = "group-chat:dismissed-private-task-ids";

export function loadDismissedBackgroundTaskIds() {
  try {
    const raw = localStorage.getItem(DISMISSED_TASK_IDS_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function saveDismissedBackgroundTaskIds(ids: Set<string>) {
  localStorage.setItem(DISMISSED_TASK_IDS_KEY, JSON.stringify([...ids]));
}

const LOCAL_TASK_BAR_TASK_IDS_KEY = "group-chat:local-task-bar-task-ids";

export function loadLocalTaskBarTaskIds() {
  try {
    const raw = sessionStorage.getItem(LOCAL_TASK_BAR_TASK_IDS_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function saveLocalTaskBarTaskIds(ids: Set<string>) {
  sessionStorage.setItem(LOCAL_TASK_BAR_TASK_IDS_KEY, JSON.stringify([...ids]));
}

export function addLocalTaskBarTaskId(taskId: string) {
  const ids = loadLocalTaskBarTaskIds();
  ids.add(taskId);
  saveLocalTaskBarTaskIds(ids);
}

export function removeLocalTaskBarTaskId(taskId: string) {
  const ids = loadLocalTaskBarTaskIds();
  ids.delete(taskId);
  saveLocalTaskBarTaskIds(ids);
}

export function isLocalTaskBarTask(taskId: string) {
  return loadLocalTaskBarTaskIds().has(taskId);
}
