import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@synara/shared/i18n";
import { getMessages, LOCALE_LABELS } from "./catalogs";
import { en } from "./locales/en";

/** Flatten a catalog to sorted dotted key paths, treating functions as leaves. */
function collectKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];

  return Object.entries(value)
    .flatMap(([key, child]) => collectKeyPaths(child, prefix ? `${prefix}.${key}` : key))
    .toSorted();
}

describe("message catalogs", () => {
  // The `: Messages` annotation on each catalog already enforces this at compile time. This
  // test is the runtime backstop against an `as any` or a structural-typing gap slipping through.
  it("gives every locale the same key structure as English", () => {
    const expected = collectKeyPaths(en);
    expect(expected.length).toBeGreaterThan(0);

    for (const locale of SUPPORTED_LOCALES) {
      expect(collectKeyPaths(getMessages(locale)), `locale ${locale}`).toEqual(expected);
    }
  });

  it("labels every supported locale in the picker", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
    }
  });

  it("returns a distinct catalog per locale", () => {
    expect(getMessages("zh-CN")).not.toBe(getMessages("en"));
    expect(getMessages("zh-CN").settings.general.coreDefaults.title).not.toBe(
      getMessages("en").settings.general.coreDefaults.title,
    );
  });
});
