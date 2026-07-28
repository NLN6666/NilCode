// FILE: colorPreviewPromptInjection.ts
// Purpose: Builds the per-turn instructions injected when the user enables the
//          color-preview mode via the composer's `@Preview` mention. The fence
//          formats described here derive from the @synara/contracts theme
//          schema, which is the single source of truth shared with the web
//          renderer.
// Layer: Server provider helper
// Exports: COLOR_PREVIEW_INSTRUCTIONS, buildColorPreviewInstructions

import {
  THEME_FENCE_EXAMPLE_PAYLOAD,
  THEME_FENCE_HTML_MODIFIER,
  THEME_FENCE_LANGUAGE,
} from "@synara/contracts";

const exampleThemeJson = JSON.stringify(THEME_FENCE_EXAMPLE_PAYLOAD, null, 2);

export const COLOR_PREVIEW_INSTRUCTIONS = [
  "<color_preview_mode>",
  "The user enabled color-theme preview mode for this turn. When you propose a " +
    "color palette or theme, emit it as a fenced code block in one of the two " +
    "formats below so the client renders an interactive swatch card with an " +
    '"adopt" action. Emit one fence per palette variant.',
  "",
  `Preferred format — a \`\`\`${THEME_FENCE_LANGUAGE} fence containing JSON. ` +
    '"name" (string) and "colors" (non-empty array) are required; every color ' +
    'entry requires "token" (string) and "hex" (#RGB, #RGBA, #RRGGBB, or ' +
    '#RRGGBBAA string) and may add an optional "note" (string):',
  "",
  `\`\`\`${THEME_FENCE_LANGUAGE}`,
  exampleThemeJson,
  "```",
  "",
  `Only when you need to demonstrate typography or component composition, use a ` +
    `\`\`\`html ${THEME_FENCE_HTML_MODIFIER} fence instead (the trailing ` +
    `"${THEME_FENCE_HTML_MODIFIER}" keyword is required; a bare \`\`\`html fence ` +
    "stays a plain code block). The HTML renders in a fully sandboxed iframe: " +
    "scripts never run and network requests (external images, fonts, trackers) " +
    "are blocked, so use inline styles and data: images only.",
  "",
  "Plain hex colors you mention in prose or inline code automatically get an " +
    "inline swatch, so reference exact hex values when discussing colors.",
  "</color_preview_mode>",
].join("\n");

/**
 * Returns the color-preview instructions when they fit in the remaining
 * injection budget, else an empty string. All-or-nothing on purpose: a
 * truncated format spec would teach the model a broken fence contract.
 */
export function buildColorPreviewInstructions(input: { readonly maxChars: number }): string {
  if (input.maxChars <= 0 || COLOR_PREVIEW_INSTRUCTIONS.length > input.maxChars) {
    return "";
  }
  return COLOR_PREVIEW_INSTRUCTIONS;
}
