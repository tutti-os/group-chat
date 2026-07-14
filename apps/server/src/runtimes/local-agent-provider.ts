import { mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDefaultLocalAgentProviderPlugins,
  createDefaultLocalAgentRuntime,
  createManagedAgentRunContextFromHeaders,
  type AgentEvent,
  type AgentRunMessage,
  type LocalAgentMcpServerConfig,
  type LocalAgentProviderPlugin,
  type RawAgentEvent,
  type RawAgentStream,
  type DetectContext,
} from "@tutti-os/agent-acp-kit";
import {
  loadTuttiAgentCatalog,
  loadTuttiAgentComposerOptions,
  loadTuttiAgentSkillContext,
  resolveTuttiCliCommand,
  type TuttiAgentCatalogEntry,
  type TuttiAgentSkillContext,
} from "@tutti-os/agent-acp-kit/tutti";
import type { LocalAgentTargetStatus, LocalAgentTargetStatusResponse, ReasoningEffort } from "@group-chat/shared";
import { isMentionAllTrigger } from "@group-chat/shared";
import { buildEffectiveRoleDescription } from "../domains/agent-instructions.js";
import { participantWorkspaceRoot } from "../local/paths.js";
import { enrichLocalAgentProviderStatus } from "./local-agent-config-catalog.js";
import { acpPromptFromLocalAgentInput } from "./local-agent-acp.js";
import { isContextWindowError, isRecoverableResumeError } from "./local-agent-resume-errors.js";
import {
  buildLocalAgentInput,
  decodeLocalAgentStdout,
  isWorkspaceAppOnlyTaskMessage,
  localToolBaseUrl,
  stripGeneratedReplyQuoteMarkers,
} from "./local-agent-protocol.js";
import type { RuntimeProvider, RuntimeReplyContext, RuntimeStreamEvent } from "./runtime-provider.js";
import { RuntimeProviderUnsupportedError } from "./runtime-provider.js";
import { buildLocalAgentProcessEnv } from "./local-agent-env.js";
import { LocalAgentSessionStore } from "./local-agent-session-store.js";

type GroupChatLocalAgentProviderPlugin = LocalAgentProviderPlugin<"local-agent", string>;
const DEFAULT_KIT_HISTORY_LIMIT = 16;
const COMPACT_KIT_HISTORY_LIMIT = 4;

type ContextRetryMode = "normal" | "compact-history" | "minimal";

export class LocalAgentRuntimeProvider implements RuntimeProvider {
  id = "local-agent";
  private readonly processes = new Map<string, { cancel: () => Promise<void> | void }>();
  private readonly localAgentRuntime = createDefaultLocalAgentRuntime({
    providers: createGroupChatLocalAgentProviderPlugins(),
  });

  canHandle(runtimeProfile: RuntimeReplyContext["runtimeProfile"]) {
    return runtimeProfile?.kind === "local-agent";
  }

  describeRun(context: RuntimeReplyContext) {
    return {
      runtime: context.runtimeProfile?.kind ?? "local-agent",
      agentTargetId: context.runtimeProfile?.agentTargetId ?? context.participant.agentTargetId,
      provider: context.runtimeProfile?.provider ?? "local-agent",
      model: context.runtimeProfile?.model ?? context.participant.runtimeProfileId ?? "local-agent:unknown",
    };
  }

  async detect(context: RuntimeReplyContext) {
    try {
      const agentTargetId = exactAgentTargetId(context);
      const target = agentTargetId
        ? await this.resolveExactTarget(agentTargetId, context.agentDetectContext)
        : await this.resolveUniqueLegacyProviderTarget(context.runtimeProfile?.provider, context.agentDetectContext);
      assertTargetProviderMatchesProfile(target.providerId, context);
      if (!target.runtimeSupported || target.availability.status !== "available") {
        return { available: false, reason: target.availability.detail || "Agent target is unavailable." };
      }
      return { available: true };
    } catch (error) {
      return {
        available: false,
        reason: errorMessage(error),
      };
    }
  }

