import type { Identity } from "@group-chat/shared";
import { defaultRoleDescription, roleDescriptionPresets } from "./constants.js";

export function getIdentityRoleDescription(
  identity: Pick<Identity, "systemPrompt" | "stylePrompt"> | null | undefined,
): string {
  return [identity?.systemPrompt, identity?.stylePrompt]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function getConfiguredIdentityRoleDescription(
  identity: Pick<Identity, "systemPrompt" | "stylePrompt"> | null | undefined,
): string {
  const description = getIdentityRoleDescription(identity);
  if (!description || description === defaultRoleDescription) {
    return "";
  }
  return description;
}

export function getIdentityRoleLabel(
  identity: Pick<Identity, "systemPrompt" | "stylePrompt"> | null | undefined,
): string | null {
  const description = getConfiguredIdentityRoleDescription(identity);
  if (!description) return null;
  const matched = roleDescriptionPresets.find(
    (preset) => preset.id !== "custom" && preset.description.trim() === description.trim(),
  );
  return matched?.name ?? "自定义";
}
