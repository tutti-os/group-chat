import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDefaultLocalAgentProviderPlugins,
  createLocalAgentRuntime,
  type AgentEvent,
  type AgentRunMessage,
  type LocalAgentMcpServerConfig,
  type LocalAgentProviderPlugin,
  type RawAgentEvent,
  type RawAgentStream,
} from "@tutti-os/agent-acp-kit";
import type { LocalAgentProviderStatus } from "@group-chat/shared";
import { isMentionAllTrigger } from "@group-chat/shared";
import { buildEffectiveRoleDescription } from "../domains/agent-instructions.js";
import { participantWorkspaceRoot } from "../local/paths.js";
import { enrichLocalAgentProviderStatus } from "./local-agent-config-catalog.js";
import { acpPromptFromLocalAgentInput } from "./local-agent-acp.js";
import { buildLocalAgentInput, decodeLocalAgentStdout, localToolBaseUrl } from "./local-agent-protocol.js";
import type { RuntimeProvider, RuntimeReplyContext, RuntimeStreamEvent } from "./runtime-provider.js";
import { RuntimeProviderUnsupportedError } from "./runtime-provider.js";

const DEFAULT_TIMEOUT_MS = 120_000;
type GroupChatLocalAgentProviderPlugin = LocalAgentProviderPlugin<"local-agent", string>;

type TuttiAgentProviderStatus = {
  provider: string;
  availability?: {
    status?: string;
    reasonCode?: string | null;
  };
  cli?: {
    binaryPath?: string | null;
    version?: string | null;
  };
  adapter?: {
    binaryPath?: string | null;
  };
  auth?: {
    status?: string;
  };
};

type TuttiAgentProviderStatusListResponse = {
  providers?: TuttiAgentProviderStatus[];
};

export class LocalAgentRuntimeProvider implements RuntimeProvider {
  id = "local-agent";
  private readonly processes = new Map<string, { cancel: () => Promise<void> | void }>();
  private readonly localAgentRuntime = createLocalAgentRuntime<"local-agent", string>({
    providers: createGroupChatLocalAgentProviderPlugins(),
  });

  canHandle(runtimeProfile: RuntimeReplyContext["runtimeProfile"]) {
    return runtimeProfile?.kind === "local-agent";
  }

  describeRun(context: RuntimeReplyContext) {
    return {
      runtime: context.runtimeProfile?.kind ?? "local-agent",
      provider: context.runtimeProfile?.provider ?? "local-agent",
      model: context.runtimeProfile?.model ?? context.participant.runtimeProfileId ?? "local-agent:unknown",
    };
  }

  async detect(context: RuntimeReplyContext) {
    const command = resolveLocalAgentCommand(context);
    if (command) {
      return { available: true };
    }
    const provider = context.runtimeProfile?.provider;
    if (!provider) {
      return {
        available: false,
        reason: "local-agent provider is not configured.",
      };
    }
    const registered = this.localAgentRuntime.listProviders().some((item) => item.id === provider);
    if (!registered) {
      return {
        available: false,
        reason: `local-agent provider is not registered in @tutti-os/agent-acp-kit: ${provider}`,
      };
    }
    const detection = (await this.localAgentRuntime.detect()).find((item) => item.provider === provider);
    if (!detection) return { available: true };
    if (detection.result?.supported === false) {
      return {
        available: false,
        reason: detection.result.unsupportedReason ?? `${provider} local agent is not supported on this machine.`,
      };
    }
    if (detection.result === null) {
      return {
        available: false,
        reason: `${provider} local agent is not installed or not discoverable.`,
      };
    }
    return { available: true };
  }