  async listLocalAgentTargets(detectContext?: DetectContext): Promise<LocalAgentTargetStatusResponse> {
    const env = buildLocalAgentProcessEnv(process.env, tuttiCliEnv());
    const catalog = await loadTuttiAgentCatalog({
      runtime: this.localAgentRuntime,
      env,
      detectContext,
      commandEnvNames: ["GROUP_CHAT_TUTTI_CLI"],
    });
    const detections = catalog.source === "standalone"
      ? await this.localAgentRuntime.detect(detectContext)
      : [];
    const detectedByProvider = new Map(detections.map((item) => [item.provider, item]));
    const agents = await Promise.all(catalog.agents.map(async (agent): Promise<LocalAgentTargetStatus> => {
      const detected = detectedByProvider.get(agent.providerId);
      let composer: Awaited<ReturnType<typeof loadTuttiAgentComposerOptions>> | null = null;
      try {
        composer = await loadTuttiAgentComposerOptions({
          runtime: this.localAgentRuntime,
          agentTargetId: agent.agentTargetId,
          env,
          detectContext,
          commandEnvNames: ["GROUP_CHAT_TUTTI_CLI"],
        });
      } catch {
        // Catalog visibility is authoritative; composer metadata is optional UI enrichment.
      }
      const reasoningEfforts = composer?.reasoningConfig.options
        .map((option) => parseReasoningEffort(option.value))
        .filter((effort): effort is ReasoningEffort => effort !== null)
        ?? undefined;
      const status: LocalAgentTargetStatus = {
        agentTargetId: agent.agentTargetId,
        providerId: agent.providerId,
        provider: agent.providerId,
        displayName: agent.displayName,
        runtimeSupported: agent.runtimeSupported,
        availabilityStatus: agent.availability.status,
        available: agent.runtimeSupported && agent.availability.status === "available",
        authState: authStateFromCatalog(agent, detected?.authState),
        executablePath: "",
        version: detected?.supported ? "detected" : "not-installed",
        models: composer?.modelConfig.options.map((option) => ({
          id: option.value,
          label: option.label,
          ...(option.description ? { description: option.description } : {}),
        })) ?? (detected?.models ?? []).map((model) => ({ id: model.id, label: model.label })),
        defaultModelId: composer?.modelConfig.currentValue || composer?.modelConfig.defaultValue || undefined,
        ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
        defaultReasoningEffort: parseReasoningEffort(composer?.reasoningConfig.currentValue) ?? undefined,
        speedModes: composer?.speedConfig.options.map((option) => ({ id: option.value, label: option.label })),
        defaultSpeedMode: composer?.speedConfig.currentValue || composer?.speedConfig.defaultValue || undefined,
        reason: agent.availability.status === "available" && agent.runtimeSupported ? undefined : agent.availability.detail,
      };
      return enrichLocalAgentProviderStatus(status);
    }));
    return { defaultAgentTargetId: catalog.defaultAgentTargetId, agents };
  }

  async *streamReply(context: RuntimeReplyContext) {
    const target = await this.resolveExactTargetForRun(context);
    if (!context.managedAgentRunContext && context.managedAgentHeaders && context.runId) {
      context.managedAgentRunContext = await createManagedAgentRunContextFromHeaders(context.managedAgentHeaders, {
        providerId: target.providerId,
        runId: context.runId,
      });
    }
    const command = resolveLocalAgentCommand(context, target.providerId);
    if (command) {
      yield* this.streamCommandBridge(context, command);
      return;
    }

    yield* this.streamKitBridge(context, target.providerId, target.agentTargetId, target.legacyProviderUnique);
  }

  private async resolveExactTarget(agentTargetId: string, detectContext?: DetectContext) {
    const catalog = await loadTuttiAgentCatalog({
      runtime: this.localAgentRuntime,
      env: buildLocalAgentProcessEnv(process.env, tuttiCliEnv()),
      detectContext,
      commandEnvNames: ["GROUP_CHAT_TUTTI_CLI"],
    });
    const target = catalog.agents.find((agent) => agent.agentTargetId === agentTargetId);
    if (!target) throw new RuntimeProviderUnsupportedError(`Unknown Agent target: ${agentTargetId}`);
    const legacyProviderUnique = catalog.agents.filter((agent) =>
      agent.providerId === target.providerId
      && agent.runtimeSupported
      && agent.availability.status === "available"
    ).length === 1;
    return { ...target, legacyProviderUnique };
  }

