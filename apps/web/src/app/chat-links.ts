import type { Artifact, Message, Participant, PrivateTaskSnapshot, Identity } from "@group-chat/shared";
import type { BackgroundTask } from "./background-tasks.js";
import { truncateMiddle } from "./formatting.js";
import { loadUserProfile, resolveDefaultDisplayName, resolveProfileDisplayName } from "./user-profile.js";
import { attachmentLabel, t } from "./i18n/index.js";

export const SUMMARY_LINK_MIME = "text/x-group-chat-summary-link";
export const ARTIFACT_CLIPBOARD_MIME = "application/x-group-chat-artifacts+json";
const SUMMARY_LINK_CLIPBOARD_KEY = "group-chat:summary-link";
const ARTIFACT_CLIPBOARD_KEY = "group-chat:artifact-ids";

const MESSAGE_ID_SEGMENT = "[A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*";
const MESSAGE_LINK_PATTERN = new RegExp(`\\bgroup-chat://message/(${MESSAGE_ID_SEGMENT})`, "g");
const SUMMARY_LINK_PATTERN = /\bgroup-chat:\/\/summary\/([A-Za-z0-9_-]+)/g;
const EMBEDDED_LINK_PATTERN = new RegExp(`\\bgroup-chat://(?:message/${MESSAGE_ID_SEGMENT}|summary/[A-Za-z0-9_-]+)`, "g");
const MESSAGE_LINK_LABEL_MAX_LENGTH = 28;

