import { isDefaultIdentityRoleDescription, type Identity } from "@group-chat/shared";
import { t } from "./i18n/index.js";

export function matchRolePresetId(description: string) {
  return "custom";
}

export function normalizeRoleDescriptionForEditor(
  identity: Pick<Identity, "systemPrompt" | "stylePrompt"> | null | undefined,
) {
  const description = getIdentityRoleDescription(identity);
  if (isDefaultIdentityRoleDescription(description)) return "";
  return description;
}

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
  if (isDefaultIdentityRoleDescription(description)) {
    return "";
  }
  return description;
}

export function getIdentityRoleLabel(
  identity: Pick<Identity, "systemPrompt" | "stylePrompt"> | null | undefined,
): string | null {
  const description = getConfiguredIdentityRoleDescription(identity);
  if (!description) return null;
  return t("rolePreset.custom");
}
