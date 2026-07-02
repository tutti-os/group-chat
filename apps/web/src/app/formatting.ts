import type { Message, ParticipantListenMode } from "@group-chat/shared";
import { t } from "./i18n/index.js";

export function formatMessageStatus(status: Message["status"]) {
  if (status === "success") return "";
  if (status === "streaming") return "";
  if (status === "deleted") return "";
  if (status === "recalled") return "";
  if (status === "pending") return t("message.status.pending");
  if (status === "error") return t("message.status.error");
  if (status === "cancelled") return t("message.status.cancelled");
  return status;
}

export function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function listenModeLabel(mode: ParticipantListenMode) {
  if (mode === "active") return "A";
  if (mode === "passive") return "P";
  return "Ad";
}

export function listenModeTitle(mode: ParticipantListenMode) {
  if (mode === "active") return t("listenMode.active");
  if (mode === "passive") return t("listenMode.passive");
  return t("listenMode.adaptive");
}

export function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatConversationListTimestamp(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",").at(-1)! : result);
    };
    reader.readAsDataURL(file);
  });
}

export function truncateMiddle(text: string, maxLength: number, ellipsis = "...") {
  const normalized = text.trim();
  if (maxLength <= ellipsis.length || normalized.length <= maxLength) return normalized;
  const keep = maxLength - ellipsis.length;
  const headLength = Math.ceil(keep / 2);
  const tailLength = Math.floor(keep / 2);
  return `${normalized.slice(0, headLength)}${ellipsis}${normalized.slice(-tailLength)}`;
}