  private async resolveExactTargetForRun(context: RuntimeReplyContext) {
    const agentTargetId = exactAgentTargetId(context);
    const target = agentTargetId
      ? await this.resolveExactTarget(agentTargetId, context.agentDetectContext)
      : await this.resolveUniqueLegacyProviderTarget(context.runtimeProfile?.provider, context.agentDetectContext);
    assertTargetProviderMatchesProfile(target.providerId, context);
    if (!target.runtimeSupported || target.availability.status !== "available") {
      throw new RuntimeProviderUnsupportedError(target.availability.detail || `Agent target is unavailable: ${agentTargetId}`);
    }
    return target;
  }

  private async resolveUniqueLegacyProviderTarget(providerId: string | null | undefined, detectContext?: DetectContext) {
    const normalizedProviderId = canonicalProviderId(providerId);
    if (!normalizedProviderId) throw new RuntimeProviderUnsupportedError("Exact Agent target is required.");
    const catalog = await loadTuttiAgentCatalog({
      runtime: this.localAgentRuntime,
      env: buildLocalAgentProcessEnv(process.env, tuttiCliEnv()),
      detectContext,
      commandEnvNames: ["GROUP_CHAT_TUTTI_CLI"],
    });
    const matches = catalog.agents.filter((agent) =>
      agent.providerId === normalizedProviderId
      && agent.runtimeSupported
      && agent.availability.status === "available"
    );
    if (matches.length !== 1) {
      throw new RuntimeProviderUnsupportedError(
        `Legacy provider cannot be migrated to one available Agent target: ${normalizedProviderId}`,
      );
    }
    return { ...matches[0]!, legacyProviderUnique: true };
  }

  async cancel(runId: string) {
    const process = this.processes.get(runId);
    if (!process) return { cancelled: false, reason: "local-agent process is not running" };
    await process.cancel();
    this.processes.delete(runId);
    return { cancelled: true };
  }

