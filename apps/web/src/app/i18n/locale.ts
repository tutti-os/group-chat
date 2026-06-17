import { readTuttiAppContextValue } from "../tutti-bridge.js";

export type AppLocale = "en" | "zh-CN";

export function normalizeLocale(value: unknown): AppLocale | null {
  const next = String(value ?? "")
    .trim()
    .replace("_", "-")
    .toLowerCase();
  if (!next) return null;
  if (next === "zh" || next.startsWith("zh-")) return "zh-CN";
  if (next === "en" || next.startsWith("en-")) return "en";
  return null;
}

function normalizeAppContextLocaleValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return null;
  const record = value as { locale?: unknown; language?: unknown };
  if (typeof record.locale === "string") return record.locale;
  if (typeof record.language === "string") return record.language;
  return null;
}

export function resolveFallbackLocale(): AppLocale {
  if (typeof navigator !== "undefined") {
    const candidates = [...(navigator.languages ?? []), navigator.language];
    for (const candidate of candidates) {
      const locale = normalizeLocale(candidate);
      if (locale) return locale;
    }
  }
  if (typeof document !== "undefined") {
    const locale = normalizeLocale(document.documentElement.lang);
    if (locale) return locale;
  }
  return "en";
}

export function readSyncAppContextLocale(): AppLocale | null {
  return normalizeLocale(normalizeAppContextLocaleValue(readTuttiAppContextValue()));
}

export async function readAppContextLocaleAsync(): Promise<AppLocale | null> {
  const appContext = readTuttiAppContextValue();
  if (!appContext || typeof appContext !== "object") return null;

  if (typeof appContext.get === "function") {
    try {
      return normalizeLocale(normalizeAppContextLocaleValue(await appContext.get()));
    } catch {
      return null;
    }
  }

  return normalizeLocale(normalizeAppContextLocaleValue(appContext));
}

export function subscribeHostLocale(listener: (locale: AppLocale | null) => void) {
  const appContext = readTuttiAppContextValue();
  if (!appContext || typeof appContext !== "object") {
    return () => {};
  }

  if (typeof appContext.subscribe === "function") {
    return appContext.subscribe((context) => {
      listener(normalizeLocale(normalizeAppContextLocaleValue(context)));
    });
  }

  return () => {};
}

export async function resolveInitialLocale(): Promise<AppLocale> {
  return normalizeLocale(await readAppContextLocaleAsync()) ?? readSyncAppContextLocale() ?? resolveFallbackLocale();
}
