import type { Message, ParticipantListenMode } from "@group-chat/shared";

export function formatMessageStatus(status: Message["status"]) {
  if (status === "success") return "";
  if (status === "streaming") return "";
  if (status === "pending") return "Pending";
  if (status === "error") return "Error";
  if (status === "cancelled") return "Cancelled";
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