  async compactContext(context: RuntimeReplyContext) {
    const target = await this.resolveExactTargetForRun(context);
    const provider = target.providerId;
    const agentTargetId = target.agentTargetId;
    if (resolveLocalAgentCommand(context, provider)) {
      throw new Error("Configured local-agent command bridge does not expose provider session compaction.");
    }
    if (!this.localAgentRuntime.listProviders().some((item) => item.id === provider)) {
      throw new Error(`${provider} local agent provider is not registered.`);
    }
    const workspaceRoot = participantWorkspaceRoot(context.conversation.roomId, context.participant.id);
    const sessionStore = new LocalAgentSessionStore(workspaceRoot);
    const previousSession = sessionStore.read(context.conversation.id);
    if (!previousSession
      || canonicalProviderId(previousSession.provider) !== canonicalProviderId(provider)
      || (previousSession.agentTargetId
        ? previousSession.agentTargetId !== agentTargetId
        : !target.legacyProviderUnique)
      || (!previousSession.providerSessionId && !previousSession.resumeToken)) {
      throw new Error("No active provider session is available to compact yet.");
    }

    const controller = new AbortController();
    const runId = `context-compact-${context.conversation.id}-${context.participant.id}-${Date.now()}`;
    if (!context.managedAgentRunContext && context.managedAgentHeaders) {
      context.managedAgentRunContext = await createManagedAgentRunContextFromHeaders(context.managedAgentHeaders, {
        providerId: target.providerId,
        runId,
      });
    }
    const resume = {
      mode: "provider" as const,
      ...(previousSession.providerSessionId ? { providerSessionId: previousSession.providerSessionId } : {}),
      ...(previousSession.resumeToken ? { resumeToken: previousSession.resumeToken } : {}),
    };
    for await (const event of this.localAgentRuntime.run({
      runId,
      conversationId: context.conversation.id,
      sessionId: context.conversation.id,
      provider,
      runtimeKind: "local-agent",
      runtimeProvider: provider,
      cwd: context.managedAgentRunContext?.cwd ?? workspaceRoot,
      prompt: "/compact",
      model: localAgentModelIdForAcp(context.runtimeProfile?.model ?? previousSession.model ?? "default", provider),
      reasoning: context.participant.reasoningEffort ?? undefined,
      env: buildLocalAgentRunEnv({ ...context, runId }, workspaceRoot),
      managedAgentInvocation: context.managedAgentRunContext?.managedAgentInvocation,
      metadata: context.participant.speedMode ? { speedMode: context.participant.speedMode } : undefined,
      extraAllowedDirs: [workspaceRoot],
      resume,
      signal: controller.signal,
    })) {
      if (event.type === "usage") {
        sessionStore.updateUsage(context.conversation.id, {
          agentTargetId,
          provider,
          model: context.runtimeProfile?.model ?? previousSession.model ?? null,
          usage: event.usage,
        });
        continue;
      }
      if (event.type === "done") {
        if (event.sessionId || event.resumeToken) {
          sessionStore.write(context.conversation.id, {
            agentTargetId,
            provider,
            providerSessionId: event.sessionId,
            resumeToken: event.resumeToken,
            model: context.runtimeProfile?.model ?? previousSession.model ?? null,
          });
        }
        if (event.status === "failed") {
          throw new Error(`local-agent ${provider} compact failed${typeof event.exitCode === "number" ? ` with exit code ${event.exitCode}` : ""}`);
        }
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    sessionStore.markCompacted(context.conversation.id, {
      agentTargetId,
      provider,
      model: context.runtimeProfile?.model ?? previousSession.model ?? null,
    });
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

  private async *streamKitBridge(
    context: RuntimeReplyContext,
    provider: string,
    agentTargetId: string,
    legacyProviderUnique: boolean,
  ) {
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
      const timeoutMs = localAgentTimeoutMs();
      const runtimeRunId = context.runId ?? `${context.conversation.id}:${context.participant.id}`;
      let skillFallbackEnv: Record<string, string> | undefined;
      let skillContext = emptyTuttiAgentSkillContext(agentTargetId, provider, runtimeRunId);
      if (shouldLoadGroupChatAgentSkillContext(context, input)) {
        try {
          skillContext = await loadGroupChatAgentSkillContext({
            agentTargetId,
            provider,
            agentSessionId: runtimeRunId,
            workspaceRoot,
          });
        } catch (error) {
          if (provider === "codex" && isSkillLoadFailure(error)) {
            skillFallbackEnv = buildIsolatedUserSkillEnv(workspaceRoot);
            yield { type: "thinking_delta" as const, text: `${SKILL_LOAD_FALLBACK_NOTICE}\n` };
            try {
              skillContext = await loadGroupChatAgentSkillContext({
                agentTargetId,
                provider,
                agentSessionId: runtimeRunId,
                workspaceRoot,
                envOverrides: skillFallbackEnv,
              });
            } catch (fallbackError) {
              if (!isTuttiSkillBundleLoadFailure(fallbackError)) throw fallbackError;
              skillContext = emptyTuttiAgentSkillContext(agentTargetId, provider, runtimeRunId);
              yield { type: "thinking_delta" as const, text: `${SKILL_BUNDLE_UNAVAILABLE_NOTICE}\n` };
            }
          } else if (isTuttiSkillBundleLoadFailure(error)) {
            skillContext = emptyTuttiAgentSkillContext(agentTargetId, provider, runtimeRunId);
            yield { type: "thinking_delta" as const, text: `${SKILL_BUNDLE_UNAVAILABLE_NOTICE}\n` };
          } else {
            throw error;
          }
        }
      }
      const previousSessionMatchesTarget = previousSession?.agentTargetId
        ? previousSession.agentTargetId === agentTargetId
        : legacyProviderUnique && canonicalProviderId(previousSession?.provider) === canonicalProviderId(provider);
      let resume = !input.turn.intent && previousSessionMatchesTarget && (previousSession?.providerSessionId || previousSession?.resumeToken)
        ? {
            mode: "provider" as const,
            ...(previousSession?.providerSessionId ? { providerSessionId: previousSession.providerSessionId } : {}),
            ...(previousSession?.resumeToken ? { resumeToken: previousSession.resumeToken } : {}),
          }
        : { mode: "fresh" as const };
      let canRetryFresh = resume.mode !== "fresh";
      let historyLimit = DEFAULT_KIT_HISTORY_LIMIT;
      let contextRetryMode: ContextRetryMode = "normal";
      let canRetryWithoutUserSkills = provider === "codex" && !skillFallbackEnv;
      let emittedNonRetryableEvent = false;
      let emittedContextRetryBlockingEvent = false;
      while (true) {
        const prompt = acpPromptFromLocalAgentInput(input, { compact: contextRetryMode === "minimal" });
        const systemPrompt = buildKitAttemptSystemPrompt(context, skillContext, contextRetryMode);
        const mcpServers = contextRetryMode === "minimal" ? undefined : buildGroupChatMcpServers(context);
        const skillManifest = contextRetryMode === "minimal" ? undefined : skillContext.skillManifest;
        try {
          for await (const event of this.localAgentRuntime.run({
            runId: runtimeRunId,
            conversationId: context.conversation.id,
            sessionId: context.conversation.id,
            provider,
            runtimeKind: "local-agent",
            runtimeProvider: provider,
            cwd: context.managedAgentRunContext?.cwd ?? workspaceRoot,
            prompt,
            systemPrompt,
            history: buildKitHistory(context, historyLimit),
            model: localAgentModelIdForAcp(context.runtimeProfile?.model ?? "default", provider),
            reasoning: context.participant.reasoningEffort ?? undefined,
            ...(mcpServers ? { mcpServers } : {}),
            ...(skillManifest ? { skillManifest } : {}),
            env: buildLocalAgentRunEnv(context, workspaceRoot, skillFallbackEnv),
            managedAgentInvocation: context.managedAgentRunContext?.managedAgentInvocation,
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
              if (
                runtimeEvent.type !== "status"
                && runtimeEvent.type !== "stderr"
                && runtimeEvent.type !== "thinking_delta"
              ) {
                emittedContextRetryBlockingEvent = true;
              }
              yield runtimeEvent;
            } else if (event.type === "error") {
              throw new Error(event.message);
            } else if (event.type === "usage") {
              sessionStore.updateUsage(context.conversation.id, {
                agentTargetId,
                provider,
                model: context.runtimeProfile?.model ?? null,
                usage: event.usage,
              });
            } else if (event.type === "done") {
              if (event.sessionId || event.resumeToken) {
                sessionStore.write(context.conversation.id, {
                  agentTargetId,
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
          if (provider === "codex" && !emittedContextRetryBlockingEvent && isContextWindowError(error)) {
            sessionStore.remove(context.conversation.id);
            resume = { mode: "fresh" as const };
            canRetryFresh = false;
            const nextRetryMode = nextContextRetryMode(contextRetryMode);
            if (nextRetryMode) {
              contextRetryMode = nextRetryMode;
              historyLimit = contextRetryMode === "minimal" ? 0 : COMPACT_KIT_HISTORY_LIMIT;
              yield {
                type: "thinking_delta" as const,
                text: `${contextRetryMode === "minimal" ? CONTEXT_WINDOW_MINIMAL_RETRY_NOTICE : CONTEXT_WINDOW_FRESH_RETRY_NOTICE}\n`,
              };
              continue;
            }
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
const SKILL_BUNDLE_UNAVAILABLE_NOTICE = "Tutti skill bundle 暂时不可用，已跳过 skill bundle 注入并继续执行。";
const CONTEXT_WINDOW_FRESH_RETRY_NOTICE = "检测到 Codex 上下文窗口已满，已自动开启新线程并减少历史上下文重试。";
const CONTEXT_WINDOW_MINIMAL_RETRY_NOTICE = "上下文仍然过大，已切换到紧急最小上下文重试。";

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

function exactAgentTargetId(context: RuntimeReplyContext) {
  const profileTargetId = context.runtimeProfile?.agentTargetId?.trim() ?? "";
  const participantTargetId = context.participant.agentTargetId?.trim() ?? "";
  if (profileTargetId && participantTargetId && profileTargetId !== participantTargetId) {
    throw new RuntimeProviderUnsupportedError("Participant and runtime profile Agent targets do not match.");
  }
  return participantTargetId || profileTargetId;
}

function assertTargetProviderMatchesProfile(providerId: string, context: RuntimeReplyContext) {
  const profileProvider = canonicalProviderId(context.runtimeProfile?.provider);
  if (profileProvider && profileProvider !== canonicalProviderId(providerId)) {
    throw new RuntimeProviderUnsupportedError("Agent target runtime metadata changed; refresh the Agent catalog.");
  }
}

function canonicalProviderId(providerId: string | null | undefined) {
  const normalized = providerId?.trim().toLowerCase() ?? "";
  return normalized === "claude" ? "claude-code" : normalized;
}

function resolveLocalAgentCommand(_context: RuntimeReplyContext, providerId: string) {
  const provider = providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
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

function authStateFromCatalog(
  provider: TuttiAgentCatalogEntry,
  detected: LocalAgentTargetStatus["authState"] | undefined,
): LocalAgentTargetStatus["authState"] {
  if (provider.availability.reasonCode === "auth_required") return "missing";
  if (provider.availability.reasonCode === "auth_expired") return "expired";
  return detected ?? "unknown";
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
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  if (filename === "tools-mcp.mjs") {
    const packaged = resolve(moduleDir, "tools-mcp.js");
    if (existsSync(packaged)) return packaged;
  }
  return resolve(moduleDir, "..", "local-agent-host", filename);
}

function localAgentModelIdForAcp(model: string, provider: string) {
  const stripped = stripLocalAgentProviderPrefix(model, provider);
  if (provider === "cursor" && stripped === "default") return "default[]";
  return stripped;
}

function isSkillLoadFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to load skill|missing YAML frontmatter|invalid YAML/i.test(message);
}

function isTuttiSkillBundleLoadFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^Unable to load Tutti agent skill bundle/i.test(message);
}

function didLocalAgentCommandEmitOutput(error: unknown) {
  return error instanceof LocalAgentCommandError && error.emittedOutput;
}

function shouldLoadGroupChatAgentSkillContext(context: RuntimeReplyContext, input: ReturnType<typeof buildLocalAgentInput>) {
  if (input.turn.intent) return true;
  if (context.userMessage.mentions.some((mention) => mention.mentionType === "reference")) return true;
  return /\b(?:mention|group-chat):\/\//i.test(context.userMessage.content);
}

export function buildKitSystemPrompt(context: RuntimeReplyContext) {
  const rules = context.conversation.collaborationRules.trim();
  const roleDescription = buildEffectiveRoleDescription(context.participant, context.identity);
  const mentionAll = isMentionAllTrigger(context.userMessage.mentions);
  const workspaceAppOnlyDispatch = isWorkspaceAppOnlyTaskMessage(context);
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
    workspaceAppOnlyDispatch
      ? "This run was triggered by a Tutti workspace app mention without an agent mention. Treat it as explicitly assigned work for you as the app dispatcher; do not output [NO_REPLY] merely because your participant name was not mentioned."
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

function buildKitAttemptSystemPrompt(
  context: RuntimeReplyContext,
  skillContext: TuttiAgentSkillContext,
  mode: ContextRetryMode,
) {
  if (mode === "minimal") return buildMinimalKitSystemPrompt(context);
  return joinPromptParts(skillContext.recommendedSystemPrompt?.content, buildKitSystemPrompt(context));
}

function buildMinimalKitSystemPrompt(context: RuntimeReplyContext) {
  const mentionAll = isMentionAllTrigger(context.userMessage.mentions);
  const workspaceAppOnlyDispatch = isWorkspaceAppOnlyTaskMessage(context);
  return [
    "You are a local agent participant inside an IM group chat.",
    "This is an emergency retry after a model context overflow. Keep only the current user request in focus.",
    "Reply as the current participant, not as the host application.",
    "Keep the final reply concise unless the user explicitly requested a target length or detailed answer.",
    context.conversation.type === "group" && context.participant.listenMode === "passive" && !mentionAll && !workspaceAppOnlyDispatch
      ? "In passive group listen mode, reply only when directly mentioned or explicitly assigned work; otherwise output [NO_REPLY]."
      : null,
    workspaceAppOnlyDispatch
      ? "This run was triggered by a Tutti workspace app mention without an agent mention; treat it as explicitly assigned work."
      : null,
    "Do not claim a tool action happened unless the tool actually succeeded.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}

function nextContextRetryMode(mode: ContextRetryMode): ContextRetryMode | null {
  if (mode === "normal") return "compact-history";
  if (mode === "compact-history") return "minimal";
  return null;
}

async function loadGroupChatAgentSkillContext(input: {
  agentTargetId: string;
  provider: string;
  agentSessionId: string;
  workspaceRoot: string;
  envOverrides?: Record<string, string>;
}): Promise<TuttiAgentSkillContext> {
  try {
    const env = buildLocalAgentProcessEnv(process.env, { ...tuttiCliEnv(), ...input.envOverrides });
    return await loadTuttiAgentSkillContext({
      agentTargetId: input.agentTargetId,
      agentSessionId: input.agentSessionId,
      cwd: tuttiWorkspaceCwd(input.workspaceRoot),
      env,
      commandEnvNames: ["GROUP_CHAT_TUTTI_CLI"],
    });
  } catch (error) {
    throw new Error(`Unable to load Tutti agent skill bundle; check GROUP_CHAT_TUTTI_CLI/TUTTI_CLI: ${errorMessage(error)}`);
  }
}

function emptyTuttiAgentSkillContext(
  agentTargetId: string,
  providerId: string,
  agentSessionId: string,
): TuttiAgentSkillContext {
  return {
    source: "standalone",
    agentTargetId,
    providerId,
    agentSessionId,
    skills: [],
    skillManifest: [],
  };
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

function buildKitHistory(context: RuntimeReplyContext, limit = DEFAULT_KIT_HISTORY_LIMIT): AgentRunMessage[] {
  if (limit <= 0) return [];
  return context.recentMessages
    .filter((message) => message.id !== context.userMessage.id)
    .filter((message) => message.status === "success" && message.content.trim())
    .slice(-limit)
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
    provider.id === "claude-code"
      ? withGroupChatClaudeStreamCompatibility(provider)
      : provider.id === "codex"
        ? withGroupChatCodexStreamCompatibility(provider)
        : provider,
  ) as GroupChatLocalAgentProviderPlugin[];
}

function withGroupChatCodexStreamCompatibility(
  provider: GroupChatLocalAgentProviderPlugin,
): GroupChatLocalAgentProviderPlugin {
  const baseCreateAdapter = provider.createAdapter;
  return {
    ...provider,
    createAdapter: baseCreateAdapter
      ? () => {
          const adapter = baseCreateAdapter();
          return {
            ...adapter,
            parseEvents(stream) {
              return normalizeCodexAgentEventsForGroupChat(adapter.parseEvents(stream));
            },
          };
        }
      : undefined,
    async *run(params) {
      yield* normalizeCodexAgentEventsForGroupChat(provider.run(params));
    },
  };
}

async function* normalizeCodexAgentEventsForGroupChat(stream: AsyncIterable<AgentEvent>): AsyncIterable<AgentEvent> {
  for await (const event of stream) {
    if ((event.type === "text_delta" || event.type === "thinking" || event.type === "thinking_delta") && event.text) {
      yield* splitTaggedReasoningEvent(event);
      continue;
    }
    yield event;
  }
}

function* splitTaggedReasoningEvent(
  event: Extract<AgentEvent, { type: "text_delta" | "thinking" | "thinking_delta" }>,
): Generator<AgentEvent> {
  const parts = splitTaggedReasoningText(event.text);
  if (parts.length === 0) {
    yield event;
    return;
  }
  let emitted = false;
  for (const part of parts) {
    if (!part.text) continue;
    emitted = true;
    yield {
      type: part.kind === "reasoning"
        ? "thinking_delta"
        : event.type === "thinking" ? "thinking_delta" : event.type,
      text: part.text,
    };
  }
  if (!emitted) yield event;
}

function splitTaggedReasoningText(text: string) {
  if (!/<reasoning>[\s\S]*?<\/reasoning>/i.test(text)) return [];
  const parts: Array<{ kind: "reasoning" | "text"; text: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(/<reasoning>([\s\S]*?)<\/reasoning>/gi)) {
    const index = match.index ?? 0;
    const before = text.slice(cursor, index);
    if (before) parts.push({ kind: "text", text: before });
    const reasoning = match[1]?.trim();
    if (reasoning) parts.push({ kind: "reasoning", text: reasoning });
    cursor = index + match[0].length;
  }
  const after = text.slice(cursor);
  if (after) parts.push({ kind: "text", text: after });
  return parts;
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