export function parseMessageLinkIds(value: string) {
  const segment = value.includes("group-chat://message/")
    ? value.replace(/^.*group-chat:\/\/message\//, "")
    : value;
  return segment.split(",").map((item) => item.trim()).filter(Boolean);
}

export function primaryMessageLinkId(value: string) {
  return parseMessageLinkIds(value)[0] ?? "";
}

export function formatMessageLink(...messageIds: string[]) {
  const uniqueIds = [...new Set(messageIds.map((item) => item.trim()).filter(Boolean))];
  return uniqueIds.length ? `group-chat://message/${uniqueIds.join(",")}` : "";
}

export function formatMessageLinkLabel(
  messageIdSegment: string,
  messages: Message[],
  participants: Participant[],
  identities: Array<Pick<Identity, "id" | "name">> = [],
  userDisplayName?: string | null,
) {
  const messageIds = parseMessageLinkIds(messageIdSegment);
  if (!messageIds.length) return t("composer.messageLink");

  const senders: string[] = [];
  const seenSenders = new Set<string>();
  for (const messageId of messageIds) {
    const message = messages.find((item) => item.id === messageId) ?? null;
    if (!message) continue;
    const sender = messageSenderLabel(message, participants, identities, userDisplayName);
    if (seenSenders.has(sender)) continue;
    seenSenders.add(sender);
    senders.push(sender);
  }
  if (!senders.length) return t("composer.messageLink");

  let senderPhrase: string;
  if (senders.length === 1) {
    senderPhrase = senders[0]!;
  } else if (senders.length === 2) {
    senderPhrase = t("composer.messageLinkSendersTwo", { first: senders[0]!, second: senders[1]! });
  } else {
    senderPhrase = t("composer.messageLinkSendersMany", { first: senders[0]!, second: senders[1]! });
  }

  return t("composer.messageLinkFrom", {
    sender: truncateMiddle(senderPhrase, MESSAGE_LINK_LABEL_MAX_LENGTH),
  });
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
  if (explicit) return resolveProfileDisplayName(explicit);
  return resolveProfileDisplayName(loadUserProfile().displayName) || resolveDefaultDisplayName();
}


export function resolveMessageSenderLabel(
  message: Message,
  participant: Participant | null,
  identity?: Pick<Identity, "name"> | null,
  userDisplayName?: string | null,
) {
  if (message.role === "user") {
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
  return task ? t("summary.fromParticipant", { name: task.participantName }) : t("summary.title");
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
  const attachment = attachmentLabel();
  const parts = [t("summary.plainHeader", { name: input.task.participantName }), ""];
  parts.push(t("summary.plainSource"));
  if (input.sourceMessages.length) {
    for (const message of input.sourceMessages) {
      parts.push(`- ${messageSenderLabel(message, input.participants)}: ${compactInline(message.content || attachment)}`);
    }
  } else {
    parts.push(`- ${compactInline(input.task.sourcePreview || attachment)}`);
  }
  if (input.images.length) {
    parts.push("", t("summary.plainImages"), ...input.images.map((artifact) => `- ${artifact.filename}: ${artifact.publicUrl}`));
  }
  parts.push("", t("summary.plainResult"), input.task.content.trim() || t("summary.generating"));
  return parts.join("\n");
}

export function formatSummaryHtml(input: {
  task: BackgroundTask;
  sourceMessages: Message[];
  participants: Participant[];
  images: Artifact[];
}) {
  const attachment = attachmentLabel();
  const blocks = [`<h3>${escapeHtml(t("summary.title"))} - ${escapeHtml(input.task.participantName)}</h3>`, `<h4>${escapeHtml(t("summary.htmlSource"))}</h4>`];
  if (input.sourceMessages.length) {
    blocks.push(
      "<ul>",
      ...input.sourceMessages.map(
        (message) =>
          `<li><strong>${escapeHtml(messageSenderLabel(message, input.participants))}</strong>: ${escapeHtml(compactInline(message.content || attachment))}</li>`,
      ),
      "</ul>",
    );
  } else {
    blocks.push(`<p>${escapeHtml(compactInline(input.task.sourcePreview || attachment))}</p>`);
  }
  if (input.images.length) {
    blocks.push(
      `<h4>${escapeHtml(t("summary.htmlImages"))}</h4>`,
      ...input.images.map(
        (artifact) => `<figure><img src="${escapeHtml(artifact.publicUrl)}" alt="${escapeHtml(artifact.filename)}" /><figcaption>${escapeHtml(artifact.filename)}</figcaption></figure>`,
      ),
    );
  }
  blocks.push(`<h4>${escapeHtml(t("summary.htmlResult"))}</h4>`, `<pre>${escapeHtml(input.task.content.trim() || t("summary.generating"))}</pre>`);
  return blocks.join("");
}

export function stashSummaryLinkForPaste(taskId: string) {
  sessionStorage.setItem(SUMMARY_LINK_CLIPBOARD_KEY, formatSummaryLink(taskId));
}

export function readStashedSummaryLink() {
  const link = sessionStorage.getItem(SUMMARY_LINK_CLIPBOARD_KEY);
  return link?.startsWith("group-chat://summary/") ? link : null;
}

export interface ArtifactClipboardPayload {
  artifactIds: string[];
  includeText: boolean;
  parts?: Array<
    | { type: "text"; content: string }
    | { type: "artifact"; artifactId: string }
  >;
  copyToken?: string;
  stashedAt?: number;
}

const ARTIFACT_CLIPBOARD_STASH_FALLBACK_MS = 30_000;

/** Plain-text marker written for image-only copies so paste can ignore OCR noise in text/plain. */
export const ARTIFACT_ONLY_CLIPBOARD_PLAIN = "\u200b";

export function isArtifactOnlyClipboardPlainText(text: string) {
  return text.replace(/\u200b/g, "").trim().length === 0;
}

function normalizeArtifactClipboardPayload(value: unknown): ArtifactClipboardPayload | null {
  if (Array.isArray(value)) {
    const artifactIds = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return artifactIds.length ? { artifactIds, includeText: true } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as { artifactIds?: unknown; includeText?: unknown; parts?: unknown };
  if (!Array.isArray(record.artifactIds)) return null;
  const artifactIds = record.artifactIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const parts: NonNullable<ArtifactClipboardPayload["parts"]> = [];
  if (Array.isArray(record.parts)) {
    for (const part of record.parts) {
      if (!part || typeof part !== "object") continue;
      const candidate = part as { type?: unknown; content?: unknown; artifactId?: unknown };
      if (candidate.type === "text" && typeof candidate.content === "string") {
        parts.push({ type: "text", content: candidate.content });
      } else if (candidate.type === "artifact" && typeof candidate.artifactId === "string") {
        parts.push({ type: "artifact", artifactId: candidate.artifactId });
      }
    }
  }
  if (!artifactIds.length && !parts.length) return null;
  return {
    artifactIds,
    includeText: record.includeText !== false,
    parts: parts.length ? parts : undefined,
    copyToken: typeof (record as { copyToken?: unknown }).copyToken === "string"
      ? (record as { copyToken: string }).copyToken
      : undefined,
    stashedAt: typeof (record as { stashedAt?: unknown }).stashedAt === "number"
      ? (record as { stashedAt: number }).stashedAt
      : undefined,
  };
}

export function stashArtifactsForPaste(input: ArtifactClipboardPayload) {
  const artifactIds = [...new Set(input.artifactIds.map((item) => item.trim()).filter(Boolean))];
  if (!artifactIds.length && !input.parts?.length) {
    sessionStorage.removeItem(ARTIFACT_CLIPBOARD_KEY);
    return;
  }
  sessionStorage.setItem(
    ARTIFACT_CLIPBOARD_KEY,
    JSON.stringify({
      artifactIds,
      includeText: input.includeText,
      parts: input.parts,
      copyToken: input.copyToken,
      stashedAt: Date.now(),
    } satisfies ArtifactClipboardPayload),
  );
}

export function readStashedArtifactClipboard(): ArtifactClipboardPayload | null {
  const raw = sessionStorage.getItem(ARTIFACT_CLIPBOARD_KEY);
  if (!raw) return null;
  try {
    return normalizeArtifactClipboardPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readStashedArtifactIds() {
  return readStashedArtifactClipboard()?.artifactIds ?? null;
}

export function clearArtifactClipboardStash() {
  sessionStorage.removeItem(ARTIFACT_CLIPBOARD_KEY);
}

export interface ArtifactClipboardReadResult extends ArtifactClipboardPayload {
  /** When true, pasted clipboard file blobs (e.g. spurious image/png) should be ignored. */
  preferOverClipboardFiles: boolean;
}

export function readArtifactClipboardFromDataTransfer(dataTransfer: DataTransfer): ArtifactClipboardReadResult | null {
  const fromMime = parseArtifactClipboardPayload(dataTransfer.getData(ARTIFACT_CLIPBOARD_MIME));
  if (fromMime) {
    return { ...resolveFreshArtifactClipboardPayload(fromMime), preferOverClipboardFiles: true };
  }

  const fromHtml = parseArtifactClipboardFromHtml(dataTransfer.getData("text/html"));
  if (fromHtml) {
    const freshPayload = resolveFreshArtifactClipboardPayload(fromHtml);
    return { ...freshPayload, preferOverClipboardFiles: true };
  }

  const fromStash = readRecentStashedArtifactClipboard();
  if (fromStash && shouldPreferRecentStashOverClipboard(dataTransfer)) {
    return { ...fromStash, preferOverClipboardFiles: true };
  }

  return null;
}

function readRecentStashedArtifactClipboard(): ArtifactClipboardPayload | null {
  const stash = readStashedArtifactClipboard();
  if (!stash || (!stash.artifactIds.length && !stash.parts?.length) || typeof stash.stashedAt !== "number") return null;
  if (Date.now() - stash.stashedAt > ARTIFACT_CLIPBOARD_STASH_FALLBACK_MS) return null;
  return stash;
}

export function readRecentArtifactClipboardStashForPaste(): ArtifactClipboardReadResult | null {
  const stash = readRecentStashedArtifactClipboard();
  return stash ? { ...stash, preferOverClipboardFiles: true } : null;
}

function shouldPreferRecentStashOverClipboard(dataTransfer: DataTransfer) {
  const plainText = dataTransfer.getData("text/plain");
  if (plainText.trim() && !isArtifactOnlyClipboardPlainText(plainText)) return false;
  return plainText.includes(ARTIFACT_ONLY_CLIPBOARD_PLAIN);
}

function resolveFreshArtifactClipboardPayload(payload: ArtifactClipboardPayload): ArtifactClipboardPayload {
  const fromStash = readStashedArtifactClipboard();
  if (!fromStash?.artifactIds.length) return payload;
  if (!payload.copyToken || !fromStash.copyToken || payload.copyToken !== fromStash.copyToken) {
    return fromStash;
  }
  return {
    ...payload,
    parts: payload.parts ?? fromStash.parts,
  };
}

export function parseArtifactClipboardPayload(payload: string): ArtifactClipboardPayload | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  try {
    return normalizeArtifactClipboardPayload(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

export function parseArtifactIdsFromClipboardHtml(html: string) {
  return parseArtifactClipboardFromHtml(html)?.artifactIds ?? null;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeClipboardHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br>");
}

function parseArtifactClipboardFromHtml(html: string): ArtifactClipboardPayload | null {
  if (!html.trim()) return null;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const embeddedPayload = doc.querySelector("[data-group-chat-copy-payload]")
      ?.getAttribute("data-group-chat-copy-payload");
    if (embeddedPayload) {
      const parsed = parseArtifactClipboardPayload(embeddedPayload);
      if (parsed) return parsed;
    }
    const ids = new Set<string>();
    let copyToken: string | undefined;
    const markedElements = doc.querySelectorAll("[data-artifact-id][data-group-chat-copy-token]");
    const elements = markedElements.length
      ? markedElements
      : doc.querySelectorAll("span[data-artifact-id]");
    for (const element of elements) {
      const artifactId = element.getAttribute("data-artifact-id")?.trim();
      if (artifactId) ids.add(artifactId);
      const elementCopyToken = element.getAttribute("data-group-chat-copy-token")?.trim();
      if (elementCopyToken) copyToken = elementCopyToken;
    }
    return ids.size ? { artifactIds: [...ids], includeText: true, copyToken } : null;
  } catch {
    return null;
  }
}

export type MessageClipboardInput = {
  text: string;
  artifactIds: string[];
  includeText?: boolean;
  parts?: ArtifactClipboardPayload["parts"];
};

function buildMessageClipboardData(input: MessageClipboardInput) {
  const artifactIds = [...new Set(input.artifactIds.map((item) => item.trim()).filter(Boolean))];
  const includeText = input.includeText ?? true;
  clearArtifactClipboardStash();
  const clipboardPayload: ArtifactClipboardPayload | null = artifactIds.length || input.parts?.length
    ? { artifactIds, includeText, parts: input.parts, copyToken: crypto.randomUUID() }
    : null;
  if (clipboardPayload) {
    stashArtifactsForPaste(clipboardPayload);
  }

  const plainText = includeText ? input.text : ARTIFACT_ONLY_CLIPBOARD_PLAIN;
  const payload = clipboardPayload ? JSON.stringify(clipboardPayload) : "";
  const htmlText = clipboardPayload
    ? `<span data-group-chat-copy-payload="${escapeHtmlAttribute(payload)}"></span>${includeText && input.text ? `<span data-group-chat-copy-text>${escapeClipboardHtmlText(input.text)}</span>` : ""}${artifactIds.map((artifactId) =>
        `<span data-artifact-id="${escapeHtmlAttribute(artifactId)}" data-group-chat-copy-token="${escapeHtmlAttribute(clipboardPayload.copyToken ?? "")}">${ARTIFACT_ONLY_CLIPBOARD_PLAIN}</span>`,
      ).join("")}`
    : "";
  return { htmlText, payload, plainText };
}

export function copyMessagesToClipboardEvent(event: globalThis.ClipboardEvent, input: MessageClipboardInput) {
  const data = buildMessageClipboardData(input);
  event.preventDefault();
  event.clipboardData?.setData("text/plain", data.plainText);
  if (data.payload) event.clipboardData?.setData(ARTIFACT_CLIPBOARD_MIME, data.payload);
  if (data.htmlText) event.clipboardData?.setData("text/html", data.htmlText);
}

export async function copyMessagesToClipboard(input: MessageClipboardInput) {
  const { htmlText, payload, plainText } = buildMessageClipboardData(input);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const items: Record<string, Blob> = {
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      };
      if (payload) {
        items[ARTIFACT_CLIPBOARD_MIME] = new Blob([payload], { type: ARTIFACT_CLIPBOARD_MIME });
      }
      if (htmlText) {
        items["text/html"] = new Blob([htmlText], { type: "text/html" });
      }
      await navigator.clipboard.write([new ClipboardItem(items)]);
      return;
    }
  } catch {
    // ClipboardItem 可能因权限或不支持的 MIME 失败，继续 fallback
  }

  if (htmlText) {
    try {
      await copyRichFallback(htmlText, plainText);
      return;
    } catch {
      // ignore
    }
  }

  await copyTextFallback(plainText);
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
          [SUMMARY_LINK_MIME]: new Blob([formatSummaryLink(input.task.id)], { type: SUMMARY_LINK_MIME }),
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

async function copyRichFallback(html: string, plainText: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.setAttribute("contenteditable", "true");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  document.body.appendChild(container);
  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const copied = document.execCommand("copy");
  selection?.removeAllRanges();
  document.body.removeChild(container);
  if (!copied && plainText) {
    await copyTextFallback(plainText);
  }
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
  for (const match of value.matchAll(new RegExp(`\\bgroup-chat://(message)/(${MESSAGE_ID_SEGMENT})|(summary)/([A-Za-z0-9_-]+)`, "g"))) {
    const isMessage = Boolean(match[1]);
    const id = isMessage ? match[2] : match[4];
    const index = match.index ?? 0;
    if (!id) continue;
    matches.push({
      kind: isMessage ? "message" : "summary",
      id,
      index,
      length: match[0].length,
    });
  }
  return matches.sort((left, right) => left.index - right.index);
}
