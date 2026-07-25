// FILE: i18n.ts
// Purpose: Framework-agnostic locale primitives shared by the web app, desktop main process, and server.

export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Used whenever a requested tag maps to no supported locale. */
export const FALLBACK_LOCALE: Locale = "en";

const SUPPORTED_LOCALE_SET: ReadonlySet<string> = new Set(SUPPORTED_LOCALES);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALE_SET.has(value);
}

/**
 * Map an arbitrary BCP 47 tag onto a supported locale, or `null` when nothing matches.
 *
 * Traditional Chinese tags (`zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`) currently resolve to
 * Simplified Chinese: no Traditional catalog exists yet, and Simplified serves a Chinese
 * reader far better than falling back to English. Give them their own branch here once a
 * `zh-TW` catalog lands.
 */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
  if (typeof tag !== "string") return null;

  const normalized = tag.trim().toLowerCase().replaceAll("_", "-");
  if (normalized.length === 0) return null;

  const [language] = normalized.split("-");
  if (language === "zh") return "zh-CN";
  if (language === "en") return "en";

  return null;
}

/**
 * Pick the first supported locale from an ordered list of preferred tags.
 *
 * Takes the tags as an argument rather than reading `navigator` so the server, the desktop
 * main process, and tests can all call it. Web callers pass `readNavigatorLocaleTags()`.
 */
export function detectSystemLocale(preferredTags: readonly string[]): Locale {
  for (const tag of preferredTags) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }

  return FALLBACK_LOCALE;
}

/** Read the browser's ordered language preferences. Returns `[]` outside a browser. */
export function readNavigatorLocaleTags(): readonly string[] {
  const navigatorRef = globalThis.navigator;
  if (!navigatorRef) return [];

  const languages = navigatorRef.languages;
  if (Array.isArray(languages) && languages.length > 0) return languages;

  return navigatorRef.language ? [navigatorRef.language] : [];
}
