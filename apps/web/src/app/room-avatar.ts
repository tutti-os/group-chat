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
    throw new Error("请选择图片文件");
  }
  if (file.size > ROOM_AVATAR_MAX_BYTES) {
    throw new Error("图片不能超过 512KB");
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}