  async listLocalAgentProviders(): Promise<LocalAgentProviderStatus[]> {
    const detections = await this.localAgentRuntime.detect();
    const kitStatuses = detections.map(({ provider, displayName, result }) => {
      const available = Boolean(result && result.supported !== false);
      const status: LocalAgentProviderStatus = {
        provider,
        displayName,
        available,
        authState: result?.authState ?? "unknown",
        executablePath: result?.executablePath ?? "",
        version: result?.version ?? "not-installed",
        configDir: result?.configDir,
        models: (result?.models ?? []).map((model) => ({
          id: model.id,
          label: model.label,
          ...("description" in model && typeof model.description === "string"
            ? { description: model.description }
            : {}),
          ...("supportedReasoningEfforts" in model && Array.isArray(model.supportedReasoningEfforts)
            ? { supportedReasoningEfforts: model.supportedReasoningEfforts }
            : {}),
        })),
        reason: available ? undefined : localAgentUnavailableReason(displayName, result),
      };
      return enrichLocalAgentProviderStatus(status);
    });
    return mergeTuttiAgentProviderStatuses(await queryTuttiAgentProviderStatuses(), kitStatuses);
  }

  async *streamReply(context: RuntimeReplyContext) {
    const command = resolveLocalAgentCommand(context);
    if (command) {
      yield* this.streamCommandBridge(context, command);
      return;
    }

    const provider = context.runtimeProfile?.provider ?? "local-agent";
    yield* this.streamKitBridge(context, provider);
  }

  async cancel(runId: string) {
    const process = this.processes.get(runId);
    if (!process) return { cancelled: false, reason: "local-agent process is not running" };
    await process.cancel();
    this.processes.delete(runId);
    return { cancelled: true };
  }

