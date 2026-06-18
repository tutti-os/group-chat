import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appPaths, ensureBaseDirs } from "../local/paths.js";

export interface StoredUserProfile {
  displayName: string;
  avatarPreset: string;
  customAvatarUrl: string | null;
  bio: string;
}

function profilePath() {
  return join(appPaths.dataDir, "user-profile.json");
}

export function readUserProfile(): StoredUserProfile | null {
  ensureBaseDirs();
  const path = profilePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredUserProfile>;
    if (typeof parsed.displayName !== "string" || !parsed.displayName.trim()) return null;
    return {
      displayName: parsed.displayName.trim(),
      avatarPreset: typeof parsed.avatarPreset === "string" && parsed.avatarPreset.trim()
        ? parsed.avatarPreset.trim()
        : "saiyan-01",
      customAvatarUrl:
        typeof parsed.customAvatarUrl === "string" && parsed.customAvatarUrl.startsWith("data:image/")
          ? parsed.customAvatarUrl
          : null,
      bio: typeof parsed.bio === "string" ? parsed.bio : "",
    };
  } catch {
    return null;
  }
}

export function writeUserProfile(profile: StoredUserProfile): StoredUserProfile {
  ensureBaseDirs();
  const normalized: StoredUserProfile = {
    displayName: profile.displayName.trim(),
    avatarPreset: profile.avatarPreset.trim() || "saiyan-01",
    customAvatarUrl:
      profile.customAvatarUrl && profile.customAvatarUrl.startsWith("data:image/")
        ? profile.customAvatarUrl
        : null,
    bio: profile.bio,
  };
  writeFileSync(profilePath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
