import {
  DEFAULT_PARTICIPANT_LISTEN_MODE,
  type Identity,
  type LocalAgentProviderStatus,
  type RuntimeProfile,
} from "@group-chat/shared";
import {
  defaultIdentityNameForRuntime,
  preferredDefaultRuntimeProfile,
  resolveCanonicalRuntimeProfile,
} from "./runtime.js";

export const NEW_AGENT_DRAFT_ID = "__new-local-agent__";

export function createDraftLocalAgent(
  runtimeProfiles: RuntimeProfile[],
  localAgentProviders: LocalAgentProviderStatus[],
): Identity {
  const localRuntime = preferredDefaultRuntimeProfile(runtimeProfiles);
  const canonicalRuntime = resolveCanonicalRuntimeProfile(localRuntime, runtimeProfiles);
  return {
    id: NEW_AGENT_DRAFT_ID,
    name: defaultIdentityNameForRuntime(canonicalRuntime, localAgentProviders),
    icon: "",
    systemPrompt: "",
    stylePrompt: "",
    defaultRuntimeProfileId: canonicalRuntime?.id ?? runtimeProfiles[0]?.id ?? null,
    defaultListenMode: DEFAULT_PARTICIPANT_LISTEN_MODE,
    defaultReasoningEffort: null,
    defaultSpeedMode: null,
    temperature: 0.7,
    skillIds: [],
    toolAccessPolicy: { mode: "read-only", allowedToolIds: [] },
    createdAt: "",
    updatedAt: "",
  };
}

export function isNewAgentDraft(identity: Identity | null | undefined) {
  return identity?.id === NEW_AGENT_DRAFT_ID;
}