  private async *streamCommandBridge(context: RuntimeReplyContext, command: string) {
    if (!command) {
      const provider = context.runtimeProfile?.provider ?? "local-agent";
      const model = context.runtimeProfile?.model ?? context.participant.runtimeProfileId ?? "unknown";
      throw new RuntimeProviderUnsupportedError(
        `${provider} runtime (${model}) is registered but no local command is configured.`,
      );
    }

    const workspaceRoot = participantWorkspaceRoot(context.conversation.roomId, context.participant.id);
    const child = spawn(command, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        GROUP_CHAT_WORKSPACE: workspaceRoot,
        GROUP_CHAT_RUN_ID: context.runId ?? "",
        GROUP_CHAT_PARTICIPANT_ID: context.participant.id,
        GROUP_CHAT_CONVERSATION_ID: context.conversation.id,
        GROUP_CHAT_TOOL_BASE_URL: localToolBaseUrl(),
      },
      shell: true,
      stdio: "pipe",
    });
    if (context.runId) {
      this.processes.set(context.runId, {
        cancel: () => {
          child.kill("SIGTERM");
        },
      });
    }

    const stderrChunks: string[] = [];
    const timeout = setTimeout(() => child.kill("SIGTERM"), Number(process.env.GROUP_CHAT_LOCAL_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

    try {
      child.stdin.end(JSON.stringify(buildLocalAgentInput(context), null, 2));
      child.stdout.setEncoding("utf8");
      yield* decodeLocalAgentStdout(child.stdout);
      const [code, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
      if (code !== 0) {
        const stderr = stderrChunks.join("").trim();
        if (signal === "SIGTERM" && code === null) {
          throw new Error("Agent 执行超时，已被终止");
        }
        throw new Error(`local-agent command exited with ${code ?? signal ?? "unknown"}${stderr ? `: ${stderr}` : ""}`);
      }
    } finally {
      clearTimeout(timeout);
      if (context.runId) this.processes.delete(context.runId);
    }
  }

  private async *streamKitBridge(context: RuntimeReplyContext, provider: string) {
    const workspaceRoot = participantWorkspaceRoot(context.conversation.roomId, context.participant.id);
    const controller = new AbortController();
    if (context.runId) {
      this.processes.set(context.runId, {
        cancel: async () => {
          controller.abort();
          await this.localAgentRuntime.cancel(context.runId!);
        },
      });
    }

    try {
      const sessionStore = new LocalAgentSessionStore(workspaceRoot);
      const previousSession = sessionStore.read(context.conversation.id);
      const input = buildLocalAgentInput(context);
      const prompt = acpPromptFromLocalAgentInput(input);
      let resume = previousSession?.provider === provider && (previousSession.providerSessionId || previousSession.resumeToken)
        ? {
            mode: "provider" as const,
            ...(previousSession.providerSessionId ? { providerSessionId: previousSession.providerSessionId } : {}),
            ...(previousSession.resumeToken ? { resumeToken: previousSession.resumeToken } : {}),
          }
        : { mode: "fresh" as const };
      let canRetryFresh = resume.mode !== "fresh";
      let emittedNonRetryableEvent = false;
      while (true) {
        try {
          for await (const event of this.localAgentRuntime.run({
            runId: context.runId ?? `${context.conversation.id}:${context.participant.id}`,
            conversationId: context.conversation.id,
            sessionId: context.conversation.id,
            provider,
            runtimeKind: "local-agent",
            runtimeProvider: provider,
            cwd: workspaceRoot,
            prompt,
            systemPrompt: buildKitSystemPrompt(context),
            history: buildKitHistory(context),
            model: stripLocalAgentProviderPrefix(context.runtimeProfile?.model ?? "default", provider),
            reasoning: context.participant.reasoningEffort ?? undefined,
            mcpServers: buildGroupChatMcpServers(context),
            env: {
              GROUP_CHAT_WORKSPACE: workspaceRoot,
              GROUP_CHAT_RUN_ID: context.runId ?? "",
              GROUP_CHAT_PARTICIPANT_ID: context.participant.id,
              GROUP_CHAT_CONVERSATION_ID: context.conversation.id,
              GROUP_CHAT_TOOL_BASE_URL: localToolBaseUrl(),
            },
            timeoutMs: Number(process.env.GROUP_CHAT_LOCAL_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
            extraAllowedDirs: [workspaceRoot],
            resume,
            signal: controller.signal,
          })) {
            const runtimeEvent = toRuntimeStreamEvent(event);
            if (runtimeEvent) {
              if (runtimeEvent.type !== "status" && runtimeEvent.type !== "stderr") {
                emittedNonRetryableEvent = true;
              }
              yield runtimeEvent;
            } else if (event.type === "error") {
              throw new Error(event.message);
            } else if (event.type === "done") {
              if (event.sessionId || event.resumeToken) {
                sessionStore.write(context.conversation.id, {
                  provider,
                  providerSessionId: event.sessionId,
                  resumeToken: event.resumeToken,
                  model: context.runtimeProfile?.model ?? null,
                });
              }
              if (event.status === "failed") {
                throw new Error(`local-agent ${provider} failed${typeof event.exitCode === "number" ? ` with exit code ${event.exitCode}` : ""}`);
              }
            }
          }
          break;
        } catch (error) {
          if (canRetryFresh && !emittedNonRetryableEvent && isRecoverableResumeError(error)) {
            sessionStore.remove(context.conversation.id);
            resume = { mode: "fresh" as const };
            canRetryFresh = false;
            continue;
          }
          throw error;
        }
      }
    } finally {
      if (context.runId) this.processes.delete(context.runId);
    }
  }
}

function toRuntimeStreamEvent(event: AgentEvent): RuntimeStreamEvent | null {
  if (event.type === "text_delta") return { type: "text_delta", text: event.text };
  if (event.type === "thinking" || event.type === "thinking_delta") {
    return { type: "thinking_delta", text: event.text };
  }
  if (event.type === "tool_call") {
    return {
      type: "tool_call",
      id: event.id,
      name: event.name || "unknown_tool",
      input: event.input,
    };
  }
  if (event.type === "tool_result") {
    return {
      type: "tool_result",
      id: event.id,
      name: event.name || "unknown_tool",
      status: event.status,
      output: event.output,
      summary: event.summary,
      error: event.error,
      isError: event.isError,
    };
  }
  if (event.type === "status") {
    return { type: "status", status: event.status ?? event.stage, message: event.message };
  }
  if (event.type === "file_write") return { type: "file_write", path: event.path };
  if (event.type === "stderr") return { type: "stderr", text: event.text };
  return null;
}

function resolveLocalAgentCommand(context: RuntimeReplyContext) {
  const provider = context.runtimeProfile?.provider?.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const providerSpecific = provider ? process.env[`GROUP_CHAT_LOCAL_AGENT_${provider}_COMMAND`] : undefined;
  return providerSpecific || process.env.GROUP_CHAT_LOCAL_AGENT_COMMAND || "";
}

function localAgentUnavailableReason(
  displayName: string,
  result: Awaited<ReturnType<GroupChatLocalAgentProviderPlugin["detect"]>>,
) {
  if (!result) return `${displayName} is not installed or not discoverable.`;
  if (result.supported === false) return result.unsupportedReason ?? `${displayName} is not supported on this machine.`;
  if (result.authState === "missing") return `${displayName} is installed but authentication is missing.`;
  if (result.authState === "expired") return `${displayName} authentication has expired.`;
  return `${displayName} is not available.`;
}

async function queryTuttiAgentProviderStatuses(): Promise<TuttiAgentProviderStatus[] | null> {
  const baseUrl = process.env.TUTTI_API_BASE_URL?.trim();
  const token = process.env.TUTTI_APP_SERVER_TOKEN?.trim();
  if (!baseUrl || !token) return null;

  try {
    const url = new URL("/v1/agent-providers/status", baseUrl);
    url.searchParams.append("providers", "codex");
    url.searchParams.append("providers", "claude-code");
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    const payload = await response.json() as TuttiAgentProviderStatusListResponse;
    return Array.isArray(payload.providers) ? payload.providers : null;
  } catch {
    return null;
  }
}

function mergeTuttiAgentProviderStatuses(
  tuttiStatuses: TuttiAgentProviderStatus[] | null,
  kitStatuses: LocalAgentProviderStatus[],
): LocalAgentProviderStatus[] {
  if (!tuttiStatuses) return kitStatuses;
  const kitStatusByProvider = new Map(kitStatuses.map((status) => [status.provider, status]));
  const merged = new Map<string, LocalAgentProviderStatus>();

  for (const tuttiStatus of tuttiStatuses) {
    const provider = normalizeTuttiAgentProvider(tuttiStatus.provider);
    if (!provider) continue;
    const kitStatus = kitStatusByProvider.get(provider);
    const available = tuttiStatus.availability?.status === "ready";
    const status: LocalAgentProviderStatus = {
      provider,
      displayName: kitStatus?.displayName ?? displayNameForTuttiAgentProvider(provider),
      available,
      authState: authStateFromTuttiAgentProvider(tuttiStatus.auth?.status),
      executablePath: tuttiStatus.cli?.binaryPath ?? tuttiStatus.adapter?.binaryPath ?? kitStatus?.executablePath ?? "",
      version: tuttiStatus.cli?.version ?? kitStatus?.version ?? (available ? "" : "not-installed"),
      configDir: kitStatus?.configDir,
      models: kitStatus?.models ?? [],
      defaultModelId: kitStatus?.defaultModelId,
      defaultReasoningEffort: kitStatus?.defaultReasoningEffort,
      reason: available ? undefined : unavailableReasonFromTuttiAgentProvider(tuttiStatus),
    };
    merged.set(provider, enrichLocalAgentProviderStatus(status));
  }

  for (const kitStatus of kitStatuses) {
    if (!merged.has(kitStatus.provider)) {
      merged.set(kitStatus.provider, kitStatus);
    }
  }

  return [...merged.values()];
}

function normalizeTuttiAgentProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude-code") return "claude";
  if (normalized === "codex") return "codex";
  return "";
}

function displayNameForTuttiAgentProvider(provider: string) {
  if (provider === "claude") return "Claude Code";
  if (provider === "codex") return "Codex CLI";
  return provider;
}

function authStateFromTuttiAgentProvider(status: string | null | undefined): LocalAgentProviderStatus["authState"] {
  if (status === "authenticated") return "ok";
  if (status === "required") return "missing";
  return "unknown";
}

function unavailableReasonFromTuttiAgentProvider(status: TuttiAgentProviderStatus) {
  const displayName = displayNameForTuttiAgentProvider(normalizeTuttiAgentProvider(status.provider));
  switch (status.availability?.status) {
    case "not_installed":
      return `${displayName} is not installed or not discoverable.`;
    case "auth_required":
      return `${displayName} is installed but authentication is missing.`;
    case "unsupported":
      return status.availability.reasonCode ?? `${displayName} is not supported on this machine.`;
    case "unknown":
    default:
      return status.availability?.reasonCode ?? `${displayName} is not available.`;
  }
}

function buildGroupChatMcpServers(context: RuntimeReplyContext): LocalAgentMcpServerConfig[] {
  if (!context.toolAccess?.token) return [];
  return [
    {
      name: "group-chat",
      type: "stdio",
      command: process.execPath,
      args: [resolveLocalAgentHostScript("tools-mcp.mjs")],
      env: {
        GROUP_CHAT_TOOL_BASE_URL: localToolBaseUrl(),
        GROUP_CHAT_TOOL_TOKEN: context.toolAccess.token,
        GROUP_CHAT_PARTICIPANT_ID: context.participant.id,
        GROUP_CHAT_RUN_ID: context.runId ?? "",
        GROUP_CHAT_CONVERSATION_ID: context.conversation.id,
      },
    },
  ];
}

function resolveLocalAgentHostScript(filename: string) {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "..", "local-agent-host", filename);
}

