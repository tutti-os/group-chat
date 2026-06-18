import { fetchUserProfile, saveUserProfileRemote } from "../api/client.js";
import { getLocale, t, translate } from "./i18n/index.js";

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

/** Static fallback for SSR / pre-i18n bootstrap. */
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

const LEGACY_DEFAULT_DISPLAY_NAMES = new Set(["Group Chat", "Me", "我", "common.me"]);

const LEGACY_DEFAULT_BIOS = new Set([
  DEFAULT_USER_PROFILE.bio,
  "Local-first agent group chat workspace.",
  "本地优先的 Agent 群聊工作区。",
  "settings.account.defaultBio",
]);

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

export function resolveDefaultDisplayName(): string {
  const translated = translate("common.me");
  if (translated !== "common.me") return translated;
  return getLocale() === "zh-CN" ? "我" : "Me";
}

function resolveDefaultBio(): string {
  const translated = translate("settings.account.defaultBio");
  if (translated !== "settings.account.defaultBio") return translated;
  return DEFAULT_USER_PROFILE.bio;
}

export function defaultUserProfile(): LocalUserProfile {
  return {
    displayName: resolveDefaultDisplayName(),
    avatarPreset: DEFAULT_USER_PROFILE.avatarPreset,
    customAvatarUrl: null,
    bio: resolveDefaultBio(),
  };
}

export function isLegacyDefaultDisplayName(value: string | null | undefined): boolean {
  if (!value?.trim()) return true;
  return LEGACY_DEFAULT_DISPLAY_NAMES.has(value.trim());
}

function isLegacyDefaultBio(value: string | null | undefined): boolean {
  if (!value?.trim()) return true;
  return LEGACY_DEFAULT_BIOS.has(value.trim());
}

export function resolveProfileDisplayName(displayName: string): string {
  if (isLegacyDefaultDisplayName(displayName)) return resolveDefaultDisplayName();
  return displayName.trim();
}

function normalizeDisplayName(value: unknown) {
  if (typeof value !== "string") return resolveDefaultDisplayName();
  const trimmed = value.trim();
  if (!trimmed || LEGACY_DEFAULT_DISPLAY_NAMES.has(trimmed)) {
    return resolveDefaultDisplayName();
  }
  return trimmed;
}

function normalizeBio(value: unknown) {
  if (typeof value !== "string" || isLegacyDefaultBio(value)) return resolveDefaultBio();
  return value;
}

function normalizeProfile(parsed: Partial<LocalUserProfile>): LocalUserProfile {
  return {
    displayName: normalizeDisplayName(parsed.displayName),
    avatarPreset: normalizePreset(parsed.avatarPreset),
    customAvatarUrl:
      typeof parsed.customAvatarUrl === "string" && parsed.customAvatarUrl.startsWith("data:image/")
        ? parsed.customAvatarUrl
        : null,
    bio: normalizeBio(parsed.bio),
  };
}

function readStoredProfile(): LocalUserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw) as Partial<LocalUserProfile>);
  } catch {
    return null;
  }
}

function writeStoredProfile(profile: LocalUserProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

function profileHasCustomData(profile: LocalUserProfile): boolean {
  return (
    !isLegacyDefaultDisplayName(profile.displayName)
    || profile.customAvatarUrl !== null
    || profile.avatarPreset !== DEFAULT_USER_PROFILE.avatarPreset
    || !isLegacyDefaultBio(profile.bio)
  );
}

async function persistUserProfileRemote(profile: LocalUserProfile): Promise<void> {
  try {
    await saveUserProfileRemote(profile);
  } catch {
    // Server may be unavailable during standalone dev; localStorage remains the cache.
  }
}

export function loadUserProfile(): LocalUserProfile {
  if (typeof window === "undefined") return DEFAULT_USER_PROFILE;
  return readStoredProfile() ?? defaultUserProfile();
}

export async function hydrateUserProfile(): Promise<LocalUserProfile> {
  const local = loadUserProfile();
  try {
    const { profile: remoteRaw } = await fetchUserProfile();
    if (remoteRaw) {
      const remote = normalizeProfile(remoteRaw as Partial<LocalUserProfile>);
      if (isLegacyDefaultDisplayName(remote.displayName) && !isLegacyDefaultDisplayName(local.displayName)) {
        const migrated = {
          ...remote,
          displayName: local.displayName,
          avatarPreset: local.avatarPreset,
          customAvatarUrl: local.customAvatarUrl,
          bio: local.bio,
        };
        writeStoredProfile(migrated);
        void persistUserProfileRemote(migrated);
        return migrated;
      }
      writeStoredProfile(remote);
      return remote;
    }
  } catch {
    // Fall back to browser storage when the server is unreachable.
  }

  if (profileHasCustomData(local)) {
    void persistUserProfileRemote(local);
  }
  return local;
}

export function saveUserProfile(profile: LocalUserProfile): void {
  writeStoredProfile(profile);
  void persistUserProfileRemote(profile);
}

export function refreshUserProfileForLocale(profile: LocalUserProfile): LocalUserProfile {
  let changed = false;
  const next: LocalUserProfile = { ...profile };

  if (isLegacyDefaultDisplayName(profile.displayName)) {
    const displayName = resolveDefaultDisplayName();
    if (displayName !== profile.displayName) {
      next.displayName = displayName;
      changed = true;
    }
  }

  if (isLegacyDefaultBio(profile.bio)) {
    const bio = resolveDefaultBio();
    if (bio !== profile.bio) {
      next.bio = bio;
      changed = true;
    }
  }

  if (!changed) return profile;
  writeStoredProfile(next);
  void persistUserProfileRemote(next);
  return next;
}

export function resolveUserProfileAvatar(profile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">) {
  return profile.customAvatarUrl ? "custom" as const : profile.avatarPreset;
}
