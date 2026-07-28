// FILE: i18n/catalogs.ts
// Purpose: Map locales to their message catalogs and to the labels shown in the language picker.

import { FALLBACK_LOCALE, type Locale } from "@synara/shared/i18n";
import { en, type Messages } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

const MESSAGE_CATALOGS: Record<Locale, Messages> = {
  en,
  "zh-CN": zhCN,
};

/**
 * Language names are written in their own language, so the picker stays readable no matter
 * which language the surrounding UI is currently in. These are not translated.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

export function getMessages(locale: Locale): Messages {
  return MESSAGE_CATALOGS[locale] ?? MESSAGE_CATALOGS[FALLBACK_LOCALE];
}
