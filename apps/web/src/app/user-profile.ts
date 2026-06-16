import { t } from "./i18n/index.js";

export type AvatarPresetId =
  | "saiyan-01" | "saiyan-02" | "saiyan-03" | "saiyan-04" | "saiyan-05"
  | "saiyan-06" | "saiyan-07" | "saiyan-08" | "saiyan-09" | "saiyan-10"
  | "saiyan-11" | "saiyan-12" | "saiyan-13" | "saiyan-14" | "saiyan-15";

export interface LocalUserProfile {
  displayName: string;
  avatarPreset: AvatarPresetId;
  customAvatarUrl: string | null;
  bio: string;
}

export const AVATAR_PRESET_IDS: AvatarPresetId[] = [
  "saiyan-01", "saiyan-02", "saiyan-03", "saiyan-04", "saiyan-05",
  "saiyan-06", "saiyan-07", "saiyan-08", "saiyan-09", "saiyan-10",
  "saiyan-11", "saiyan-12", "saiyan-13", "saiyan-14", "saiyan-15",
];

export function avatarPresetLabel(preset: AvatarPresetId): string {
  return t(`avatarPreset.${preset}`);
}

export function defaultUserProfile(): LocalUserProfile {
  return {
    displayName: t("common.me"),
    avatarPreset: "saiyan-01",
    customAvatarUrl: null,
    bio: t("settings.account.defaultBio"),
  };
}

/** Static fallback for SSR / pre-i18n bootstrap. Prefer {@link defaultUserProfile} at runtime. */
export const DEFAULT_USER_PROFILE: LocalUserProfile = {
  displayName: "Me",
  avatarPreset: "saiyan-01",
  customAvatarUrl: null,
  bio: "Local-first agent group chat workspace.",
};

const STORAGE_KEY = "group-chat:user-profile";

const LEGACY_PRESET_MAP: Record<string, AvatarPresetId> = {
  "gradient-orange": "saiyan-01",
  "gradient-slate": "saiyan-07",
  "initials-by": "saiyan-09",
  "initials-im": "saiyan-14",
};

function isAvatarPresetId(value: unknown): value is AvatarPresetId {
  return typeof value === "string" && AVATAR_PRESET_IDS.includes(value as AvatarPresetId);
}

function normalizePreset(value: unknown): AvatarPresetId {
  if (isAvatarPresetId(value)) return value;
  if (typeof value === "string" && value in LEGACY_PRESET_MAP) {
    return LEGACY_PRESET_MAP[value]!;
  }
  return DEFAULT_USER_PROFILE.avatarPreset;
}

const LEGACY_DEFAULT_DISPLAY_NAMES = new Set(["Group Chat", "Me", "我"]);

function normalizeDisplayName(value: unknown) {
  const fallback = defaultUserProfile().displayName;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || LEGACY_DEFAULT_DISPLAY_NAMES.has(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function loadUserProfile(): LocalUserProfile {
  if (typeof window === "undefined") return DEFAULT_USER_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultUserProfile();
    const parsed = JSON.parse(raw) as Partial<LocalUserProfile>;
    const profile: LocalUserProfile = {
      displayName: normalizeDisplayName(parsed.displayName),
      avatarPreset: normalizePreset(parsed.avatarPreset),
      customAvatarUrl: typeof parsed.customAvatarUrl === "string" && parsed.customAvatarUrl.startsWith("data:image/")
        ? parsed.customAvatarUrl
        : null,
      bio: typeof parsed.bio === "string" ? parsed.bio : defaultUserProfile().bio,
    };
    const legacyName = typeof parsed.displayName === "string" ? parsed.displayName.trim() : "";
    if (legacyName && LEGACY_DEFAULT_DISPLAY_NAMES.has(legacyName)) {
      saveUserProfile(profile);
    }
    return profile;
  } catch {
    return defaultUserProfile();
  }
}

export function saveUserProfile(profile: LocalUserProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function resolveUserProfileAvatar(profile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">) {
  return profile.customAvatarUrl ? "custom" as const : profile.avatarPreset;
}
