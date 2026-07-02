import { parseTuttiAgentParticipantId, type Identity, type RuntimeProfile } from "@group-chat/shared";
import { hasCustomRoomAvatar } from "./room-avatar.js";

export interface RuntimeProviderAvatarStyle {
  label: string;
  background: string;
  color: string;
  iconUrl: string | null;
}

const RUNTIME_PROVIDER_ICONS: Record<string, string> = {
  codex: "/runtime-icons/codex.png",
  claude: "/runtime-icons/claude-code.png",
};

export function getRuntimeProviderAvatarIconUrl(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return RUNTIME_PROVIDER_ICONS[provider.trim().toLowerCase()] ?? null;
}

export function getRuntimeProviderAvatarStyle(provider: string | null | undefined): RuntimeProviderAvatarStyle | null {
  if (!provider) return null;
  const normalized = provider.trim().toLowerCase();
  const iconUrl = getRuntimeProviderAvatarIconUrl(normalized);
  if (normalized === "codex") {
    return { label: "Cx", background: "transparent", color: "var(--white-stationary)", iconUrl };
  }
  if (normalized === "claude") {
    return { label: "Cc", background: "transparent", color: "var(--white-stationary)", iconUrl };
  }
  return {
    label: normalized.slice(0, 2).toUpperCase() || "AI",
    background: "var(--text-primary)",
    color: "var(--white-stationary)",
    iconUrl: null,
  };
}

export function resolveAgentAvatar(input: {
  icon?: string | null;
  avatar?: string | null;
  participantId?: string | null;
  runtimeProfile?: Pick<RuntimeProfile, "provider" | "kind"> | null;
}): {
  avatar: string | null;
  provider: string | null;
} {
  const builtInProvider = parseTuttiAgentParticipantId(input.participantId);
  if (builtInProvider) {
    return { avatar: null, provider: builtInProvider };
  }

  const custom = input.avatar ?? input.icon;
  if (hasCustomRoomAvatar(custom)) {
    return { avatar: custom!.trim(), provider: null };
  }
  if (input.runtimeProfile?.kind === "local-agent" && input.runtimeProfile.provider.trim()) {
    return { avatar: null, provider: input.runtimeProfile.provider };
  }
  return { avatar: null, provider: null };
}

export function resolveAgentAvatarFromContext(input: {
  icon?: string | null;
  avatar?: string | null;
  participantId?: string | null;
  runtimeProfileId?: string | null;
  identity?: Pick<Identity, "icon" | "defaultRuntimeProfileId"> | null;
  runtimeProfiles: RuntimeProfile[];
}) {
  const runtimeProfile =
    (input.runtimeProfileId
      ? input.runtimeProfiles.find((profile) => profile.id === input.runtimeProfileId) ?? null
      : null)
    ?? (input.identity?.defaultRuntimeProfileId
      ? input.runtimeProfiles.find((profile) => profile.id === input.identity!.defaultRuntimeProfileId) ?? null
      : null);
  return resolveAgentAvatar({
    icon: input.icon ?? input.identity?.icon,
    avatar: input.avatar,
    participantId: input.participantId,
    runtimeProfile,
  });
}
