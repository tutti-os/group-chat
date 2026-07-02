import { t } from "./i18n/index.js";

export const ROOM_AVATAR_EMOJIS = [
  "💬",
  "🤖",
  "🎯",
  "🚀",
  "✨",
  "📊",
  "🧠",
  "🔬",
  "🎨",
  "💡",
  "📁",
  "🌐",
  "⚡",
  "🛠️",
  "📝",
  "🎮",
  "🏠",
  "🔥",
] as const;

export function getRoomAvatarInitial(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "G";
  return Array.from(trimmed)[0] ?? "G";
}

const DEFAULT_ROOM_AVATAR_COLORS = [
  "var(--black-stationary)",
  "var(--accent-codex)",
  "var(--tutti-purple)",
  "var(--accent-claude)",
  "var(--state-success)",
  "var(--state-warning)",
  "var(--folder)",
] as const;

export function getDefaultRoomAvatarBackground(seed: string): string {
  const normalizedSeed = seed.trim() || "default-room-avatar";
  let hash = 0;
  for (const char of normalizedSeed) {
    hash = ((hash << 5) - hash + char.codePointAt(0)!) | 0;
  }
  return DEFAULT_ROOM_AVATAR_COLORS[Math.abs(hash) % DEFAULT_ROOM_AVATAR_COLORS.length]!;
}

export function hasCustomRoomAvatar(avatar: string | null | undefined): boolean {
  return isRoomEmojiAvatar(avatar) || isRoomImageAvatar(avatar);
}

export function getRoomAvatarLabel(title: string, avatar: string | null | undefined): string {
  if (hasCustomRoomAvatar(avatar)) {
    return avatar!.trim();
  }
  return getRoomAvatarInitial(title);
}

export function normalizeIdentityIcon(icon: string | null | undefined): string {
  return hasCustomRoomAvatar(icon) ? icon!.trim() : "";
}

function normalizeEmoji(value: string): string {
  return value.normalize("NFC");
}

export function isRoomEmojiAvatar(avatar: string | null | undefined): boolean {
  const trimmed = avatar?.trim();
  if (!trimmed) return false;
  const normalized = normalizeEmoji(trimmed);
  return ROOM_AVATAR_EMOJIS.some((emoji) => normalizeEmoji(emoji) === normalized);
}

export function isRoomImageAvatar(avatar: string | null | undefined): boolean {
  const trimmed = avatar?.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("data:image/")
    || trimmed.startsWith("/local-assets/")
    || /^https?:\/\//.test(trimmed)
  );
}

const ROOM_AVATAR_MAX_BYTES = 512 * 1024;

export async function readRoomAvatarImageFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error(t("upload.pickImage"));
  }
  if (file.size > ROOM_AVATAR_MAX_BYTES) {
    throw new Error(t("upload.imageTooLarge512kb"));
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(t("upload.readFailed")));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}
