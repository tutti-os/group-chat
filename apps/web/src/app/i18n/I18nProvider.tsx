import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  normalizeLocale,
  readAppContextLocaleAsync,
  resolveFallbackLocale,
  resolveInitialLocale,
  subscribeHostLocale,
  type AppLocale,
} from "./locale.js";
import { ensureLocaleMessages } from "./messages.js";
import { getI18nSnapshot, setCurrentLocale, subscribeI18n, translate } from "./translate.js";

export function I18nProvider(props: { children: ReactNode }) {
  useEffect(() => {
    let cancelled = false;

    async function applyLocale(value: unknown) {
      const locale = normalizeLocale(value) ?? resolveFallbackLocale();
      await ensureLocaleMessages(locale);
      if (cancelled) return;
      setCurrentLocale(locale);
      document.documentElement.lang = locale;
    }

    void (async () => {
      const initial = await resolveInitialLocale();
      await applyLocale(initial);
    })();

    const unsubscribe = subscribeHostLocale((locale) => {
      void (async () => {
        const next = locale ?? (await readAppContextLocaleAsync()) ?? resolveFallbackLocale();
        await applyLocale(next);
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return props.children;
}

export function useTranslation() {
  const locale = useSyncExternalStore(
    subscribeI18n,
    getI18nSnapshot,
    () => (typeof window !== "undefined" ? resolveFallbackLocale() : "en"),
  );
  return { t: translate, locale };
}
