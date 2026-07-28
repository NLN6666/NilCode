// FILE: colorTheme.ts
// Purpose: Contract for color-theme preview fences. The web renderer and the
//          server prompt injection both derive the fence format from this file,
//          so the schema is the single source of truth for both sides.
// Layer: shared contracts (schema-only — no runtime logic beyond schema defs)
// Exports: theme fence constants + ThemeFenceColor/ThemeFencePayload schemas

import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

/** Fence info language that marks a structured color-theme block: ```theme */
export const THEME_FENCE_LANGUAGE = "theme";

/**
 * Trailing fence-info modifier that turns an ```html fence into a sandboxed
 * theme preview: ```html theme. A bare ```html fence stays a plain code block.
 */
export const THEME_FENCE_HTML_MODIFIER = "theme";

/** CSS hex color literal: #RGB, #RGBA, #RRGGBB, or #RRGGBBAA. */
export const ThemeFenceHexColor = Schema.String.check(
  Schema.isPattern(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/),
);
export type ThemeFenceHexColor = typeof ThemeFenceHexColor.Type;

/** One swatch row inside a structured ```theme fence. */
export const ThemeFenceColor = Schema.Struct({
  token: TrimmedNonEmptyString,
  hex: ThemeFenceHexColor,
  note: Schema.optional(Schema.String),
});
export type ThemeFenceColor = typeof ThemeFenceColor.Type;

/** JSON payload of a structured ```theme fence. */
export const ThemeFencePayload = Schema.Struct({
  name: TrimmedNonEmptyString,
  colors: Schema.Array(ThemeFenceColor).check(Schema.isMinLength(1)),
});
export type ThemeFencePayload = typeof ThemeFencePayload.Type;

/**
 * Canonical example payload shown to providers by the color-preview prompt
 * injection. Lives next to the schema (and is validated against it in tests)
 * so the format the model is taught can never drift from what the renderer
 * accepts.
 */
export const THEME_FENCE_EXAMPLE_PAYLOAD: ThemeFencePayload = {
  name: "Warm Dusk",
  colors: [
    { token: "background", hex: "#1B1412", note: "page background" },
    { token: "foreground", hex: "#F4E8E1" },
    { token: "accent", hex: "#E2725B" },
  ],
};
