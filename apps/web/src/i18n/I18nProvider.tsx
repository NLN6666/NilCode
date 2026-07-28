// FILE: i18n/I18nProvider.tsx
// Purpose: Publish the active locale's catalog to the tree and keep <html lang> in sync.

import { useEffect, useMemo, type ReactNode } from "react";
import type { Locale } from "@synara/shared/i18n";
import { getMessages } from "./catalogs";
import { I18nContext } from "./context";

type I18nProviderProps = {
  /** Controlled by the caller that already subscribes to app settings, so we add no second subscription. */
  readonly locale: Locale;
  readonly children: ReactNode;
};

export function I18nProvider({ locale, children }: I18nProviderProps) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, messages: getMessages(locale) }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
