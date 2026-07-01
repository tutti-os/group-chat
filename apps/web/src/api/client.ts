import type {
  AddParticipantRequest,
  AppReferenceListRequest,
  AppReferenceListResponse,
  Artifact,
  ChatSnapshot,
  CollaborationRuleEvent,
  ConversationMessagesPage,
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

export interface UploadArtifactFileInput {
  file: File;
  filename?: string;
  mimeType?: string;
}

export interface RemoteUserProfile {
  displayName: string;
  avatarPreset: string;
  customAvatarUrl: string | null;
  bio: string;
}

export interface LocalUserProfileResponse {
  profile: RemoteUserProfile | null;
}

export async function fetchSnapshot(messageLimit?: number): Promise<ChatSnapshot> {
  const params = new URLSearchParams();
  if (messageLimit && messageLimit > 0) params.set("messageLimit", String(messageLimit));
  const query = params.toString();
  return fetchJson(`/api/bootstrap${query ? `?${query}` : ""}`);
}

export async function fetchUserProfile(): Promise<LocalUserProfileResponse> {
  return fetchJson("/api/user-profile");
}

export async function saveUserProfileRemote(profile: RemoteUserProfile) {
  return fetchJson<{ profile: RemoteUserProfile }>("/api/user-profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
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

export async function fetchConversationMessages(
  conversationId: string,
  input: { limit?: number; cursor?: string | null } = {},
): Promise<ConversationMessagesPage> {
  const params = new URLSearchParams();
  if (input.limit && input.limit > 0) params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  const query = params.toString();
  return fetchJson(`/api/conversations/${conversationId}/messages${query ? `?${query}` : ""}`);
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

export type MessageDeepLinkResponse =
  | { outcome: "ok"; conversationId: string; messageId: string }
  | { outcome: "message_unavailable"; conversationId: string }
  | { outcome: "room_deleted" }
  | { outcome: "not_found" };

export async function fetchMessageDeepLink(
  messageId: string,
  conversationId?: string | null,
): Promise<MessageDeepLinkResponse> {
  const params = new URLSearchParams();
  if (conversationId?.trim()) {
    params.set("conversationId", conversationId.trim());
  }
  const query = params.toString();
  return fetchJson(`/api/messages/${messageId}/deep-link${query ? `?${query}` : ""}`);
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
  input: UploadArtifactRequest | UploadArtifactFileInput,
): Promise<UploadArtifactResponse> {
  if ("file" in input) {
    const filename = input.filename?.trim() || input.file.name || "upload.bin";
    const file =
      input.mimeType && input.mimeType !== input.file.type
        ? new File([input.file], filename, { type: input.mimeType })
        : input.file;
    const body = new FormData();
    body.append("file", file, filename);
    return fetchJson(`/api/conversations/${conversationId}/artifacts`, {
      method: "POST",
      body,
    });
  }

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

export async function openLocalFileInSystem(path: string) {
  return fetchJson<{ ok: true }>("/api/local-files/open", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function copyArtifactImageToSystemClipboard(artifactId: string, body?: { text?: string }) {
  return fetchJson<{ ok: true }>(`/api/artifacts/${artifactId}/copy-image`, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function listAppReferences(body: AppReferenceListRequest): Promise<AppReferenceListResponse> {
  return fetchJson<AppReferenceListResponse>("/tutti/references/list", {
    method: "POST",
    body: JSON.stringify(body),
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
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body && !isFormDataBody && !headers.has("Content-Type")) {
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
