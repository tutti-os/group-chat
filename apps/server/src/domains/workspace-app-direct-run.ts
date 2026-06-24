import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { MentionTarget } from "@group-chat/shared";

const execFileAsync = promisify(execFile);
const TUTTI_CLI_TIMEOUT_MS = 20 * 60 * 1000;
const TUTTI_CLI_MAX_BUFFER = 20 * 1024 * 1024;

export interface DirectWorkspaceAppIntent {
  appId: string;
  label: string;
  prompt: string;
  workspaceId: string | null;
  iconUrl: string | null;
}

export interface DirectWorkspaceAppRunResult {
  appId: string;
  label: string;
  prompt: string;
  projectId: string | null;
  conversationId: string | null;
  workspaceId: string | null;
  iconUrl: string | null;
  fallbackProvider: string | null;
}

type JsonRecord = Record<string, unknown>;

export function resolveDirectWorkspaceAppIntent(
  content: string,
  mentions: Array<Pick<
    MentionTarget,
    "mentionType" | "displayNameSnapshot" | "referenceProviderId" | "referenceEntityId" | "referenceInsert" | "referenceScope"
  >>,
): DirectWorkspaceAppIntent | null {
  const appMention = mentions.find((mention) =>
    mention.mentionType === "reference"
    && mention.referenceProviderId === "workspace-app"
    && mention.referenceEntityId?.trim()
  );
  if (!appMention?.referenceEntityId) return null;

  const appId = appMention.referenceEntityId.trim();
  const label = appMention.displayNameSnapshot.trim()
    || (appMention.referenceInsert?.kind === "mention" ? appMention.referenceInsert.label.trim() : "")
    || appId;
  const scope = appMention.referenceInsert?.kind === "mention"
    ? appMention.referenceInsert.scope
    : appMention.referenceScope;
  const prompt = stripWorkspaceAppMentionText(content, {
    appId,
    label,
    mentionLabels: mentions
      .map((mention) => mention.displayNameSnapshot.trim())
      .filter(Boolean),
  });
  if (!prompt) return null;

  return {
    appId,
    label,
    prompt,
    workspaceId: scope?.workspaceId?.trim() || null,
    iconUrl: scope?.iconUrl?.trim() || null,
  };
}

export function workspaceAppStartMessage(intent: DirectWorkspaceAppIntent) {
  return `正在调用 ${intent.label} 处理：${intent.prompt}`;
}

export function workspaceAppResultMessage(result: DirectWorkspaceAppRunResult) {
  const href = buildWorkspaceAppMentionHref(result);
  const link = href ? `[在 ${result.label} 中打开](${href})` : result.label;
  const fallback = result.fallbackProvider ? `\n\n已自动切换到 ${result.fallbackProvider} 执行。` : "";
  return `${result.label} 已完成。\n\n${link}${fallback}`;
}

export function workspaceAppFailureMessage(intent: DirectWorkspaceAppIntent, error: unknown) {
  return `${intent.label} 调用失败：${errorMessage(error)}`;
}

export function workspaceAppMentionTarget(result: DirectWorkspaceAppRunResult): MentionTarget[] {
  const scope: Record<string, string> = {};
  if (result.workspaceId) scope.workspaceId = result.workspaceId;
  if (result.iconUrl) scope.iconUrl = result.iconUrl;
  if (result.projectId) scope.projectId = result.projectId;
  if (result.conversationId) scope.conversationId = result.conversationId;
  return [{
    participantId: `tutti-at:workspace-app:${result.appId}`,
    displayNameSnapshot: result.label,
    mentionType: "reference",
    referenceProviderId: "workspace-app",
    referenceEntityId: result.appId,
    referenceScope: scope,
    referenceInsert: {
      kind: "mention",
      entityId: result.appId,
      label: result.label,
      scope,
    },
  }];
}

export async function runDirectWorkspaceAppCli(intent: DirectWorkspaceAppIntent): Promise<DirectWorkspaceAppRunResult> {
  if (intent.appId !== "vibe-design") {
    throw new Error(`${intent.label} 暂不支持在群聊中直接调用 CLI`);
  }
  return runVibeDesignCli(intent);
}

