import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import type {
  AddParticipantRequest,
  CreateIdentityRequest,
  CreateRoomRequest,
  ParticipantListenMode,
  PrivateTaskRequest,
  SendMessageRequest,
  UpdateConversationRulesRequest,
  UpdateConversationPolicyRequest,
  UpdateConversationPinRequest,
  UpdateIdentityRequest,
  UpdateMessageRequest,
  UpdateParticipantRequest,
  UpdateRoomRequest,
  UploadArtifactRequest,
  WsClientMessage,
  WsServerMessage,
} from "@group-chat/shared";
import { AgentToolGateway } from "./domains/agent-tool-gateway.js";
import { readUserProfile, writeUserProfile, type StoredUserProfile } from "./domains/user-profile-store.js";
import { AgentToolTokenStore, AgentToolUnauthorizedError } from "./domains/agent-tool-tokens.js";
import { ChatRepository } from "./domains/chat-repository.js";
import { ChatService } from "./domains/chat-service.js";
import {
  getArtifactCliOutput,
  getConversationCliOutput,
  isCliError,
  listArtifactsCliOutput,
  listConversationsCliOutput,
  type CliCommandError,
  type CliCommandOutput,
} from "./domains/tutti-cli.js";
import { isReferenceListError, listAppReferences, searchAppReferences } from "./domains/tutti-references.js";
import { EventHub } from "./ws/event-hub.js";

const webDist = process.env.GROUP_CHAT_WEB_DIST
  ? resolve(process.env.GROUP_CHAT_WEB_DIST)
  : resolve(process.cwd(), "../web/dist");
const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "127.0.0.1";
const maxUploadBytes = parsePositiveInteger(process.env.GROUP_CHAT_MAX_UPLOAD_BYTES) ?? 1024 * 1024 * 1024;

const server = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
const events = new EventHub();
const repo = new ChatRepository();
const agentToolTokens = new AgentToolTokenStore();
const chat = new ChatService(repo, events, agentToolTokens);
const agentTools = new AgentToolGateway(repo, events, agentToolTokens);

await server.register(fastifyWebsocket);
await server.register(multipart, {
  throwFileSizeLimit: true,
  limits: {
    files: 1,
    fileSize: maxUploadBytes,
  },
});

if (existsSync(webDist)) {
  await server.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
  });
}

server.get("/api/health", async () => ({
  ok: true,
  app: "group-chat",
}));

server.get("/api/bootstrap", async () => chat.bootstrap());

server.get("/api/user-profile", async () => ({
  profile: readUserProfile(),
}));

server.put<{ Body: Partial<StoredUserProfile> }>("/api/user-profile", async (request, reply) => {
  const body = request.body ?? {};
  if (typeof body.displayName !== "string" || !body.displayName.trim()) {
    return reply.code(400).send({ error: "displayName is required" });
  }
  const profile = writeUserProfile({
    displayName: body.displayName,
    avatarPreset: typeof body.avatarPreset === "string" ? body.avatarPreset : "saiyan-01",
    customAvatarUrl: typeof body.customAvatarUrl === "string" ? body.customAvatarUrl : null,
    bio: typeof body.bio === "string" ? body.bio : "",
  });
  return { profile };
});

server.get("/api/local-agent/providers", async () => chat.listLocalAgentProviders());

server.post<{ Body: unknown }>("/tutti/cli/conversations/list", async (request, reply) =>
  sendCliOutput(reply, listConversationsCliOutput(chat.bootstrap(), normalizeCliEnvelope(request.body))),
);

server.post<{ Body: unknown }>("/tutti/cli/conversations/get", async (request, reply) =>
  sendCliOutput(reply, getConversationCliOutput(chat.bootstrap(), normalizeCliEnvelope(request.body))),
);

server.post<{ Body: unknown }>("/tutti/cli/artifacts/list", async (request, reply) =>
  sendCliOutput(reply, listArtifactsCliOutput(chat.bootstrap(), normalizeCliEnvelope(request.body))),
);

server.post<{ Body: unknown }>("/tutti/cli/artifacts/get", async (request, reply) =>
  sendCliOutput(reply, getArtifactCliOutput(chat.bootstrap(), normalizeCliEnvelope(request.body))),
);

server.post<{ Body: unknown }>("/tutti/references/list", async (request, reply) => {
  const output = listAppReferences(chat.bootstrap(), request.body ?? {});
  if (isReferenceListError(output)) return reply.code(400).send(output);
  return output;
});

server.post<{ Body: unknown }>("/tutti/references/search", async (request, reply) => {
  const output = searchAppReferences(chat.bootstrap(), request.body ?? {});
  if (isReferenceListError(output)) return reply.code(400).send(output);
  return output;
});

