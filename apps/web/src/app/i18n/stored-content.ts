import { t } from "./translate.js";

export function attachmentLabel() {
  return t("common.attachment");
}

export function translateSystemNotice(content: string) {
  const text = content.trim();
  if (!text) return text;

  const joinedZh = text.match(/^(.+) 加入了群聊$/);
  if (joinedZh) return t("system.participantJoined", { name: joinedZh[1]! });

  const joinedEn = text.match(/^(.+) joined the room$/);
  if (joinedEn) return t("system.participantJoined", { name: joinedEn[1]! });

  if (text === "消息已撤回" || text === "Message recalled") {
    return t("system.messageRecalled");
  }

  return text;
}

const AGENT_ERROR_PATTERNS: Array<[RegExp, string, (match: RegExpMatchArray) => Record<string, string> | undefined]> = [
  [/^Agent 执行结束，但未返回文本回复。$/, "agentError.noTextReplyAfterRun", () => undefined],
  [/^Agent execution finished without a text reply\.$/, "agentError.noTextReplyAfterRun", () => undefined],
  [/^Agent 未返回任何内容。$/, "agentError.noContent", () => undefined],
  [/^Agent returned no content\.$/, "agentError.noContent", () => undefined],
  [/^Agent 执行失败。$/, "agentError.failed", () => undefined],
  [/^Agent execution failed\.$/, "agentError.failed", () => undefined],
  [/^Agent 执行超时或已被中断。$/, "agentError.timeout", () => undefined],
  [/^Agent execution timed out or was interrupted\.$/, "agentError.timeout", () => undefined],
  [/^Agent 执行异常退出。$/, "agentError.abnormalExit", () => undefined],
  [/^Agent exited abnormally\.$/, "agentError.abnormalExit", () => undefined],
  [/^Agent 执行异常退出：(.+)$/, "agentError.abnormalExitWithDetail", (match) => ({ detail: match[1]! })],
  [/^Agent exited abnormally: (.+)$/, "agentError.abnormalExitWithDetail", (match) => ({ detail: match[1]! })],
  [/^Agent 执行失败：(.+)$/, "agentError.failedWithDetail", (match) => ({ detail: match[1]! })],
  [/^Agent execution failed: (.+)$/, "agentError.failedWithDetail", (match) => ({ detail: match[1]! })],
];

export function translateAgentError(error: string) {
  const raw = error.trim();
  if (!raw) return t("agentError.failed");

  for (const [pattern, key, params] of AGENT_ERROR_PATTERNS) {
    const match = raw.match(pattern);
    if (match) return t(key, params(match));
  }

  if (/^Agent (执行|未)/.test(raw)) return raw;
  return t("agentError.failedWithDetail", { detail: raw });
}