function stripWorkspaceAppMentionText(content: string, app: { appId: string; label: string; mentionLabels: string[] }) {
  const escapedAppId = escapeRegExp(app.appId);
  const escapedLabel = escapeRegExp(app.label);
  let result = content
    .replace(new RegExp(`\\[([^\\]]+)\\]\\(mention://workspace-app/${escapedAppId}[^)]*\\)`, "giu"), " ")
    .replace(new RegExp(`\\[([^\\]]+)\\]\\(group-chat://reference/workspace-app/${escapedAppId}[^)]*\\)`, "giu"), " ")
    .replace(/\[([^\]]+)\]\(group-chat:\/\/participant\/[^)]*\)/giu, " ")
    .replace(/\[([^\]]+)\]\(mention:\/\/agent-session\/[^)]*\)/giu, " ")
    .replace(new RegExp(`@?${escapedLabel}`, "giu"), " ")
    .replace(new RegExp(`@?${escapedAppId}`, "giu"), " ")
    .trim();

  for (const label of app.mentionLabels) {
    result = result.replace(new RegExp(`@?${escapeRegExp(label)}`, "giu"), " ");
  }

  result = result.replace(/[ \t]{2,}/g, " ").trim();

  result = result
    .replace(/^(?:请|麻烦你|麻烦|帮我)?\s*用\s*(?=(?:做|创建|生成|设计|开发|实现|制作|写|改|打开|搜索|查|整理))/u, "")
    .replace(/^(?:请|麻烦你|麻烦|帮我)?\s*(?:让|叫)\s*(?=(?:做|创建|生成|设计|开发|实现|制作|写|改|打开|搜索|查|整理))/u, "")
    .replace(/^[，,。；;：:\s]+/u, "")
    .trim();
  return result;
}

async function runVibeDesignCli(intent: DirectWorkspaceAppIntent): Promise<DirectWorkspaceAppRunResult> {
  const created = await runTuttiJson([
    "vibe-design",
    "project-create",
    "--prompt",
    intent.prompt,
    "--title",
    intent.prompt,
    "--json",
  ]);
  const project = isRecord(created.project) ? created.project : {};
  const projectId = stringValue(project.id);
  if (!projectId) {
    throw new Error("Vibe Design 没有返回 project id");
  }
  const initialConversationId = stringValue(created.conversationId);
  const sessionArgs = [
    "vibe-design",
    "session-start",
    "--project-id",
    projectId,
    "--prompt",
    intent.prompt,
    "--json",
  ];
  if (initialConversationId) {
    sessionArgs.splice(4, 0, "--conversation-id", initialConversationId);
  }
  const session = await runTuttiJson(sessionArgs);
  return {
    appId: intent.appId,
    label: intent.label,
    prompt: intent.prompt,
    projectId,
    conversationId: stringValue(session.conversationId) || initialConversationId || null,
    workspaceId: intent.workspaceId,
    iconUrl: intent.iconUrl,
    fallbackProvider: resolveFallbackProvider(session),
  };
}

async function runTuttiJson(args: string[]): Promise<JsonRecord> {
  const { stdout, stderr } = await execFileAsync(resolveTuttiCliBinary(), args, {
    timeout: TUTTI_CLI_TIMEOUT_MS,
    maxBuffer: TUTTI_CLI_MAX_BUFFER,
  });
  const parsed = parseJsonOutput(stdout);
  if (parsed) return parsed;
  const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
  throw new Error(detail || "Tutti CLI 没有返回 JSON");
}

export function resolveTuttiCliBinary() {
  const configured = process.env.GROUP_CHAT_TUTTI_CLI?.trim() || process.env.TUTTI_CLI?.trim();
  if (configured) return configured;
  const bundled = join(homedir(), ".tutti", "bin", "tutti");
  if (existsSync(bundled)) return bundled;
  return "tutti";
}

function buildWorkspaceAppMentionHref(result: DirectWorkspaceAppRunResult) {
  if (!result.workspaceId) return null;
  const url = new URL(`mention://workspace-app/${encodeURIComponent(result.appId)}`);
  url.searchParams.set("workspaceId", result.workspaceId);
  if (result.iconUrl) url.searchParams.set("iconUrl", result.iconUrl);
  if (result.projectId) url.searchParams.set("projectId", result.projectId);
  if (result.conversationId) url.searchParams.set("conversationId", result.conversationId);
  return url.toString();
}

function resolveFallbackProvider(output: JsonRecord) {
  const fallback = isRecord(output.agentFallback) ? output.agentFallback : null;
  return stringValue(fallback?.provider) || stringValue(fallback?.agentId) || null;
}

function parseJsonOutput(stdout: string): JsonRecord | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  return message.length > 1200 ? `${message.slice(0, 1200)}...` : message;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
