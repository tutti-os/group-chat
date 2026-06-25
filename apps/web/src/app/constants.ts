import type { ParticipantListenMode, ReasoningEffort, ReplyMode, SpeakingOrder } from "@group-chat/shared";
import { t } from "./i18n/index.js";

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
