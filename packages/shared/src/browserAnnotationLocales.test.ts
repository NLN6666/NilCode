// FILE: browserAnnotationLocales.test.ts
// Purpose: Keep the annotation guest's bounded locale list in step with the supported locales.
//
// Lives in `shared` because this is the only package that depends on both `@synara/contracts`
// and `@synara/shared/i18n`; `contracts` is deliberately dependency-free, so the two lists are
// mirrors rather than one importing the other.

import { describe, expect, it } from "vitest";
import { BROWSER_ANNOTATION_LOCALES } from "@synara/contracts";

import { SUPPORTED_LOCALES } from "./i18n";

describe("browser annotation locales", () => {
  it("mirrors the supported locale list exactly", () => {
    expect([...BROWSER_ANNOTATION_LOCALES]).toEqual([...SUPPORTED_LOCALES]);
  });
});
