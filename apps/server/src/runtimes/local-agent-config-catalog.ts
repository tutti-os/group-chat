import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalAgentProviderModel, LocalAgentProviderStatus, ReasoningEffort } from "@group-chat/shared";

const REASONING_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh"]);

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return REASONING_EFFORTS.has(normalized as ReasoningEffort) ? (normalized as ReasoningEffort) : null;
}

function readTomlStringValue(contents: string, key: string) {
  const match = contents.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, "m"));
  return match?.[1]?.trim() || undefined;
}

function readCodexConfigDefaults(configDir: string) {
  try {
    const contents = readFileSync(join(configDir, "config.toml"), "utf8");
    return {
      defaultModelId: readTomlStringValue(contents, "model"),
      defaultReasoningEffort: parseReasoningEffort(readTomlStringValue(contents, "model_reasoning_effort")),
    };
  } catch {
    return {
      defaultModelId: undefined,
      defaultReasoningEffort: null as ReasoningEffort | null,
    };
  }
}

function parseCodexModelsCache(configDir: string): LocalAgentProviderModel[] {
  try {
    const payload = JSON.parse(readFileSync(join(configDir, "models_cache.json"), "utf8")) as unknown;
    const record = toRecord(payload);
    const rawModels = Array.isArray(record?.models) ? record.models : [];
    const models: LocalAgentProviderModel[] = [
      { id: "default", label: "Default (CLI config)" },
    ];
    const seen = new Set(["default"]);

    for (const entry of rawModels) {
      const modelRecord = toRecord(entry);
      if (!modelRecord) continue;
      if (modelRecord.visibility === "hide") continue;
      if (modelRecord.upgrade) continue;
      const id = readString(modelRecord, "slug") ?? readString(modelRecord, "id");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const label = readString(modelRecord, "display_name") ?? readString(modelRecord, "displayName") ?? id;
      const description = readString(modelRecord, "description");
      const supportedReasoningEfforts = Array.isArray(modelRecord.supported_reasoning_levels)
        ? modelRecord.supported_reasoning_levels
            .map((level) => {
              const levelRecord = toRecord(level);
              return parseReasoningEffort(readString(levelRecord ?? {}, "effort") ?? undefined);
            })
            .filter((effort): effort is ReasoningEffort => effort !== null)
        : undefined;
      models.push({
        id,
        label,
        ...(description ? { description } : {}),
        ...(supportedReasoningEfforts?.length ? { supportedReasoningEfforts } : {}),
      });
    }

    return models.length > 1 ? models : [];
  } catch {
    return [];
  }
}

function needsModelCatalogEnrichment(provider: LocalAgentProviderStatus) {
  if (!provider.available) return false;
  if (provider.models.length === 0) return true;
  return provider.models.length === 1 && provider.models[0]?.id === "default";
}

export function enrichLocalAgentProviderStatus(provider: LocalAgentProviderStatus): LocalAgentProviderStatus {
  if (provider.provider !== "codex" || !provider.configDir || !needsModelCatalogEnrichment(provider)) {
    return provider;
  }

  const defaults = readCodexConfigDefaults(provider.configDir);
  const cachedModels = parseCodexModelsCache(provider.configDir);
  if (!cachedModels.length) {
    return {
      ...provider,
      ...(defaults.defaultModelId ? { defaultModelId: defaults.defaultModelId } : {}),
      ...(defaults.defaultReasoningEffort ? { defaultReasoningEffort: defaults.defaultReasoningEffort } : {}),
    };
  }

  return {
    ...provider,
    models: cachedModels,
    defaultModelId: defaults.defaultModelId ?? cachedModels.find((model) => model.id !== "default")?.id,
    defaultReasoningEffort: defaults.defaultReasoningEffort ?? null,
  };
}