server.post<{ Body: CreateRoomRequest }>("/api/rooms", async (request) => chat.createRoom(request.body ?? {}));

server.patch<{ Params: { roomId: string }; Body: UpdateRoomRequest }>("/api/rooms/:roomId", async (request, reply) => {
  const bundle = chat.updateRoom(request.params.roomId, request.body ?? {});
  if (!bundle) return reply.code(404).send({ error: "Room not found" });
  return bundle;
});

server.delete<{ Params: { roomId: string } }>("/api/rooms/:roomId", async (request, reply) => {
  const room = chat.deleteRoom(request.params.roomId);
  if (!room) return reply.code(404).send({ error: "Room not found" });
  return { room };
});

server.post<{ Body: CreateIdentityRequest }>("/api/identities", async (request) => {
  const identity = chat.createIdentity(request.body);
  return { identity, runtimeProfile: chat.getRuntimeProfile(identity.defaultRuntimeProfileId) };
});

server.patch<{ Params: { identityId: string }; Body: UpdateIdentityRequest }>(
  "/api/identities/:identityId",
  async (request) => {
    const identity = chat.updateIdentity(request.params.identityId, request.body);
    return { identity, runtimeProfile: chat.getRuntimeProfile(identity?.defaultRuntimeProfileId) };
  },
);

