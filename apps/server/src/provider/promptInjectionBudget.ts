// FILE: promptInjectionBudget.ts
// Purpose: Single computation for how many characters a server-side prompt
//          injection may still add to an outgoing provider turn. Skill inlining,
//          color-preview instructions, and mentioned-thread context all compete
//          for the same turn budget, so they must share this arithmetic instead
//          of each deriving their own.
// Layer: Server provider helper
// Exports: PROVIDER_INPUT_SAFETY_MARGIN_CHARS, availablePromptInjectionChars

import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@synara/contracts";

/** Headroom kept free so injections never push a turn to the exact provider limit. */
export const PROVIDER_INPUT_SAFETY_MARGIN_CHARS = 1_000;

/**
 * Characters an injection may still append given the input assembled so far.
 * `usedChars` is the length of everything already destined for the provider
 * (message text plus previously applied injections), so successive injection
 * sources naturally compete for one shared budget.
 */
export function availablePromptInjectionChars(usedChars: number): number {
  return Math.max(
    0,
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS - usedChars - PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
  );
}
