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
  const roleDescription = roomOverride || buildRoleDescription(identity);
  return shouldApplyProductPrdGuidance(participant, identity, roleDescription)
    ? appendProductPrdGuidance(roleDescription)
    : roleDescription;
}

export function hasRoomRoleOverride(participant: Participant) {
  return Boolean(participant.roomInstructions.trim());
}

const PRODUCT_PRD_GUIDANCE = `## PRD Request Contract
When the user asks for a PRD, product requirements document, or 产品需求文档:
- Do not answer with only acceptance criteria or a generic checklist.
- First identify the product/surface. If the request is ambiguous and the answer would materially change the PRD, ask one clarifying question. If you proceed, state the assumption first.
- Do not silently turn a brand or physical product, such as Coca-Cola, into a website, app, or ecommerce flow unless the user specified that surface.
- A complete PRD should cover: background/problem, target users, scenarios, goals, non-goals, scope, user journey/core workflow, functional requirements with priority, content/data/UX states when relevant, success metrics, acceptance criteria, risks/dependencies, and open questions.
- Match the user's language and keep the document structured enough for design, engineering, and QA to act on.`;

function appendProductPrdGuidance(roleDescription: string) {
  if (
    roleDescription.includes("## PRD Request Contract")
    || (/when the user asks for a prd/i.test(roleDescription) && /do not silently turn a brand or physical product/i.test(roleDescription))
  ) {
    return roleDescription;
  }
  return [roleDescription.trim(), PRODUCT_PRD_GUIDANCE].filter(Boolean).join("\n\n");
}

function shouldApplyProductPrdGuidance(
  participant: Participant,
  identity: Identity | null,
  roleDescription: string,
) {
  const displayName = participant.displayName.trim();
  const identityName = identity?.name.trim() ?? "";
  const text = [displayName, identityName, participant.roomInstructions, roleDescription]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return (
    displayName === "产品"
    || identityName === "产品"
    || /产品(?:经理|负责人|专家|agent)/i.test(text)
    || /\b(?:senior\s+)?product\s+(?:manager|lead|strategist|agent)\b/i.test(text)
  );
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
    input.participant.speedMode ? `- Speed mode: ${input.participant.speedMode}` : null,
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
