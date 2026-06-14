import type { Conversation, Identity, Participant } from "@group-chat/shared";
import { getConfiguredIdentityRoleDescription } from "@group-chat/shared";

export interface AgentInstructionInput {
  conversation: Conversation;
  participant: Participant;
  identity: Identity | null;
}

export function buildRoleDescription(identity: Identity | null) {
  return getConfiguredIdentityRoleDescription(identity);
}

export function buildEffectiveRoleDescription(participant: Participant, identity: Identity | null) {
  const roomOverride = participant.roomInstructions.trim();
  if (roomOverride) return roomOverride;
  return buildRoleDescription(identity);
}

export function hasRoomRoleOverride(participant: Participant) {
  return Boolean(participant.roomInstructions.trim());
}

export function buildAgentInstructions(input: AgentInstructionInput) {
  const roleDescription = buildEffectiveRoleDescription(input.participant, input.identity);
  const roomOverride = hasRoomRoleOverride(input.participant);
  return [
    "# Agent Instructions",
    "",
    "These instructions are scoped to this chat participant and should be treated like run-local AGENTS.md content.",
    "",
    "## Room",
    `- Title: ${input.conversation.title}`,
    input.conversation.groupSystemPrompt ? `- Group context: ${input.conversation.groupSystemPrompt}` : null,
    input.conversation.collaborationRules
      ? `- Collaboration rules version: ${input.conversation.collaborationRulesVersion}`
      : null,
    input.conversation.collaborationRules ? "" : null,
    input.conversation.collaborationRules ? "## Collaboration Rules" : null,
    input.conversation.collaborationRules ? input.conversation.collaborationRules : null,
    "",
    "## Member",
    `- Display name: ${input.participant.displayName}`,
    input.identity ? `- Identity name: ${input.identity.name}` : null,
    input.participant.runtimeProfileId ? `- Runtime profile: ${input.participant.runtimeProfileId}` : null,
    `- Listen mode: ${input.participant.listenMode}`,
    input.participant.reasoningEffort ? `- Reasoning effort: ${input.participant.reasoningEffort}` : null,
    roomOverride ? "" : null,
    roomOverride
      ? "This participant uses a room-specific role description that overrides the global identity defaults in this room only."
      : null,
    "",
    "## Role Description",
    roleDescription || "No role description configured.",
    "",
    "## Workspace Memory",
    "- Read MEMORY.md for room-scoped durable memory before replying.",
    "- Read DISTILLED_CONTEXT.md for compact recent context and user signals.",
    "- Raw recent interaction logs live under conversations/*.md; compact summaries live under conversations/*.summary.md.",
    "- When memory conflicts with the current message or collaboration rules, follow the current message and collaboration rules.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
