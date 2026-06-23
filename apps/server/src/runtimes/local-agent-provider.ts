import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
import type { LocalAgentProviderStatus, MentionTarget } from "@group-chat/shared";
import { isMentionAllTrigger } from "@group-chat/shared";
import { buildEffectiveRoleDescription } from "../domains/agent-instructions.js";
import { participantWorkspaceRoot } from "../local/paths.js";
import { enrichLocalAgentProviderStatus } from "./local-agent-config-catalog.js";
import { acpPromptFromLocalAgentInput } from "./local-agent-acp.js";
import { buildLocalAgentInput, decodeLocalAgentStdout, localToolBaseUrl } from "./local-agent-protocol.js";
import type { RuntimeProvider, RuntimeReplyContext, RuntimeStreamEvent } from "./runtime-provider.js";
import { RuntimeProviderUnsupportedError } from "./runtime-provider.js";

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

type WorkspaceAppBridge = {
  appId: "vibe-design";
  prompt: string;
  workspaceId?: string;
};

type TuttiCliRunState = {
  child: ChildProcessWithoutNullStreams | null;
  cancelled: boolean;
};

type VibeDesignFile = {
  name: string;
  url?: string;
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
    const workspaceAppBridge = resolveWorkspaceAppBridge(context);
    if (workspaceAppBridge) {
      yield* this.streamWorkspaceAppBridge(context, workspaceAppBridge);
      return;
    }

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

  private async *streamWorkspaceAppBridge(context: RuntimeReplyContext, bridge: WorkspaceAppBridge) {
    if (bridge.appId === "vibe-design") {
      yield* this.streamVibeDesignBridge(context, bridge);
    }
  }

  private async *streamVibeDesignBridge(context: RuntimeReplyContext, bridge: WorkspaceAppBridge) {
    const workspaceRoot = participantWorkspaceRoot(context.conversation.roomId, context.participant.id);
    const runState: TuttiCliRunState = { child: null, cancelled: false };
    if (context.runId) {
      this.processes.set(context.runId, {
        cancel: () => {
          runState.cancelled = true;
          runState.child?.kill("SIGTERM");
        },
      });
    }

    const projectCallId = `${context.runId ?? context.conversation.id}:vibe-design-project-create`;
    const sessionCallId = `${context.runId ?? context.conversation.id}:vibe-design-session-start`;
    const filesCallId = `${context.runId ?? context.conversation.id}:vibe-design-files`;
    try {
      yield {
        type: "thinking_delta",
        text: "识别到 Vibe Design 应用引用，改为通过 Tutti CLI 创建原型项目并运行 Vibe Design agent。\n",
      } satisfies RuntimeStreamEvent;

      yield {
        type: "tool_call",
        id: projectCallId,
        name: "tutti vibe-design project-create",
        input: { prompt: bridge.prompt },
      } satisfies RuntimeStreamEvent;
      let projectPayload: unknown;
      try {
        yield {
          type: "thinking_delta",
          text: "正在创建 Vibe Design 项目...\n",
        } satisfies RuntimeStreamEvent;
        projectPayload = await runTuttiJsonCommand(
          ["vibe-design", "project-create", "--prompt", bridge.prompt, "--title", titleFromPrompt(bridge.prompt)],
          workspaceRoot,
          runState,
        );
      } catch (error) {
        yield failedToolResult(projectCallId, "tutti vibe-design project-create", error);
        throw error;
      }
      yield {
        type: "tool_result",
        id: projectCallId,
        name: "tutti vibe-design project-create",
        status: "completed",
        output: summarizeVibeDesignProject(projectPayload),
      } satisfies RuntimeStreamEvent;

      const projectId = readStringPath(projectPayload, ["project", "id"]);
      if (!projectId) throw new Error("Vibe Design project-create did not return project.id");
      yield {
        type: "thinking_delta",
        text: `项目已创建：${projectId}。开始运行 Vibe Design agent 生成页面...\n`,
      } satisfies RuntimeStreamEvent;

      yield {
        type: "tool_call",
        id: sessionCallId,
        name: "tutti vibe-design session-start",
        input: { projectId },
      } satisfies RuntimeStreamEvent;
      let sessionPayload: unknown;
      try {
        sessionPayload = await runTuttiJsonCommand(
          ["vibe-design", "session-start", "--project-id", projectId, "--prompt", bridge.prompt],
          workspaceRoot,
          runState,
        );
      } catch (error) {
        yield failedToolResult(sessionCallId, "tutti vibe-design session-start", error);
        throw error;
      }
      yield {
        type: "thinking_delta",
        text: "Vibe Design agent 已完成运行，正在读取生成文件列表...\n",
      } satisfies RuntimeStreamEvent;
      const sessionStatus = readStringPath(sessionPayload, ["status"]);
      if (sessionStatus && sessionStatus !== "succeeded") {
        const error = new Error(`Vibe Design run ${sessionStatus}`);
        yield failedToolResult(sessionCallId, "tutti vibe-design session-start", error);
        throw error;
      }
      yield {
        type: "tool_result",
        id: sessionCallId,
        name: "tutti vibe-design session-start",
        status: "completed",
        output: summarizeVibeDesignSession(sessionPayload),
      } satisfies RuntimeStreamEvent;

      yield {
        type: "tool_call",
        id: filesCallId,
        name: "tutti vibe-design files",
        input: { projectId },
      } satisfies RuntimeStreamEvent;
      let filesPayload: unknown;
      try {
        filesPayload = await runTuttiJsonCommand(
          ["vibe-design", "files", "--project-id", projectId],
          workspaceRoot,
          runState,
        );
      } catch (error) {
        yield failedToolResult(filesCallId, "tutti vibe-design files", error);
        throw error;
      }
      const files = extractVibeDesignFiles(filesPayload);
      yield {
        type: "thinking_delta",
        text: `已读取 ${files.length} 个生成文件，准备返回最终链接。\n`,
      } satisfies RuntimeStreamEvent;
      yield {
        type: "tool_result",
        id: filesCallId,
        name: "tutti vibe-design files",
        status: "completed",
        output: { files: files.map((file) => ({ name: file.name, url: file.url })) },
      } satisfies RuntimeStreamEvent;

      yield {
        type: "text_delta",
        text: formatVibeDesignFinalReply({
          projectId,
          conversationId: readStringPath(sessionPayload, ["conversationId"])
            ?? readStringPath(projectPayload, ["conversationId"]),
          provider: readStringPath(sessionPayload, ["provider"]),
          fallback: readStringPath(sessionPayload, ["agentFallback", "message"]),
          files,
          workspaceId: bridge.workspaceId,
        }),
      } satisfies RuntimeStreamEvent;
    } finally {
      if (context.runId) this.processes.delete(context.runId);
    }
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

    try {
      child.stdin.end(JSON.stringify(buildLocalAgentInput(context), null, 2));
      child.stdout.setEncoding("utf8");
      yield* decodeLocalAgentStdout(child.stdout);
      const [code, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
      if (code !== 0) {
        const stderr = stderrChunks.join("").trim();
        if (timedOut && signal === "SIGTERM" && code === null) {
          throw new Error("Agent 执行超时，已被终止");
        }
        throw new Error(`local-agent command exited with ${code ?? signal ?? "unknown"}${stderr ? `: ${stderr}` : ""}`);
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

function localAgentTimeoutMs() {
  const raw = process.env.GROUP_CHAT_LOCAL_AGENT_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function resolveWorkspaceAppBridge(context: RuntimeReplyContext): WorkspaceAppBridge | null {
  for (const mention of context.userMessage.mentions) {
    if (mention.mentionType !== "reference" || mention.referenceProviderId !== "workspace-app") continue;
    if (mention.referenceEntityId !== "vibe-design") continue;
    const prompt = stripWorkspaceAppMentionPrompt(context.userMessage.content, mention, context.userMessage.mentions);
    return {
      appId: "vibe-design",
      prompt: prompt || context.userMessage.content.trim() || "Create a website prototype.",
      workspaceId: workspaceIdFromMention(mention),
    };
  }
  return null;
}

function stripWorkspaceAppMentionPrompt(
  content: string,
  appMention: MentionTarget,
  mentions: MentionTarget[],
) {
  let result = content;
  result = result.replace(/\[[^\]]+\]\(mention:\/\/workspace-app\/vibe-design[^)]*\)/gi, " ");
  result = result.replace(/\[[^\]]+\]\(group-chat:\/\/reference\/workspace-app\/vibe-design[^)]*\)/gi, " ");
  result = stripMentionLabel(result, appMention.displayNameSnapshot);
  for (const mention of mentions) {
    if (mention.mentionType === "participant") {
      result = stripMentionLabel(result, mention.displayNameSnapshot);
    }
  }
  return result
    .replace(/(?:^|\n)\s*你用\s*(?=\n|$)/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMentionLabel(content: string, label: string) {
  const normalized = label.replace(/^@/, "").trim();
  if (!normalized) return content;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content
    .replace(new RegExp(`\\[@?${escaped}\\]\\([^)]+\\)`, "gi"), " ")
    .replace(new RegExp(`@${escaped}(?=\\s|$|[，。！？,.!?;:：；、])`, "gi"), " ")
    .replace(new RegExp(`(^|\\n)\\s*${escaped}\\s*(?=\\n|$)`, "gi"), "$1");
}

function workspaceIdFromMention(mention: MentionTarget) {
  const scopedWorkspaceId = mention.referenceScope?.workspaceId;
  if (typeof scopedWorkspaceId === "string" && scopedWorkspaceId.trim()) return scopedWorkspaceId.trim();
  if (mention.referenceInsert?.kind === "mention") {
    const workspaceId = mention.referenceInsert.scope?.workspaceId;
    if (typeof workspaceId === "string" && workspaceId.trim()) return workspaceId.trim();
  }
  return undefined;
}

async function runTuttiJsonCommand(
  args: string[],
  cwd: string,
  state: TuttiCliRunState,
): Promise<unknown> {
  if (state.cancelled) throw new Error("Cancelled by user");
  const command = resolveTuttiCliCommand();
  const child = spawn(command, ["--json", ...args], {
    cwd,
    env: {
      ...process.env,
      PATH: augmentedTuttiCliPath(),
    },
    stdio: "pipe",
  });
  state.child = child;
  child.stdin.end();

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

  let code: number | null;
  let signal: NodeJS.Signals | null;
  try {
    [code, signal] = await Promise.race([
      once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>,
      once(child, "error").then(([error]) => {
        throw error instanceof Error ? error : new Error(String(error));
      }),
    ]);
  } catch (error) {
    state.child = null;
    throw new Error(`Unable to start Tutti CLI (${command}): ${error instanceof Error ? error.message : String(error)}`);
  }
  state.child = null;
  const stdout = stdoutChunks.join("").trim();
  const stderr = stderrChunks.join("").trim();
  if (state.cancelled) throw new Error("Cancelled by user");
  if (code !== 0) {
    throw new Error(`tutti ${args.join(" ")} exited with ${code ?? signal ?? "unknown"}${stderr ? `: ${stderr}` : ""}`);
  }
  return parseTuttiJsonOutput(stdout);
}

function resolveTuttiCliCommand() {
  const candidates = [
    process.env.GROUP_CHAT_TUTTI_CLI_PATH,
    process.env.TUTTI_CLI_PATH,
    process.env.TUTTI_CLI,
    process.env.TUTTI_BINARY,
    process.env.HOME ? join(process.env.HOME, ".tutti", "bin", "tutti") : null,
    "/opt/homebrew/bin/tutti",
    "/usr/local/bin/tutti",
  ];
  for (const candidate of candidates) {
    const command = candidate?.trim();
    if (command && existsSync(command)) return command;
  }
  return "tutti";
}

function augmentedTuttiCliPath() {
  const paths = [
    process.env.HOME ? join(process.env.HOME, ".tutti", "bin") : null,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH,
  ].filter((item): item is string => Boolean(item?.trim()));
  return [...new Set(paths)].join(":");
}

function parseTuttiJsonOutput(stdout: string) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    const firstObject = stdout.indexOf("{");
    const firstArray = stdout.indexOf("[");
    const start = firstObject < 0 ? firstArray : firstArray < 0 ? firstObject : Math.min(firstObject, firstArray);
    if (start < 0) throw new Error(`Tutti CLI did not return JSON: ${stdout.slice(0, 240)}`);
    return JSON.parse(stdout.slice(start));
  }
}

function failedToolResult(id: string, name: string, error: unknown): RuntimeStreamEvent {
  return {
    type: "tool_result",
    id,
    name,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    isError: true,
  };
}

function titleFromPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 40) || "Vibe Design prototype";
}

