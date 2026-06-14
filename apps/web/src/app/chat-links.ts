import type { Artifact, Message, Participant, PrivateTaskSnapshot, Identity } from "@group-chat/shared";
import type { BackgroundTask } from "./background-tasks.js";
import { loadUserProfile } from "./user-profile.js";

export const SUMMARY_LINK_MIME = "text/x-group-chat-summary-link";
const SUMMARY_LINK_CLIPBOARD_KEY = "group-chat:summary-link";

const MESSAGE_LINK_PATTERN = /\bgroup-chat:\/\/message\/([A-Za-z0-9_-]+)/g;
const SUMMARY_LINK_PATTERN = /\bgroup-chat:\/\/summary\/([A-Za-z0-9_-]+)/g;
const EMBEDDED_LINK_PATTERN = /\bgroup-chat:\/\/(?:message|summary)\/[A-Za-z0-9_-]+/g;

export function formatMessageLink(messageId: string) {
  return messageId ? `group-chat://message/${messageId}` : "";
}

export function formatSummaryLink(taskId: string) {
  return taskId ? `group-chat://summary/${taskId}` : "";
}

export function extractMessageLinks(content: string) {
  return Array.from(content.matchAll(MESSAGE_LINK_PATTERN), (match) => match[1]!).filter(Boolean);
}

export function extractSummaryLinks(content: string) {
  return Array.from(content.matchAll(SUMMARY_LINK_PATTERN), (match) => match[1]!).filter(Boolean);
}

export function collectSummaryTaskIds(
  messages: Array<Pick<Message, "content">>,
  blocks: Array<Pick<import("@group-chat/shared").MessageBlock, "content">>,
) {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const taskId of extractSummaryLinks(message.content)) ids.add(taskId);
  }
  for (const block of blocks) {
    for (const taskId of extractSummaryLinks(block.content)) ids.add(taskId);
  }
  return [...ids];
}

export function removeEmbeddedLinks(content: string) {
  return content.replace(EMBEDDED_LINK_PATTERN, "").replace(/\n{3,}/g, "\n\n");
}

export function resolveAgentProfileParticipant(
  participantId: string | null,
  conversationId: string | null,
  activeParticipants: Participant[],
  allParticipants: Participant[],
): Participant | null {
  if (!participantId || !conversationId) return null;

  const active = activeParticipants.find((item) => item.id === participantId);
  if (active) return active;

  return allParticipants.find(
    (item) => item.id === participantId && item.conversationId === conversationId,
  ) ?? null;
}

export function resolveMessageAgentParticipant(
  message: Pick<Message, "role" | "senderParticipantId" | "conversationId">,
  activeParticipants: Participant[],
  allParticipants: Participant[],
): Participant | null {
  if (message.role === "user" || !message.senderParticipantId) return null;

  const participant = resolveAgentProfileParticipant(
    message.senderParticipantId,
    message.conversationId,
    activeParticipants,
    allParticipants,
  );
  return participant?.kind === "ai" ? participant : null;
}

export function resolveLocalUserDisplayName(explicitName?: string | null) {
  const explicit = explicitName?.trim();
  if (explicit) return explicit;
  return loadUserProfile().displayName.trim() || "Group Chat";
}

const LEGACY_USER_SENDER_NAMES = new Set(["You", "Group Chat"]);

function isLegacyUserSenderName(name: string | null | undefined) {
  const trimmed = name?.trim();
  return !trimmed || LEGACY_USER_SENDER_NAMES.has(trimmed);
}

export function resolveMessageSenderLabel(
  message: Message,
  participant: Participant | null,
  identity?: Pick<Identity, "name"> | null,
  userDisplayName?: string | null,
) {
  if (message.role === "user") {
    const stored = message.senderName?.trim();
    if (stored && !isLegacyUserSenderName(stored)) return stored;
    return resolveLocalUserDisplayName(userDisplayName);
  }
  const roomAlias = participant?.displayName?.trim();
  if (roomAlias) return roomAlias;
  const identityName = identity?.name?.trim();
  if (identityName) return identityName;
  return message.senderName?.trim() || message.role;
}

export function messageSenderLabel(
  message: Message,
  participants: Participant[] = [],
  identities: Array<Pick<Identity, "id" | "name">> = [],
  userDisplayName?: string | null,
) {
  const participant = message.senderParticipantId
    ? participants.find((item) => item.id === message.senderParticipantId) ?? null
    : null;
  const identity = participant?.identityId
    ? identities.find((item) => item.id === participant.identityId) ?? null
    : null;
  return resolveMessageSenderLabel(message, participant, identity, userDisplayName);
}

