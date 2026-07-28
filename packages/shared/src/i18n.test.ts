import { describe, expect, it } from "vitest";
import {
  detectSystemLocale,
  FALLBACK_LOCALE,
  isLocale,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "./i18n";

describe("isLocale", () => {
  it("accepts every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isLocale(locale)).toBe(true);
    }
  });

  it("rejects unsupported tags and non-strings", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe("normalizeLocale", () => {
  it("maps English variants to en", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("EN-gb")).toBe("en");
  });

  it("maps Simplified Chinese variants to zh-CN", () => {
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh_CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-SG")).toBe("zh-CN");
  });

  it("maps Traditional Chinese to zh-CN until a Traditional catalog exists", () => {
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hant")).toBe("zh-CN");
    expect(normalizeLocale("zh-HK")).toBe("zh-CN");
  });

  it("returns null for unsupported or empty tags", () => {
    expect(normalizeLocale("fr-FR")).toBeNull();
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale("   ")).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
  });
});

describe("detectSystemLocale", () => {
  it("picks the first supported tag in preference order", () => {
    expect(detectSystemLocale(["fr-FR", "zh-CN", "en-US"])).toBe("zh-CN");
    expect(detectSystemLocale(["en-US", "zh-CN"])).toBe("en");
  });

  it("falls back to English when nothing matches", () => {
    expect(detectSystemLocale(["fr-FR", "de-DE"])).toBe(FALLBACK_LOCALE);
    expect(detectSystemLocale([])).toBe(FALLBACK_LOCALE);
  });
});
