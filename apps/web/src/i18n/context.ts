// FILE: i18n/context.ts
// Purpose: React context plumbing for the active locale and its message catalog.
//
// Kept separate from I18nProvider.tsx so that file exports a component and nothing else,
// which keeps react-refresh happy.

import { createContext, useContext } from "react";
import { FALLBACK_LOCALE, type Locale } from "@synara/shared/i18n";
import { en, type Messages } from "./locales/en";

export type I18nContextValue = {
  readonly locale: Locale;
  readonly messages: Messages;
};

/** Defaults to English so components rendered outside a provider (tests, isolated stories) still read. */
export const I18nContext = createContext<I18nContextValue>({
  locale: FALLBACK_LOCALE,
  messages: en,
});

/** Access the active catalog: `const m = useMessages(); m.settings.general.coreDefaults.title`. */
export function useMessages(): Messages {
  return useContext(I18nContext).messages;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}
