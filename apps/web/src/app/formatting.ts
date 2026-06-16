import type { Message, ParticipantListenMode } from "@group-chat/shared";

export function formatMessageStatus(status: Message["status"]) {
  if (status === "success") return "";
  if (status === "streaming") return "";
  if (status === "pending") return "等待中";
  if (status === "error") return "失败";
  if (status === "cancelled") return "已取消";
  return status;
}

export function listenModeLabel(mode: ParticipantListenMode) {
  if (mode === "active") return "A";
  if (mode === "passive") return "P";
  return "Ad";
}

export function listenModeTitle(mode: ParticipantListenMode) {
  if (mode === "active") return "Active";
  if (mode === "passive") return "Passive";
  return "Adaptive";
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
