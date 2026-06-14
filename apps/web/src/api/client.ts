import type {
  AddParticipantRequest,
  Artifact,
  ChatSnapshot,
  CollaborationRuleEvent,
  CreateIdentityRequest,
  CreateRoomRequest,
  LocalAgentProviderStatusResponse,
  Message,
  MessageBlock,
  Participant,
  ParticipantListenMode,
  PrivateTaskRequest,
  SendMessageRequest,
  UpdateConversationPolicyRequest,
  UpdateConversationPinRequest,
  UpdateConversationRulesRequest,
  UpdateIdentityRequest,
  HideMessageResponse,
  UpdateMessageRequest,
  UpdateParticipantRequest,
  UpdateRoomRequest,
  UploadArtifactRequest,
  UploadArtifactResponse,
} from "@group-chat/shared";

export interface SendMessageResponse {
  message: Message;
  blocks?: MessageBlock[];
  artifacts?: Artifact[];
  targets?: Participant[];
}

export async function fetchSnapshot(): Promise<ChatSnapshot> {
  return fetchJson("/api/bootstrap");
}

export async function fetchLocalAgentProviders(): Promise<LocalAgentProviderStatusResponse> {
  return fetchJson("/api/local-agent/providers");
}

export async function createRoom(input: CreateRoomRequest) {
  return fetchJson("/api/rooms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteRoom(roomId: string) {
  return fetchJson(`/api/rooms/${roomId}`, {
    method: "DELETE",
  });
}

export async function updateRoom(roomId: string, input: UpdateRoomRequest) {
  return fetchJson(`/api/rooms/${roomId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function sendMessage(conversationId: string, input: SendMessageRequest): Promise<SendMessageResponse> {
  return fetchJson(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMessage(messageId: string, input: UpdateMessageRequest): Promise<SendMessageResponse> {
  return fetchJson(`/api/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteMessage(messageId: string): Promise<HideMessageResponse> {
  return fetchJson(`/api/messages/${messageId}`, {
    method: "DELETE",
  });
}

export async function cancelRun(runId: string) {
  return fetchJson(`/api/runs/${runId}/cancel`, {
    method: "POST",
  });
}

export async function startPrivateTask(conversationId: string, input: PrivateTaskRequest) {
  return fetchJson<{ taskId: string }>(`/api/conversations/${conversationId}/private-tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function cancelPrivateTask(taskId: string) {
  return fetchJson<{ taskId: string; cancelled: boolean }>(`/api/private-tasks/${taskId}/cancel`, {
    method: "POST",
  });
}

export async function getPrivateTask(taskId: string) {
  return fetchJson<{ task: import("@group-chat/shared").PrivateTaskSnapshot }>(`/api/private-tasks/${taskId}`);
}

export async function listPrivateTasks(conversationId: string) {
  return fetchJson<{ tasks: import("@group-chat/shared").PrivateTaskSnapshot[] }>(
    `/api/conversations/${conversationId}/private-tasks`,
  );
}

export async function updateConversationRules(conversationId: string, input: UpdateConversationRulesRequest) {
  return fetchJson(`/api/conversations/${conversationId}/rules`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function fetchConversationRuleHistory(conversationId: string) {
  return fetchJson<{ events: CollaborationRuleEvent[] }>(`/api/conversations/${conversationId}/rules/history`);
}

export async function updateConversationPolicy(conversationId: string, input: UpdateConversationPolicyRequest) {
  return fetchJson(`/api/conversations/${conversationId}/policy`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function updateConversationPin(conversationId: string, input: UpdateConversationPinRequest) {
  return fetchJson<{ conversation: import("@group-chat/shared").Conversation }>(`/api/conversations/${conversationId}/pin`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function createIdentity(input: CreateIdentityRequest) {
  return fetchJson("/api/identities", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateIdentity(identityId: string, input: UpdateIdentityRequest) {
  return fetchJson(`/api/identities/${identityId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteIdentity(identityId: string) {
  return fetchJson(`/api/identities/${identityId}`, {
    method: "DELETE",
  });
}

export async function addParticipant(conversationId: string, input: AddParticipantRequest) {
  return fetchJson(`/api/conversations/${conversationId}/participants`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteParticipant(participantId: string) {
  return fetchJson(`/api/participants/${participantId}`, {
    method: "DELETE",
  });
}

export async function updateParticipant(participantId: string, input: UpdateParticipantRequest) {
  return fetchJson(`/api/participants/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function uploadArtifact(
  conversationId: string,
  input: UploadArtifactRequest,
): Promise<UploadArtifactResponse> {
  return fetchJson(`/api/conversations/${conversationId}/artifacts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function openArtifactInSystem(artifactId: string) {
  return fetchJson<{ ok: true }>(`/api/artifacts/${artifactId}/open`, {
    method: "POST",
  });
}

export async function setParticipantMuted(participantId: string, muted: boolean) {
  return fetchJson(`/api/participants/${participantId}/mute`, {
    method: "PATCH",
    body: JSON.stringify({ muted }),
  });
}

export async function setParticipantListenMode(participantId: string, listenMode: ParticipantListenMode) {
  return fetchJson(`/api/participants/${participantId}/listen-mode`, {
    method: "PATCH",
    body: JSON.stringify({ listenMode }),
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}
