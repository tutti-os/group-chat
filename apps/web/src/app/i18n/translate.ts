import { getMessageCatalog } from "./messages.js";
import type { AppLocale } from "./locale.js";

export type TranslateParams = Record<string, string | number | undefined>;

let currentLocale: AppLocale = "en";
const listeners = new Set<() => void>();

export function subscribeI18n(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocale(): AppLocale {
  return currentLocale;
}

export function getI18nSnapshot() {
  return currentLocale;
}

export function setCurrentLocale(locale: AppLocale) {
  if (locale === currentLocale) return;
  currentLocale = locale;
  listeners.forEach((listener) => listener());
}

export function translate(key: string, params?: TranslateParams) {
  const template =
    getMessageCatalog(currentLocale)[key]
    ?? getMessageCatalog("en")[key]
    ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function t(key: string, params?: TranslateParams) {
  return translate(key, params);
}