function readStringPath(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function summarizeVibeDesignProject(payload: unknown) {
  return {
    projectId: readStringPath(payload, ["project", "id"]),
    conversationId: readStringPath(payload, ["conversationId"]),
  };
}

function summarizeVibeDesignSession(payload: unknown) {
  return {
    status: readStringPath(payload, ["status"]),
    provider: readStringPath(payload, ["provider"]),
    conversationId: readStringPath(payload, ["conversationId"]),
    fallback: readStringPath(payload, ["agentFallback", "message"]),
  };
}

function extractVibeDesignFiles(payload: unknown): VibeDesignFile[] {
  const candidates = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).files ?? (payload as Record<string, unknown>).resources
      : null;
  if (!Array.isArray(candidates)) return [];
  const files: VibeDesignFile[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string"
      ? record.name
      : typeof record.path === "string"
        ? record.path
        : "";
    if (!name) continue;
    files.push({
      name,
      url: typeof record.url === "string"
        ? record.url
        : typeof record.staticUrl === "string"
          ? record.staticUrl
          : undefined,
    });
  }
  return files;
}

function formatVibeDesignFinalReply(input: {
  projectId: string;
  conversationId: string | null;
  provider: string | null;
  fallback: string | null;
  files: VibeDesignFile[];
  workspaceId?: string;
}) {
  const projectLink = input.workspaceId
    ? `mention://workspace-app/vibe-design?workspaceId=${encodeURIComponent(input.workspaceId)}&projectId=${encodeURIComponent(input.projectId)}`
    : `mention://workspace-app/vibe-design?projectId=${encodeURIComponent(input.projectId)}`;
  const lines = [
    `Vibe Design 已完成生成：[打开项目](${projectLink})`,
    "",
    `项目 ID：\`${input.projectId}\``,
    input.conversationId ? `会话 ID：\`${input.conversationId}\`` : null,
    input.provider ? `执行 Agent：\`${input.provider}\`` : null,
    input.fallback ? `运行切换：${input.fallback}` : null,
  ].filter((line): line is string => Boolean(line));

  if (input.files.length) {
    lines.push("", "生成文件：");
    for (const file of input.files.slice(0, 8)) {
      lines.push(file.url ? `- [${file.name}](${file.url})` : `- \`${file.name}\``);
    }
  }
  return `${lines.join("\n")}\n`;
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
    "Your intermediate planning, checks, and progress narration are shown in the thinking/process panel. Keep the final reply for the conversation concise: only the final result, important file/resource links, or a brief blocker.",
    "Do not use tools to send the same reply again. Only use messaging tools for intentional additional side messages.",
    "When using a skill, do not include the skill's file path, README, SKILL.md contents, setup notes, or internal instructions in your reply. Only report the user-facing result, concise progress, or a brief blocker.",
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