interface StoredLocalAgentSession {
  provider: string;
  providerSessionId?: string;
  resumeToken?: string;
  model: string | null;
  updatedAt: string;
}

class LocalAgentSessionStore {
  constructor(private readonly workspaceRoot: string) {}

  read(conversationId: string): StoredLocalAgentSession | null {
    try {
      const parsed = JSON.parse(readFileSync(this.pathFor(conversationId), "utf8")) as StoredLocalAgentSession;
      return typeof parsed.provider === "string" && parsed.provider ? parsed : null;
    } catch {
      return null;
    }
  }

  write(conversationId: string, session: Omit<StoredLocalAgentSession, "updatedAt">) {
    const filePath = this.pathFor(conversationId);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          ...session,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  remove(conversationId: string) {
    try {
      unlinkSync(this.pathFor(conversationId));
    } catch {
      // A missing session file is already equivalent to a fresh run.
    }
  }

  private pathFor(conversationId: string) {
    return join(this.workspaceRoot, ".group-chat", "local-agent-sessions", `${safePathSegment(conversationId)}.json`);
  }
}

function isRecoverableResumeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /thread\/resume|resume failed|no rollout found|session.*not found|conversation.*not found/i.test(message);
}

function safePathSegment(value: string) {
  return value.replace(/[^\w.-]/g, "_") || "unknown";
}

