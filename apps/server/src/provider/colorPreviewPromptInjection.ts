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
  "The user typed @Preview. They want to SEE color options rendered inside this " +
    "conversation and approve one before anything gets built. This turn is a " +
    "proposal, not an implementation.",
  "",
  "You MUST:",
  "- Present every palette as a fenced block in your reply, using a format below.",
  "- Emit one fence per variant so the user can compare them side by side.",
  "",
  "You MUST NOT, on this turn:",
  "- Write theme files, config files, or preview pages to disk.",
  "- Open a browser, start a preview server, or take screenshots.",
  "- Give installation or apply-to-project instructions.",
  "",
  'The client renders each fence as an interactive swatch card with an "adopt" ' +
    "button. When the user adopts one, they send the confirmed palette back to " +
    "you — implement it then, not now.",
  "",
  `Preferred format — a \`\`\`html ${THEME_FENCE_HTML_MODIFIER} fence showing the ` +
    "palette applied to a realistic mockup of whatever the user is theming (an " +
    "editor window with syntax-highlighted code, a dashboard, a settings panel, " +
    "…). Seeing the colors in context is the point; a bare list of values is not " +
    `what the user asked for. The trailing "${THEME_FENCE_HTML_MODIFIER}" keyword ` +
    "is required — a bare ```html fence stays a plain code block.",
  "",
  "Rules for that HTML:",
  "- It renders in a fully sandboxed iframe: scripts never run and every network " +
    "request (external images, fonts, trackers) is blocked. Use inline styles and " +
    "data: URIs only — no <script>, no external CSS or fonts.",
  "- The visible area is about 360px tall and the user can expand it to 720px. " +
    "Design a compact mockup that reads at that size instead of a full-length page.",
  "- Write every color as an explicit hex literal in the markup. Adopting an HTML " +
    "preview extracts the hex values from the source in the order they appear.",
  "",
  `Use a \`\`\`${THEME_FENCE_LANGUAGE} JSON fence instead only when the user wants ` +
    "the raw token list rather than a rendered mockup. It renders as labelled " +
    'swatch rows. "name" (string) and "colors" (non-empty array) are required; ' +
    'every entry requires "token" (string) and "hex" (#RGB, #RGBA, #RRGGBB, or ' +
    '#RRGGBBAA string) and may add an optional "note" (string):',
  "",
  `\`\`\`${THEME_FENCE_LANGUAGE}`,
  exampleThemeJson,
  "```",
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
