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

export const AVATAR_PRESET_LABELS: Record<AvatarPresetId, string> = {
  "saiyan-01": "金发战士",
  "saiyan-02": "蓝发战士",
  "saiyan-03": "红发战士",
  "saiyan-04": "绿发战士",
  "saiyan-05": "紫发战士",
  "saiyan-06": "粉发战士",
  "saiyan-07": "银发战士",
  "saiyan-08": "橙发战士",
  "saiyan-09": "棕发战士",
  "saiyan-10": "青发战士",
  "saiyan-11": "黄绿战士",
  "saiyan-12": "深紫战士",
  "saiyan-13": "黄金战士",
  "saiyan-14": "靛蓝战士",
  "saiyan-15": "赤橙战士",
};

export const DEFAULT_USER_PROFILE: LocalUserProfile = {
  displayName: "Group Chat",
  avatarPreset: "saiyan-01",
  customAvatarUrl: null,
  bio: "本地优先的 Agent 群聊工作区。",
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

export function loadUserProfile(): LocalUserProfile {
  if (typeof window === "undefined") return DEFAULT_USER_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_USER_PROFILE;
    const parsed = JSON.parse(raw) as Partial<LocalUserProfile>;
    return {
      displayName: typeof parsed.displayName === "string" && parsed.displayName.trim()
        ? parsed.displayName.trim()
        : DEFAULT_USER_PROFILE.displayName,
      avatarPreset: normalizePreset(parsed.avatarPreset),
      customAvatarUrl: typeof parsed.customAvatarUrl === "string" && parsed.customAvatarUrl.startsWith("data:image/")
        ? parsed.customAvatarUrl
        : null,
      bio: typeof parsed.bio === "string" ? parsed.bio : DEFAULT_USER_PROFILE.bio,
    };
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

export function saveUserProfile(profile: LocalUserProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function resolveUserProfileAvatar(profile: Pick<LocalUserProfile, "avatarPreset" | "customAvatarUrl">) {
  return profile.customAvatarUrl ? "custom" as const : profile.avatarPreset;
}