server.delete<{ Params: { identityId: string } }>("/api/identities/:identityId", async (request, reply) => {
  try {
    return { identity: await chat.deleteIdentity(request.params.identityId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete team member";
    return reply.code(400).send({ error: message });
  }
});

server.post<{ Params: { conversationId: string }; Body: UploadArtifactRequest }>(
  "/api/conversations/:conversationId/artifacts",
  async (request, reply) => {
    if (!request.isMultipart()) {
      return {
        artifact: chat.uploadArtifact(request.params.conversationId, request.body),
      };
    }

    let target: { filename: string; localPath: string } | null = null;
    try {
      const upload = await request.file({
        limits: {
          files: 1,
          fileSize: maxUploadBytes,
        },
      });
      if (!upload) return reply.code(400).send({ error: "File is required" });

      target = chat.prepareArtifactUpload(request.params.conversationId, upload.filename || "upload.bin");
      await pipeline(upload.file, createWriteStream(target.localPath));
      if (upload.file.truncated) {
        await unlink(target.localPath).catch(() => undefined);
        return reply.code(413).send({ error: `File exceeds ${maxUploadBytes} bytes` });
      }

      return {
        artifact: chat.uploadArtifactFromFile(request.params.conversationId, {
          filename: target.filename,
          mimeType: upload.mimetype || "application/octet-stream",
          localPath: target.localPath,
        }),
      };
    } catch (error) {
      if (target) await unlink(target.localPath).catch(() => undefined);
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(413).send({ error: `File exceeds ${maxUploadBytes} bytes` });
      }
      throw error;
    }
  },
);

server.post<{ Params: { conversationId: string }; Body: PrivateTaskRequest }>(
  "/api/conversations/:conversationId/private-tasks",
  async (request, reply) => {
    try {
      return chat.runPrivateTask(request.params.conversationId, request.body ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start private task";
      return reply.code(400).send({ error: message });
    }
  },
);

server.post<{ Params: { taskId: string } }>("/api/private-tasks/:taskId/cancel", async (request) =>
  chat.cancelPrivateTask(request.params.taskId),
);

server.get<{ Params: { taskId: string } }>("/api/private-tasks/:taskId", async (request, reply) => {
  const task = chat.getPrivateTask(request.params.taskId);
  if (!task) return reply.code(404).send({ error: "Private task not found" });
  return { task };
});

server.get<{ Params: { conversationId: string } }>(
  "/api/conversations/:conversationId/private-tasks",
  async (request) => ({
    tasks: chat.listPrivateTasksForConversation(request.params.conversationId),
  }),
);

server.post<{ Params: { conversationId: string }; Body: SendMessageRequest }>(
  "/api/conversations/:conversationId/messages",
  async (request) => chat.sendMessage(request.params.conversationId, request.body),
);

server.patch<{ Params: { messageId: string }; Body: UpdateMessageRequest }>(
  "/api/messages/:messageId",
  async (request, reply) => {
    try {
      const result = await chat.updateMessage(request.params.messageId, request.body);
      if (!result) return reply.code(404).send({ error: "Message not found" });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update message";
      return reply.code(400).send({ error: message });
    }
  },
);

server.delete<{ Params: { messageId: string } }>("/api/messages/:messageId", async (request, reply) => {
  try {
    const result = chat.hideMessageForLocalUser(request.params.messageId);
    if (!result) return reply.code(404).send({ error: "Message not found" });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete message";
    return reply.code(400).send({ error: message });
  }
});

server.get<{ Params: { messageId: string }; Querystring: { conversationId?: string } }>(
  "/api/messages/:messageId/deep-link",
  async (request) => chat.resolveMessageDeepLink(request.params.messageId, request.query.conversationId ?? null),
);

server.post<{ Params: { runId: string } }>("/api/runs/:runId/cancel", async (request, reply) => {
  const result = await chat.cancelRun(request.params.runId);
  if (!result) return reply.code(404).send({ error: "Run not found" });
  return result;
});

server.patch<{ Params: { conversationId: string }; Body: UpdateConversationRulesRequest }>(
  "/api/conversations/:conversationId/rules",
  async (request, reply) => {
    const result = chat.updateConversationRules(request.params.conversationId, request.body);
    if (!result) return reply.code(404).send({ error: "Conversation not found" });
    return result;
  },
);

server.get<{ Params: { conversationId: string } }>(
  "/api/conversations/:conversationId/rules/history",
  async (request) => ({
    events: chat.listCollaborationRuleEvents(request.params.conversationId),
  }),
);

server.patch<{ Params: { conversationId: string }; Body: UpdateConversationPolicyRequest }>(
  "/api/conversations/:conversationId/policy",
  async (request, reply) => {
    try {
      const conversation = chat.updateConversationPolicy(request.params.conversationId, request.body);
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      return { conversation };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update reply policy";
      return reply.code(400).send({ error: message });
    }
  },
);

server.patch<{ Params: { conversationId: string }; Body: UpdateConversationPinRequest }>(
  "/api/conversations/:conversationId/pin",
  async (request, reply) => {
    const conversation = chat.updateConversationPinned(request.params.conversationId, request.body.pinned);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    return { conversation };
  },
);

server.post<{ Params: { conversationId: string }; Body: AddParticipantRequest }>(
  "/api/conversations/:conversationId/participants",
  async (request) => {
    const result = chat.addParticipant(request.params.conversationId, request.body);
    return { ...result, runtimeProfile: chat.getRuntimeProfile(result.participant.runtimeProfileId) };
  },
);

server.patch<{ Params: { participantId: string }; Body: { muted: boolean } }>(
  "/api/participants/:participantId/mute",
  async (request) => ({
    participant: chat.setParticipantMuted(request.params.participantId, request.body.muted),
  }),
);

server.patch<{ Params: { participantId: string }; Body: { listenMode: ParticipantListenMode } }>(
  "/api/participants/:participantId/listen-mode",
  async (request, reply) => {
    if (!["active", "passive", "adaptive"].includes(request.body.listenMode)) {
      return reply.code(400).send({ error: "Invalid listen mode" });
    }
    const participant = chat.setParticipantListenMode(request.params.participantId, request.body.listenMode);
    if (!participant) return reply.code(404).send({ error: "Participant not found" });
    return { participant };
  },
);

server.patch<{ Params: { participantId: string }; Body: UpdateParticipantRequest }>(
  "/api/participants/:participantId",
  async (request, reply) => {
    try {
      if (request.body.listenMode && !["active", "passive", "adaptive"].includes(request.body.listenMode)) {
        return reply.code(400).send({ error: "Invalid listen mode" });
      }
      const participant = chat.updateParticipant(request.params.participantId, request.body);
      if (!participant) return reply.code(404).send({ error: "Participant not found" });
      return { participant, runtimeProfile: chat.getRuntimeProfile(participant.runtimeProfileId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update participant";
      return reply.code(message.includes("not found") ? 404 : 400).send({ error: message });
    }
  },
);

server.delete<{ Params: { participantId: string } }>("/api/participants/:participantId", async (request, reply) => {
  const participant = await chat.removeParticipant(request.params.participantId);
  if (!participant) return reply.code(404).send({ error: "Participant not found" });
  return { participant };
});

server.get<{ Params: { participantId: string } }>(
  "/api/agent-tools/participants/:participantId/context",
  async (request, reply) => {
    try {
      return agentTools.getContext(request.params.participantId, readAgentToolCredential(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read agent context";
      if (error instanceof AgentToolUnauthorizedError) return reply.code(401).send({ error: message });
      return reply.code(message.includes("not found") ? 404 : 400).send({ error: message });
    }
  },
);

server.get<{ Params: { participantId: string; artifactId: string } }>(
  "/api/agent-tools/participants/:participantId/artifacts/:artifactId",
  async (request, reply) => {
    try {
      return agentTools.getArtifact(request.params.participantId, request.params.artifactId, readAgentToolCredential(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read artifact";
      if (error instanceof AgentToolUnauthorizedError) return reply.code(401).send({ error: message });
      return reply.code(message.includes("not found") ? 404 : 400).send({ error: message });
    }
  },
);

server.post<{ Params: { participantId: string }; Body: { content: string } }>(
  "/api/agent-tools/participants/:participantId/messages",
  async (request, reply) => {
    try {
      return agentTools.sendMessage(request.params.participantId, request.body, readAgentToolCredential(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send agent message";
      if (error instanceof AgentToolUnauthorizedError) return reply.code(401).send({ error: message });
      return reply.code(400).send({ error: message });
    }
  },
);

server.post<{ Params: { participantId: string }; Body: UploadArtifactRequest & { messageId?: string | null; runId?: string | null } }>(
  "/api/agent-tools/participants/:participantId/artifacts",
  async (request, reply) => {
    try {
      return agentTools.saveArtifact(request.params.participantId, request.body, readAgentToolCredential(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save agent artifact";
      if (error instanceof AgentToolUnauthorizedError) return reply.code(401).send({ error: message });
      return reply.code(400).send({ error: message });
    }
  },
);

server.get<{ Params: { artifactId: string } }>("/local-assets/:artifactId", async (request, reply) => {
  const artifact = repo.getArtifact(request.params.artifactId);
  if (!artifact) return reply.code(404).send({ error: "Artifact not found" });
  reply.header("Content-Type", artifact.mimeType);
  reply.header("Content-Length", artifact.sizeBytes);
  reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(artifact.filename)}"`);
  return reply.send(createReadStream(artifact.localPath));
});

server.post<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/open", async (request, reply) => {
  const artifact = repo.getArtifact(request.params.artifactId);
  if (!artifact) return reply.code(404).send({ error: "Artifact not found" });
  if (!existsSync(artifact.localPath)) return reply.code(404).send({ error: "Artifact file not found" });
  try {
    openPathWithSystemApp(artifact.localPath);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open artifact";
    return reply.code(500).send({ error: message });
  }
});

server.get("/api/ws", { websocket: true }, (socket) => {
  const dispose = events.addClient(socket);
  const hello: WsServerMessage = { type: "hello", lastSeq: events.lastSeq() };
  socket.send(JSON.stringify(hello));

  socket.on("message", (raw: Buffer) => {
    let message: WsClientMessage | null = null;
    try {
      message = JSON.parse(raw.toString()) as WsClientMessage;
    } catch {
      return;
    }
    if (message.type === "hello" && typeof message.lastSeq === "number") {
      const replay = events.replaySince(message.lastSeq);
      const response: WsServerMessage = {
        type: "replay",
        events: replay,
        lastSeq: replay.at(-1)?.seq ?? events.lastSeq(),
      };
      socket.send(JSON.stringify(response));
    }
  });

  socket.on("close", dispose);
});

server.setNotFoundHandler((request, reply) => {
  if (
    request.raw.url?.startsWith("/api/") ||
    request.raw.url?.startsWith("/tutti/cli/") ||
    request.raw.url?.startsWith("/tutti/references/") ||
    request.raw.url?.startsWith("/nextop/cli/") ||
    request.raw.url?.startsWith("/local-assets/")
  ) {
    return reply.code(404).send({ error: "Not found" });
  }
  const indexPath = join(webDist, "index.html");
  if (existsSync(indexPath)) return reply.sendFile("index.html");
  return reply.type("text/html").send(`
    <html>
      <body style="font-family: system-ui; padding: 32px">
        <h1>group-chat server is running</h1>
        <p>Build the web app or run <code>pnpm dev:web</code> for the Vite client.</p>
      </body>
    </html>
  `);
});

try {
  await server.listen({ port, host });
  chat.warmup();
  server.log.info(`group-chat server listening on http://${host}:${port}`);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}

function readAgentToolCredential(request: { headers: Record<string, string | string[] | undefined>; query?: unknown }) {
  const header = request.headers["x-group-chat-tool-token"];
  const headerToken = Array.isArray(header) ? header[0] : header;
  const query = request.query as { toolToken?: string } | undefined;
  return { token: headerToken ?? query?.toolToken ?? null };
}

function normalizeCliEnvelope(value: unknown) {
  if (value === undefined) return {};
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : { input: null };
}

function parsePositiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sendCliOutput(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  output: CliCommandOutput | CliCommandError,
) {
  if (isCliError(output)) {
    return reply.code(output.error.code === "not_found" ? 404 : 400).send(output);
  }
  return output;
}

function openPathWithSystemApp(path: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => undefined);
  child.unref();
}
