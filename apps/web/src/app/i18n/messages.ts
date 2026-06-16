import type { AppLocale } from "./locale.js";

export type MessageCatalog = Record<string, string>;

const catalogs = new Map<AppLocale, MessageCatalog>();
const loadedLocales = new Set<AppLocale>();

export function getMessageCatalog(locale: AppLocale) {
  return catalogs.get(locale) ?? {};
}

export function hasLoadedLocale(locale: AppLocale) {
  return loadedLocales.has(locale);
}

export async function ensureLocaleMessages(locale: AppLocale) {
  await loadLocaleMessages("en");
  if (locale !== "en") {
    await loadLocaleMessages(locale);
  }
}

async function loadLocaleMessages(locale: AppLocale) {
  if (loadedLocales.has(locale)) return;
  const response = await fetch(`/locales/${locale}.json`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Locale ${locale} failed to load.`);
  }
  const messages = (await response.json()) as unknown;
  catalogs.set(locale, messages && typeof messages === "object" ? (messages as MessageCatalog) : {});
  loadedLocales.add(locale);
}
