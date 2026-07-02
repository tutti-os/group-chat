import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function applyLocale(value: unknown) {
      const locale = normalizeLocale(value) ?? resolveFallbackLocale();
      try {
        await ensureLocaleMessages(locale);
      } catch {
        await ensureLocaleMessages("en");
      }
      if (cancelled) return;
      setCurrentLocale(locale);
      document.documentElement.lang = locale;
      setReady(true);
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

  if (!ready) {
    const fallbackLocale = resolveFallbackLocale();
    return (
      <div className={"[display:grid] [min-height:100vh] [place-items:center] [background:var(--app-bg)] [color:var(--text-secondary)] [font-size:13px] [font-weight:650]"}>
        {fallbackLocale === "zh-CN" ? "正在加载 group-chat..." : "Loading group-chat..."}
      </div>
    );
  }

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
