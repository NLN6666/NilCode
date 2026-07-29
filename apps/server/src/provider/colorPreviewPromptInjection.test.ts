// FILE: colorPreviewPromptInjection.test.ts
// Purpose: Verifies the color-preview instructions respect the injection budget
//          (all-or-nothing) and stay anchored to the contracts theme schema.
// Layer: Server provider tests

import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  THEME_FENCE_EXAMPLE_PAYLOAD,
  THEME_FENCE_HTML_MODIFIER,
  THEME_FENCE_LANGUAGE,
  ThemeFencePayload,
} from "@synara/contracts";

import {
  buildColorPreviewInstructions,
  COLOR_PREVIEW_INSTRUCTIONS,
} from "./colorPreviewPromptInjection.ts";

describe("buildColorPreviewInstructions", () => {
  it("returns the full instructions when they fit the budget", () => {
    expect(buildColorPreviewInstructions({ maxChars: COLOR_PREVIEW_INSTRUCTIONS.length })).toBe(
      COLOR_PREVIEW_INSTRUCTIONS,
    );
  });

  it("is all-or-nothing: an insufficient budget yields no injection", () => {
    expect(buildColorPreviewInstructions({ maxChars: COLOR_PREVIEW_INSTRUCTIONS.length - 1 })).toBe(
      "",
    );
    expect(buildColorPreviewInstructions({ maxChars: 0 })).toBe("");
    expect(buildColorPreviewInstructions({ maxChars: -5 })).toBe("");
  });

  it("forbids the side effects a tool-equipped agent defaults to", () => {
    // Without explicit prohibitions a coding agent writes theme files to disk
    // and opens a browser to verify them, never emitting the fence at all —
    // which is exactly what happened before these lines existed.
    expect(COLOR_PREVIEW_INSTRUCTIONS).toContain("MUST NOT");
    expect(COLOR_PREVIEW_INSTRUCTIONS).toContain("to disk");
    expect(COLOR_PREVIEW_INSTRUCTIONS).toContain("Open a browser");
    expect(COLOR_PREVIEW_INSTRUCTIONS).toContain("proposal, not an implementation");
  });

  it("leads with the rendered HTML mockup, not the raw token list", () => {
    // The user asked to SEE the palette in context. Reordering these two
    // sections silently flips which format the model reaches for first, so
    // the precedence is asserted rather than left to prose review.
    const htmlAt = COLOR_PREVIEW_INSTRUCTIONS.indexOf(`\`\`\`html ${THEME_FENCE_HTML_MODIFIER}`);
    const jsonAt = COLOR_PREVIEW_INSTRUCTIONS.indexOf(`\`\`\`${THEME_FENCE_LANGUAGE} JSON fence`);
    expect(htmlAt).toBeGreaterThan(-1);
    expect(jsonAt).toBeGreaterThan(-1);
    expect(htmlAt).toBeLessThan(jsonAt);
    expect(COLOR_PREVIEW_INSTRUCTIONS).toContain("Preferred format — a ```html");
  });

  it("teaches exactly the fence format the renderer accepts", () => {
    // The example embedded in the prompt must decode against the contracts
    // schema — the single source of truth shared with the web renderer.
    const decode = Schema.decodeUnknownSync(ThemeFencePayload);
    expect(() => decode(THEME_FENCE_EXAMPLE_PAYLOAD)).not.toThrow();
    expect(COLOR_PREVIEW_INSTRUCTIONS).toContain(`\`\`\`${THEME_FENCE_LANGUAGE}`);
    expect(COLOR_PREVIEW_INSTRUCTIONS).toContain(
      JSON.stringify(THEME_FENCE_EXAMPLE_PAYLOAD, null, 2),
    );
  });
});
