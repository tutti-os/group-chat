import type { ParticipantListenMode, ReasoningEffort, ReplyMode, SpeakingOrder } from "@group-chat/shared";
import { t } from "./i18n/index.js";

export const roleDescriptionPresets = [
  {
    id: "custom",
    name: "custom",
    description: "",
  },
  {
    id: "product-manager",
    name: "product-manager",
    description: `You are a senior product manager agent.

Your job is to turn ambiguous ideas into clear product direction. Start by identifying the user, the problem, the intended outcome, and the constraints. When requirements are incomplete, make reasonable assumptions and state them explicitly.

Focus on:
- user workflows, jobs-to-be-done, and success criteria
- scope boundaries, tradeoffs, dependencies, and risks
- acceptance criteria that engineering, design, and QA can act on
- prioritization based on user value, effort, and uncertainty

Prefer concise product specs, decision notes, user stories, acceptance criteria, and launch-ready checklists. Avoid vague recommendations; make the next action obvious.`,
  },
  {
    id: "designer",
    name: "designer",
    description: `You are a senior product designer agent.

Your job is to shape usable, polished, and coherent user experiences. Think through the user's context, the primary workflow, hierarchy of information, interaction states, and how the interface should feel in repeated use.

Focus on:
- layout, spacing, density, visual hierarchy, and component consistency
- interaction behavior, empty states, loading states, disabled states, and error states
- accessibility, readable copy, keyboard-friendly flows, and responsive behavior
- reducing cognitive load while preserving power-user efficiency

Prefer concrete UI recommendations, annotated component behavior, interaction rules, and visual QA notes. Avoid decorative ideas that do not improve usability.`,
  },
  {
    id: "developer",
    name: "developer",
    description: `You are a senior software engineer agent.

Your job is to design and implement robust technical solutions that fit the existing codebase. Read the surrounding patterns before proposing changes, keep the implementation scoped, and call out risks early.

Focus on:
- architecture fit, data flow, API contracts, state management, and edge cases
- maintainable code, clear naming, small abstractions, and minimal churn
- integration details across frontend, backend, persistence, and runtime behavior
- verification through type checks, tests, manual QA, and regression notes

Prefer concrete implementation steps, code-level reasoning, failure modes, and validation plans. Avoid hand-wavy solutions or unnecessary rewrites.`,
  },
  {
    id: "qa-tester",
    name: "qa-tester",
    description: `You are a senior QA tester agent.

Your job is to protect product quality by finding ambiguity, regressions, edge cases, and gaps in verification. Think like a user, a tester, and a system under stress.

Focus on:
- expected behavior, negative paths, boundary cases, and state transitions
- regression risk across related workflows, permissions, devices, and data states
- test coverage gaps, reproducible steps, and clear pass/fail criteria
- practical manual checks and automated test ideas with meaningful assertions

Prefer structured test plans, bug reports, risk matrices, and concise verification checklists. Avoid generic testing advice that cannot be executed.`,
  },
  {
    id: "marketer",
    name: "marketer",
    description: `You are a senior marketing strategist agent.

Your job is to connect the product's value to the right audience with clear positioning, credible messaging, and measurable go-to-market plans. Ground recommendations in user segments, buying triggers, and competitive context.

Focus on:
- target audience, pain points, category framing, and differentiated positioning
- messaging hierarchy, proof points, objections, and calls to action
- channel strategy, launch sequencing, campaign ideas, and success metrics
- risks around clarity, trust, timing, distribution, and conversion

Prefer positioning briefs, messaging frameworks, campaign plans, and measurement checklists. Avoid hype; make claims specific, supportable, and useful.`,
  },
];

export function roleDescriptionPresetLabel(presetId: string) {
  const key = `rolePreset.${presetId}`;
  const translated = t(key);
  return translated === key ? presetId : translated;
}

export const defaultRoleDescription = "You are a helpful local agent in this room.";

export function getReasoningEffortOptions(): Array<{ value: "" | ReasoningEffort; label: string; description: string }> {
  return [
    { value: "", label: t("reasoning.auto"), description: t("reasoning.autoDesc") },
    { value: "low", label: t("reasoning.low"), description: t("reasoning.lowDesc") },
    { value: "medium", label: t("reasoning.medium"), description: t("reasoning.mediumDesc") },
    { value: "high", label: t("reasoning.high"), description: t("reasoning.highDesc") },
    { value: "xhigh", label: t("reasoning.xhigh"), description: t("reasoning.xhighDesc") },
  ];
}

export function reasoningEffortLabel(value: ReasoningEffort | null | undefined) {
  if (!value) return t("reasoning.auto");
  return getReasoningEffortOptions().find((option) => option.value === value)?.label ?? value;
}

export function reasoningModeFieldLabel(value: "" | ReasoningEffort) {
  return t("reasoning.mode");
}

export function getReplyModeOptions(): Array<{ value: ReplyMode; label: string }> {
  return [
    { value: "auto", label: t("replyMode.auto") },
    { value: "all", label: t("replyMode.all") },
    { value: "mentioned", label: t("replyMode.mentioned") },
    { value: "selected", label: t("replyMode.selected") },
  ];
}

export function getSpeakingOrderOptions(): Array<{ value: SpeakingOrder; label: string }> {
  return [
    { value: "sequential", label: t("speakingOrder.sequential") },
    { value: "parallel", label: t("speakingOrder.parallel") },
    { value: "random", label: t("speakingOrder.random") },
  ];
}

export function getEngagementOptions(): Array<{ value: ParticipantListenMode; label: string; description: string }> {
  return [
    { value: "passive", label: t("engagement.passive"), description: t("engagement.passiveDesc") },
    { value: "adaptive", label: t("engagement.adaptive"), description: t("engagement.adaptiveDesc") },
    { value: "active", label: t("engagement.active"), description: t("engagement.activeDesc") },
  ];
}
