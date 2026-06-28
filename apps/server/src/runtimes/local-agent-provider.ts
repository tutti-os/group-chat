import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
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
import {
  loadTuttiAgentSkillContext,
  resolveTuttiCliCommand,
  type TuttiAgentSkillContext,
} from "@tutti-os/agent-acp-kit/tutti";
import type { LocalAgentProviderModel, LocalAgentProviderSpeedMode, LocalAgentProviderStatus, ReasoningEffort } from "@group-chat/shared";
import { isMentionAllTrigger } from "@group-chat/shared";
import { buildEffectiveRoleDescription } from "../domains/agent-instructions.js";
import { participantWorkspaceRoot } from "../local/paths.js";
import { enrichLocalAgentProviderStatus } from "./local-agent-config-catalog.js";
import { acpPromptFromLocalAgentInput } from "./local-agent-acp.js";
import { isRecoverableResumeError } from "./local-agent-resume-errors.js";
import { buildLocalAgentInput, decodeLocalAgentStdout, localToolBaseUrl, stripGeneratedReplyQuoteMarkers } from "./local-agent-protocol.js";
import type { RuntimeProvider, RuntimeReplyContext, RuntimeStreamEvent } from "./runtime-provider.js";
import { RuntimeProviderUnsupportedError } from "./runtime-provider.js";
import { buildLocalAgentProcessEnv } from "./local-agent-env.js";

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
  models?: unknown;
  reasoningEfforts?: unknown;
  reasoningOptions?: unknown;
  reasoningLevels?: unknown;
  supportedReasoningEfforts?: unknown;
  supportedReasoningLevels?: unknown;
  speedModes?: unknown;
  speedOptions?: unknown;
  speeds?: unknown;
  availableSpeeds?: unknown;
  performanceModes?: unknown;
  modelCatalog?: unknown;
  configuration?: unknown;
  defaults?: unknown;
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
      const resultRecord = toRecord(result);
      const reasoningEfforts = parseReasoningEfforts(
        resultRecord?.reasoningEfforts
        ?? resultRecord?.reasoningOptions
        ?? resultRecord?.reasoningLevels
        ?? resultRecord?.supportedReasoningEfforts
        ?? resultRecord?.supportedReasoningLevels,
      );
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
        ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
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

    let retryWithEnv: Record<string, string> | undefined;
    let canRetryWithoutUserSkills = context.runtimeProfile?.provider === "codex";
    while (true) {
      try {
        yield* this.streamCommandBridgeAttempt(context, command, retryWithEnv);
        return;
      } catch (error) {
        if (
          canRetryWithoutUserSkills
          && isSkillLoadFailure(error)
          && !didLocalAgentCommandEmitOutput(error)
        ) {
          canRetryWithoutUserSkills = false;
          const workspaceRoot = participantWorkspaceRoot(context.conversation.roomId, context.participant.id);
          retryWithEnv = buildIsolatedUserSkillEnv(workspaceRoot);
          yield { type: "thinking_delta" as const, text: `${SKILL_LOAD_FALLBACK_NOTICE}\n` };
          continue;
        }
        throw error;
      }
    }
  }

  private async *streamCommandBridgeAttempt(
    context: RuntimeReplyContext,
    command: string,
    envOverrides?: Record<string, string>,
  ) {
    const workspaceRoot = participantWorkspaceRoot(context.conversation.roomId, context.participant.id);
    const child = spawn(command, {
      cwd: workspaceRoot,
      env: buildLocalAgentRunEnv(context, workspaceRoot, envOverrides),
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
    const timeoutMs = localAgentTimeoutMs();
    let timedOut = false;
    const timeout = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs)
      : undefined;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

    let emittedOutput = false;
    try {
      child.stdin.end(JSON.stringify(buildLocalAgentInput(context), null, 2));
      child.stdout.setEncoding("utf8");
      for await (const event of decodeLocalAgentStdout(child.stdout)) {
        emittedOutput = true;
        yield event;
      }
      const [code, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
      if (code !== 0) {
        const stderr = stderrChunks.join("").trim();
        if (timedOut && signal === "SIGTERM" && code === null) {
          throw new LocalAgentCommandError("Agent 执行超时，已被终止", emittedOutput);
        }
        throw new LocalAgentCommandError(
          `local-agent command exited with ${code ?? signal ?? "unknown"}${stderr ? `: ${stderr}` : ""}`,
          emittedOutput,
        );
      }
    } finally {
      if (timeout) clearTimeout(timeout);
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
      const timeoutMs = localAgentTimeoutMs();
      const runtimeRunId = context.runId ?? `${context.conversation.id}:${context.participant.id}`;
      const skillContext = await loadGroupChatAgentSkillContext({
        provider,
        agentSessionId: runtimeRunId,
        workspaceRoot,
      });
      let resume = !input.turn.intent && previousSession?.provider === provider && (previousSession.providerSessionId || previousSession.resumeToken)
        ? {
            mode: "provider" as const,
            ...(previousSession.providerSessionId ? { providerSessionId: previousSession.providerSessionId } : {}),
            ...(previousSession.resumeToken ? { resumeToken: previousSession.resumeToken } : {}),
          }
        : { mode: "fresh" as const };
      let canRetryFresh = resume.mode !== "fresh";
      let canRetryWithoutUserSkills = provider === "codex";
      let skillFallbackEnv: Record<string, string> | undefined;
      let emittedNonRetryableEvent = false;
      while (true) {
        try {
          for await (const event of this.localAgentRuntime.run({
            runId: runtimeRunId,
            conversationId: context.conversation.id,
            sessionId: context.conversation.id,
            provider,
            runtimeKind: "local-agent",
            runtimeProvider: provider,
            cwd: workspaceRoot,
            prompt,
            systemPrompt: joinPromptParts(skillContext.recommendedSystemPrompt?.content, buildKitSystemPrompt(context)),
            history: buildKitHistory(context),
            model: stripLocalAgentProviderPrefix(context.runtimeProfile?.model ?? "default", provider),
            reasoning: context.participant.reasoningEffort ?? undefined,
            mcpServers: buildGroupChatMcpServers(context),
            skillManifest: skillContext.skillManifest,
            env: buildLocalAgentRunEnv(context, workspaceRoot, skillFallbackEnv),
            metadata: context.participant.speedMode ? { speedMode: context.participant.speedMode } : undefined,
            ...(timeoutMs ? { timeoutMs } : {}),
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
          if (canRetryWithoutUserSkills && !emittedNonRetryableEvent && isSkillLoadFailure(error)) {
            sessionStore.remove(context.conversation.id);
            resume = { mode: "fresh" as const };
            canRetryFresh = false;
            canRetryWithoutUserSkills = false;
            skillFallbackEnv = buildIsolatedUserSkillEnv(workspaceRoot);
            yield { type: "thinking_delta" as const, text: `${SKILL_LOAD_FALLBACK_NOTICE}\n` };
            continue;
          }
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

const SKILL_LOAD_FALLBACK_NOTICE = "检测到用户级 skill 元数据损坏，已临时隔离用户级 skills 并自动重试。";

class LocalAgentCommandError extends Error {
  constructor(message: string, readonly emittedOutput: boolean) {
    super(message);
    this.name = "LocalAgentCommandError";
  }
}

function localAgentTimeoutMs() {
  const raw = process.env.GROUP_CHAT_LOCAL_AGENT_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildLocalAgentRunEnv(
  context: RuntimeReplyContext,
  workspaceRoot: string,
  overrides?: Record<string, string>,
): Record<string, string> {
  return {
    ...buildLocalAgentProcessEnv(process.env, { ...tuttiCliEnv(), ...overrides }),
    GROUP_CHAT_WORKSPACE: workspaceRoot,
    GROUP_CHAT_RUN_ID: context.runId ?? "",
    GROUP_CHAT_PARTICIPANT_ID: context.participant.id,
    GROUP_CHAT_CONVERSATION_ID: context.conversation.id,
    GROUP_CHAT_TOOL_BASE_URL: localToolBaseUrl(),
    GROUP_CHAT_SPEED_MODE: context.participant.speedMode ?? "",
  };
}

function buildIsolatedUserSkillEnv(workspaceRoot: string): Record<string, string> {
  const home = join(workspaceRoot, ".group-chat", "isolated-skill-home");
  const agentsHome = join(home, ".agents");
  mkdirSync(join(agentsHome, "skills"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  return {
    HOME: home,
    USERPROFILE: home,
    AGENTS_HOME: agentsHome,
  };
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
  if (!tuttiStatuses) return kitStatuses.map((status) => ({
    ...status,
    displayName: displayNameForLocalAgentProvider(status.provider, status.displayName),
  }));
  const kitStatusByProvider = new Map(kitStatuses.map((status) => [status.provider, status]));
  const merged = new Map<string, LocalAgentProviderStatus>();

  for (const tuttiStatus of tuttiStatuses) {
    const provider = normalizeTuttiAgentProvider(tuttiStatus.provider);
    if (!provider) continue;
    const kitStatus = kitStatusByProvider.get(provider);
    const available = tuttiStatus.availability?.status === "ready";
    const status: LocalAgentProviderStatus = {
      provider,
      displayName: displayNameForLocalAgentProvider(provider, kitStatus?.displayName),
      available,
      authState: authStateFromTuttiAgentProvider(tuttiStatus.auth?.status),
      executablePath: tuttiStatus.cli?.binaryPath ?? tuttiStatus.adapter?.binaryPath ?? kitStatus?.executablePath ?? "",
      version: tuttiStatus.cli?.version ?? kitStatus?.version ?? (available ? "" : "not-installed"),
      configDir: kitStatus?.configDir,
      models: parseTuttiAgentProviderModels(tuttiStatus) ?? kitStatus?.models ?? [],
      defaultModelId: parseTuttiAgentProviderDefaultModelId(tuttiStatus) ?? kitStatus?.defaultModelId,
      reasoningEfforts: parseTuttiAgentProviderReasoningEfforts(tuttiStatus) ?? kitStatus?.reasoningEfforts,
      defaultReasoningEffort: parseTuttiAgentProviderDefaultReasoningEffort(tuttiStatus) ?? kitStatus?.defaultReasoningEffort,
      speedModes: parseTuttiAgentProviderSpeedModes(tuttiStatus) ?? kitStatus?.speedModes,
      defaultSpeedMode: parseTuttiAgentProviderDefaultSpeedMode(tuttiStatus) ?? kitStatus?.defaultSpeedMode,
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

const REASONING_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh"]);

function readString(record: Record<string, unknown> | undefined, ...keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readArray(record: Record<string, unknown> | undefined, ...keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function parseReasoningEffort(value: unknown): ReasoningEffort | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return REASONING_EFFORTS.has(normalized as ReasoningEffort) ? (normalized as ReasoningEffort) : null;
}

function parseReasoningEfforts(value: unknown): ReasoningEffort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const efforts = value
    .map((item) => {
      const itemRecord = toRecord(item);
      return parseReasoningEffort(readString(itemRecord, "effort", "id", "value") ?? item);
    })
    .filter((effort): effort is ReasoningEffort => effort !== null);
  return efforts.length ? [...new Set(efforts)] : undefined;
}

function parseTuttiAgentProviderModels(status: TuttiAgentProviderStatus): LocalAgentProviderModel[] | undefined {
  const root = toRecord(status);
  const configuration = toRecord(status.configuration);
  const catalog = toRecord(status.modelCatalog);
  const rawModels =
    readArray(root, "models", "availableModels", "modelOptions")
    ?? readArray(configuration, "models", "availableModels", "modelOptions")
    ?? readArray(catalog, "models", "availableModels", "modelOptions");
  if (!rawModels?.length) return undefined;

  const models: LocalAgentProviderModel[] = [];
  const seen = new Set<string>();
  for (const entry of rawModels) {
    const record = toRecord(entry);
    if (!record) continue;
    if (record.hidden === true || record.visibility === "hide") continue;
    const id = readString(record, "id", "model", "slug", "value");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = readString(record, "label", "displayName", "display_name", "name", "title") ?? id;
    const description = readString(record, "description", "subtitle");
    const supportedReasoningEfforts = parseReasoningEfforts(
      record.supportedReasoningEfforts
      ?? record.supported_reasoning_efforts
      ?? record.supportedReasoningLevels
      ?? record.supported_reasoning_levels
      ?? record.reasoningEfforts
      ?? record.reasoning,
    );
    models.push({
      id,
      label,
      ...(description ? { description } : {}),
      ...(supportedReasoningEfforts?.length ? { supportedReasoningEfforts } : {}),
    });
  }
  return models.length ? models : undefined;
}

function parseTuttiAgentProviderDefaultModelId(status: TuttiAgentProviderStatus) {
  const root = toRecord(status);
  const configuration = toRecord(status.configuration);
  const defaults = toRecord(status.defaults);
  const catalog = toRecord(status.modelCatalog);
  return readString(root, "defaultModelId", "defaultModel", "selectedModel", "model")
    ?? readString(configuration, "defaultModelId", "defaultModel", "selectedModel", "model")
    ?? readString(defaults, "modelId", "model")
    ?? readString(catalog, "defaultModelId", "defaultModel");
}

function parseTuttiAgentProviderDefaultReasoningEffort(status: TuttiAgentProviderStatus) {
  const root = toRecord(status);
  const configuration = toRecord(status.configuration);
  const defaults = toRecord(status.defaults);
  return parseReasoningEffort(readString(root, "defaultReasoningEffort", "reasoningEffort", "reasoning"))
    ?? parseReasoningEffort(readString(configuration, "defaultReasoningEffort", "reasoningEffort", "reasoning"))
    ?? parseReasoningEffort(readString(defaults, "reasoningEffort", "reasoning"));
}

function parseTuttiAgentProviderReasoningEfforts(status: TuttiAgentProviderStatus) {
  const root = toRecord(status);
  const configuration = toRecord(status.configuration);
  const defaults = toRecord(status.defaults);
  return parseReasoningEfforts(
    readArray(root, "reasoningEfforts", "reasoningOptions", "reasoningLevels", "supportedReasoningEfforts", "supportedReasoningLevels", "reasoning")
    ?? readArray(configuration, "reasoningEfforts", "reasoningOptions", "reasoningLevels", "supportedReasoningEfforts", "supportedReasoningLevels", "reasoning")
    ?? readArray(defaults, "reasoningEfforts", "reasoningOptions", "reasoningLevels", "supportedReasoningEfforts", "supportedReasoningLevels", "reasoning"),
  );
}

function parseTuttiAgentProviderSpeedModes(status: TuttiAgentProviderStatus): LocalAgentProviderSpeedMode[] | undefined {
  const root = toRecord(status);
  const configuration = toRecord(status.configuration);
  const defaults = toRecord(status.defaults);
  const rawModes =
    readArray(root, "speedModes", "speedOptions", "speeds", "availableSpeeds", "performanceModes", "performance")
    ?? readArray(configuration, "speedModes", "speedOptions", "speeds", "availableSpeeds", "performanceModes", "performance")
    ?? readArray(defaults, "speedModes", "speedOptions", "speeds", "availableSpeeds", "performanceModes", "performance");
  if (!rawModes?.length) return undefined;
  const modes: LocalAgentProviderSpeedMode[] = [];
  const seen = new Set<string>();
  for (const entry of rawModes) {
    const record = toRecord(entry);
    const id = record ? readString(record, "id", "value", "key", "mode", "name") : typeof entry === "string" ? entry.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    modes.push({
      id,
      label: record ? readString(record, "label", "displayName", "display_name", "title", "name") ?? id : id,
    });
  }
  return modes.length ? modes : undefined;
}

function parseTuttiAgentProviderDefaultSpeedMode(status: TuttiAgentProviderStatus) {
  const root = toRecord(status);
  const configuration = toRecord(status.configuration);
  const defaults = toRecord(status.defaults);
  return readString(root, "defaultSpeedMode", "defaultSpeed", "selectedSpeedMode", "selectedSpeed", "speedMode", "speed")
    ?? readString(configuration, "defaultSpeedMode", "defaultSpeed", "selectedSpeedMode", "selectedSpeed", "speedMode", "speed")
    ?? readString(defaults, "speedMode", "speed", "defaultSpeedMode", "defaultSpeed");
}

function normalizeTuttiAgentProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude-code") return "claude";
  if (normalized === "codex") return "codex";
  return "";
}

function displayNameForTuttiAgentProvider(provider: string) {
  if (provider === "claude") return "Claude Code";
  if (provider === "codex") return "Codex";
  return provider;
}

function displayNameForLocalAgentProvider(provider: string, detectedDisplayName?: string | null) {
  if (provider === "codex") return "Codex";
  return detectedDisplayName?.trim() || displayNameForTuttiAgentProvider(provider);
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

function isSkillLoadFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to load skill|missing YAML frontmatter|invalid YAML/i.test(message);
}

function didLocalAgentCommandEmitOutput(error: unknown) {
  return error instanceof LocalAgentCommandError && error.emittedOutput;
}

function safePathSegment(value: string) {
  return value.replace(/[^\w.-]/g, "_") || "unknown";
}

export function buildKitSystemPrompt(context: RuntimeReplyContext) {
  const rules = context.conversation.collaborationRules.trim();
  const roleDescription = buildEffectiveRoleDescription(context.participant, context.identity);
  const mentionAll = isMentionAllTrigger(context.userMessage.mentions);
  return [
    "You are a local agent participant inside an IM group chat.",
    "Read AGENTS.md, IDENTITY.md, SOUL.md, MEMORY.md, and DISTILLED_CONTEXT.md in your workspace before relying on memory.",
    "Reply as the current participant, not as the host application.",
    "Your intermediate planning, checks, and progress narration are shown in the thinking/process panel. Keep the final reply concise when the user did not request a specific length, format, or level of detail. If the user asks for a target length such as 500字左右, or asks for a detailed/full answer, honor that request even when the reply is longer.",
    "Do not use tools to send the same reply again. Only use messaging tools for intentional additional side messages.",
    "When using a skill, do not include the skill's file path, README, SKILL.md contents, setup notes, or internal instructions in your reply. Only report the user-facing result, concise progress, or a brief blocker.",
    "When the user asks you to create or provide a file, image, video, or other generated asset, create it in the local workspace or save it with the artifact tool, then include the resulting local filesystem path in your normal final text so the user can open it. Do not send an extra group-chat message or attach it to the conversation unless the user explicitly asks you to post it to the group.",
    "When a Tutti task-management / 任务管理 request appears, use the injected issue-manager skill and the Tutti `issue ...` CLI workflow. Do not treat `mention://workspace-app/issue-manager` as a generic workspace-app direct CLI invocation.",
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
    "When the message mentions both you and a Tutti workspace app reference, interpret it as: the user wants you to use that referenced app to complete the remaining request. Keep the workspace-app mention as structured context; do not turn the visible app label into a guessed shell command.",
    "When you create or update Tutti workspace resources (issues/tasks, apps, or agent sessions), include clickable markdown links in your final reply so the user can open them directly. Use mention:// links, for example [task title](mention://workspace-issue/{issueId}?workspaceId={workspaceId}&topicId={topicId}) or [app name](mention://workspace-app/{appId}?workspaceId={workspaceId}). Read workspaceId and topicId from the current message <mentions> JSON (referenceInsert.scope). Prefer linking the task title instead of only listing a raw Issue ID.",
    rules ? `Collaboration rules version ${context.conversation.collaborationRulesVersion}:\n${rules}` : null,
    roleDescription ? `Role description for this participant in this room:\n${roleDescription}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}

async function loadGroupChatAgentSkillContext(input: {
  provider: string;
  agentSessionId: string;
  workspaceRoot: string;
}): Promise<TuttiAgentSkillContext> {
  try {
    return await loadTuttiAgentSkillContext({
      provider: input.provider,
      agentSessionId: input.agentSessionId,
      cwd: tuttiWorkspaceCwd(input.workspaceRoot),
      commandEnvNames: ["GROUP_CHAT_TUTTI_CLI"],
    });
  } catch (error) {
    throw new Error(`Unable to load Tutti agent skill bundle; check GROUP_CHAT_TUTTI_CLI/TUTTI_CLI: ${errorMessage(error)}`);
  }
}

function tuttiWorkspaceCwd(fallback: string) {
  return process.env.TUTTI_WORKSPACE_ROOT?.trim() || process.env.GROUP_CHAT_WORKSPACE_ROOT?.trim() || fallback;
}

function joinPromptParts(...parts: Array<string | undefined | null>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function tuttiCliEnv(): Record<string, string> {
  const command = resolveTuttiCliCommand({ envNames: ["GROUP_CHAT_TUTTI_CLI"] });
  return command ? { TUTTI_CLI: command, GROUP_CHAT_TUTTI_CLI: command } : {};
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
  return `[${sender}] ${stripGeneratedReplyQuoteMarkers(message.content)}`;
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