export function summaryLinkLabel(task: Pick<PrivateTaskSnapshot, "participantName"> | null | undefined) {
  return task ? `来自 ${task.participantName} 的消息总结` : "消息总结";
}

export function resolveSourceMessages(task: Pick<BackgroundTask, "sourceMessageIds" | "sourceMessage">, messages: Message[]) {
  const resolved = task.sourceMessageIds
    .map((messageId) => messages.find((message) => message.id === messageId) ?? null)
    .filter((message): message is Message => Boolean(message));
  if (resolved.length) return resolved;
  return task.sourceMessage ? [task.sourceMessage] : [];
}

function compactInline(content: string) {
  return content.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatSummaryPlainText(input: {
  task: BackgroundTask;
  sourceMessages: Message[];
  participants: Participant[];
  images: Artifact[];
}) {
  const parts = [`【消息总结】${input.task.participantName}`, ""];
  parts.push("【原消息】");
  if (input.sourceMessages.length) {
    for (const message of input.sourceMessages) {
      parts.push(`- ${messageSenderLabel(message, input.participants)}: ${compactInline(message.content || "[附件]")}`);
    }
  } else {
    parts.push(`- ${compactInline(input.task.sourcePreview || "[附件]")}`);
  }
  if (input.images.length) {
    parts.push("", "【图片】", ...input.images.map((artifact) => `- ${artifact.filename}: ${artifact.publicUrl}`));
  }
  parts.push("", "【总结】", input.task.content.trim() || "总结生成中");
  return parts.join("\n");
}

export function formatSummaryHtml(input: {
  task: BackgroundTask;
  sourceMessages: Message[];
  participants: Participant[];
  images: Artifact[];
}) {
  const blocks = [`<h3>消息总结 - ${escapeHtml(input.task.participantName)}</h3>`, "<h4>原消息</h4>"];
  if (input.sourceMessages.length) {
    blocks.push(
      "<ul>",
      ...input.sourceMessages.map(
        (message) =>
          `<li><strong>${escapeHtml(messageSenderLabel(message, input.participants))}</strong>: ${escapeHtml(compactInline(message.content || "[附件]"))}</li>`,
      ),
      "</ul>",
    );
  } else {
    blocks.push(`<p>${escapeHtml(compactInline(input.task.sourcePreview || "[附件]"))}</p>`);
  }
  if (input.images.length) {
    blocks.push(
      "<h4>图片</h4>",
      ...input.images.map(
        (artifact) => `<figure><img src="${escapeHtml(artifact.publicUrl)}" alt="${escapeHtml(artifact.filename)}" /><figcaption>${escapeHtml(artifact.filename)}</figcaption></figure>`,
      ),
    );
  }
  blocks.push("<h4>总结</h4>", `<pre>${escapeHtml(input.task.content.trim() || "总结生成中")}</pre>`);
  return blocks.join("");
}

export function stashSummaryLinkForPaste(taskId: string) {
  sessionStorage.setItem(SUMMARY_LINK_CLIPBOARD_KEY, formatSummaryLink(taskId));
}

export function readStashedSummaryLink() {
  const link = sessionStorage.getItem(SUMMARY_LINK_CLIPBOARD_KEY);
  return link?.startsWith("group-chat://summary/") ? link : null;
}

export async function copySummaryToClipboard(input: {
  task: BackgroundTask;
  sourceMessages: Message[];
  participants: Participant[];
  images: Artifact[];
}) {
  const plainText = formatSummaryPlainText(input);
  const htmlText = formatSummaryHtml(input);

  stashSummaryLinkForPaste(input.task.id);

  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "text/html": new Blob([htmlText], { type: "text/html" }),
        }),
      ]);
      return;
    }
  } catch {
    // ClipboardItem 可能因权限或不支持的 MIME 失败，继续 fallback
  }

  try {
    await navigator.clipboard.writeText(plainText);
    return;
  } catch {
    // ignore
  }

  await copyTextFallback(plainText);
}

async function copyTextFallback(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

export type EmbeddedLinkMatch =
  | { kind: "message"; id: string; index: number; length: number }
  | { kind: "summary"; id: string; index: number; length: number };

export function findEmbeddedLinks(value: string): EmbeddedLinkMatch[] {
  const matches: EmbeddedLinkMatch[] = [];
  for (const match of value.matchAll(/\bgroup-chat:\/\/(message|summary)\/([A-Za-z0-9_-]+)/g)) {
    const kind = match[1];
    const id = match[2];
    const index = match.index ?? 0;
    if (!kind || !id) continue;
    matches.push({
      kind: kind === "summary" ? "summary" : "message",
      id,
      index,
      length: match[0].length,
    });
  }
  return matches.sort((left, right) => left.index - right.index);
}