function buildKitSystemPrompt(context: RuntimeReplyContext) {
  const rules = context.conversation.collaborationRules.trim();
  const roleDescription = buildEffectiveRoleDescription(context.participant, context.identity);
  const mentionAll = isMentionAllTrigger(context.userMessage.mentions);
  return [
    "You are a local agent participant inside an IM group chat.",
    "Read AGENTS.md, IDENTITY.md, SOUL.md, MEMORY.md, and DISTILLED_CONTEXT.md in your workspace before relying on memory.",
    "Reply as the current participant, not as the host application.",
    "Your normal text output is already streamed to the current conversation as your reply.",
    "Do not use tools to send the same reply again. Only use messaging tools for intentional additional side messages.",
    "When the user asks you to create or provide a file, image, video, or other generated asset, create it in the local workspace or save it with the artifact tool, then include the resulting local filesystem path in your normal final text so the user can open it. Do not send an extra group-chat message or attach it to the conversation unless the user explicitly asks you to post it to the group.",
    "If the current message does not need your response, output [NO_REPLY] as your entire output.",
    mentionAll
      ? "The user @mentioned everyone in this group. You must reply with a substantive message in your own voice. Do not output [NO_REPLY]. If you cannot complete the request, briefly explain why in the group."
      : null,
    context.conversation.type === "group" && context.participant.listenMode === "active"
      ? "In active group listen mode, most messages should be ignored with [NO_REPLY] unless they clearly address you, mention all agents, ask for your expertise, or need a substantive contribution. Do not engage in agent-to-agent small talk."
      : null,
    context.conversation.type === "group" && context.participant.listenMode === "passive"
      ? "In passive group listen mode, reply only when directly mentioned or explicitly assigned work; otherwise output [NO_REPLY]."
      : null,
    "Use the group-chat MCP tools for run-scoped room context, artifacts, sending side messages, and saving artifacts.",
    "When you create or update Tutti workspace resources (issues/tasks, apps, or agent sessions), include clickable markdown links in your final reply so the user can open them directly. Use mention:// links, for example [task title](mention://workspace-issue/{issueId}?workspaceId={workspaceId}&topicId={topicId}) or [app name](mention://workspace-app/{appId}?workspaceId={workspaceId}). Read workspaceId and topicId from the current message <mentions> JSON (referenceInsert.scope). Prefer linking the task title instead of only listing a raw Issue ID.",
    rules ? `Collaboration rules version ${context.conversation.collaborationRulesVersion}:\n${rules}` : null,
    roleDescription ? `Role description for this participant in this room:\n${roleDescription}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}

function buildKitHistory(context: RuntimeReplyContext): AgentRunMessage[] {
  return context.recentMessages
    .filter((message) => message.id !== context.userMessage.id)
    .filter((message) => message.status === "success" && message.content.trim())
    .slice(-16)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
      content: formatHistoryMessage(message),
    }));
}

function formatHistoryMessage(message: RuntimeReplyContext["userMessage"]) {
  const sender = message.senderName ?? (message.role === "assistant" ? "Agent" : "User");
  return `[${sender}] ${message.content}`;
}

function stripLocalAgentProviderPrefix(model: string, provider: string) {
  const prefix = `${provider}:`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

function createGroupChatLocalAgentProviderPlugins(): GroupChatLocalAgentProviderPlugin[] {
  return createDefaultLocalAgentProviderPlugins().map((provider) =>
    provider.id === "claude" ? withGroupChatClaudeStreamCompatibility(provider) : provider,
  ) as GroupChatLocalAgentProviderPlugin[];
}

function withGroupChatClaudeStreamCompatibility(
  provider: GroupChatLocalAgentProviderPlugin,
): GroupChatLocalAgentProviderPlugin {
  const baseCreateAdapter = provider.createAdapter;
  if (!baseCreateAdapter) return provider;
  return {
    ...provider,
    createAdapter() {
      const adapter = baseCreateAdapter();
      return {
        ...adapter,
        parseEvents(stream) {
          return adapter.parseEvents(normalizeClaudeRawStreamForGroupChat(stream));
        },
      };
    },
  };
}

async function* normalizeClaudeRawStreamForGroupChat(stream: RawAgentStream): RawAgentStream {
  let emittedAssistantText = false;
  for await (const item of stream) {
    const assistantText = extractClaudeAssistantText(item);
    if (assistantText) {
      emittedAssistantText = true;
      yield* splitClaudeReasoning(assistantText);
      continue;
    }
    const resultText = emittedAssistantText ? undefined : extractClaudeResultText(item);
    if (resultText) {
      emittedAssistantText = true;
      yield* splitClaudeReasoning(resultText);
      continue;
    }
    yield item;
  }
}

function extractClaudeAssistantText(item: RawAgentEvent) {
  const record = toRecord(item);
  if (!record || record.type !== "assistant") return undefined;
  if (typeof record.text === "string" && record.text.trim()) return record.text;
  const message = toRecord(record.message);
  const content = message?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((entry) => {
      const block = toRecord(entry);
      return block?.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
  return text.trim() ? text : undefined;
}

function extractClaudeResultText(item: RawAgentEvent) {
  const record = toRecord(item);
  if (!record || record.type !== "result" || record.is_error === true) return undefined;
  return typeof record.result === "string" && record.result.trim() ? record.result : undefined;
}

function splitClaudeReasoning(text: string): RawAgentEvent[] {
  const events: RawAgentEvent[] = [];
  let cleaned = text;
  const reasoningParts: string[] = [];
  cleaned = cleaned.replace(/<reasoning>([\s\S]*?)<\/reasoning>/g, (_match, content: string) => {
    const trimmed = content.trim();
    if (trimmed) reasoningParts.push(trimmed);
    return "";
  });
  if (reasoningParts.length > 0) events.push({ type: "thinking", text: reasoningParts.join("\n") });
  const finalText = cleaned.trim();
  if (finalText) events.push({ type: "assistant", text: finalText });
  return events;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
